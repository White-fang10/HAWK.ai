# vision/pipeline.py
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import gc, json, threading, cv2, numpy as np
from vision.detector   import detect, MIN_FACE_PX
from vision.recognizer import get_embedding, get_embeddings_batch

# ── Recognition thresholds ───────────────────────────────────────────────────
# COSINE_THRESHOLD : minimum similarity for ANY match to be considered.
#   GhostFaceNet-W1.3 genuine same-person pairs typically score 0.35–0.65.
#   0.35 is permissive enough to catch most genuine pairs across angle/lighting.
COSINE_THRESHOLD = 0.35

# MIN_MARGIN : top match must beat 2nd-best by at least this amount.
#   0.07 prevents A→B swaps while still allowing close genuine matches to pass.
MIN_MARGIN       = 0.07

VOTE_THRESHOLD   = 2      # frames in which a student must appear to be confirmed
CROP_MARGIN      = 0.20   # face crop padding (fraction of bbox size)

# ── Enrollment quality thresholds ───────────────────────────────────────────
# Minimum Laplacian variance — rejects blurry / out-of-focus images
MIN_SHARPNESS    = 80.0
# Maximum number of template embeddings stored per student
MAX_TEMPLATES    = 15


# ── Quality helpers ───────────────────────────────────────────────────────────

def _sharpness(img_gray: np.ndarray) -> float:
    """Laplacian variance — higher = sharper image."""
    return float(cv2.Laplacian(img_gray, cv2.CV_64F).var())


def _augment_crop(aligned: np.ndarray) -> list[np.ndarray]:
    """
    Generate augmented variants of an aligned 112×112 face crop.
    Returns the original plus rotated and flipped copies.
    This triples coverage without needing more photos.
    """
    h, w = aligned.shape[:2]
    cx, cy = w // 2, h // 2
    variants = [aligned]  # original

    for angle in (-15, 15):
        M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
        rotated = cv2.warpAffine(aligned, M, (w, h), flags=cv2.INTER_LANCZOS4,
                                 borderMode=cv2.BORDER_REFLECT)
        variants.append(rotated)

    # Horizontal flip (simulates looking slightly away on the other side)
    variants.append(cv2.flip(aligned, 1))

    return variants  # 4 variants per photo


class VisionPipeline:
    def __init__(self):
        self._lock          = threading.Lock()
        self._index_ids     = []     # flat list: student_id per template row
        self._index_matrix  = None   # (N_templates, 512) matrix — N_templates >= N_students

    # ── Index management ────────────────────────────────────────────────────

    def reload_index(self, db_session):
        """
        Reload the recognition index from the database.

        Reads multi-template embeddings (student.embeddings) when present,
        falling back to single-embedding (student.embedding) for older records.
        Each student contributes one or more rows to the index matrix.
        Matching uses max-similarity across all templates.
        """
        import models
        students = db_session.query(models.Student).filter(
            (models.Student.embeddings.isnot(None)) | (models.Student.embedding.isnot(None))
        ).all()

        ids, embeds = [], []
        for s in students:
            try:
                templates = []

                # Prefer new multi-template column
                if s.embeddings:
                    raw = json.loads(s.embeddings)
                    for arr in raw:
                        emb = np.array(arr, dtype=np.float32)
                        if emb.shape == (512,):
                            norm = np.linalg.norm(emb)
                            if norm > 1e-8:
                                templates.append(emb / norm)

                # Fallback: old single-embedding column
                if not templates and s.embedding:
                    emb = np.array(json.loads(s.embedding), dtype=np.float32)
                    if emb.shape == (512,):
                        norm = np.linalg.norm(emb)
                        if norm > 1e-8:
                            templates.append(emb / norm)

                for t in templates:
                    ids.append(s.id)
                    embeds.append(t)

            except Exception:
                continue

        with self._lock:
            self._index_ids    = ids
            self._index_matrix = np.stack(embeds).astype(np.float32) if embeds else None

        print(f"[Pipeline] Index loaded — {len(set(ids))} students | {len(ids)} templates.")
        return len(set(ids))

    # ── Enrollment ──────────────────────────────────────────────────────────

    def enroll_student(self, student_id, images, db_session):
        """
        Enroll a student using 1–10 high-quality face photos.

        For each photo:
          1. Run SCRFD detector to find the face
          2. Apply quality filter (sharpness + face size)
          3. Extract embedding for the aligned crop
          4. Generate 3 augmented variants (±15° rotation, flip)
          5. Extract embeddings for each variant

        All accepted embeddings (up to MAX_TEMPLATES) are stored as a JSON
        list in student.embeddings. This multi-template approach allows
        recognition to succeed across angle/lighting changes.
        """
        import models
        all_embeddings, failed, rejected_quality = [], 0, 0

        for img in images:
            if img is None:
                failed += 1
                continue

            dets = detect(img)
            if not dets:
                failed += 1
                continue

            best = max(dets, key=lambda d: d["conf"])
            bx1, by1, bx2, by2 = [int(v) for v in best["bbox"]]
            h, w = img.shape[:2]
            pw = int((bx2 - bx1) * CROP_MARGIN)
            ph = int((by2 - by1) * CROP_MARGIN)
            cx1 = max(0, bx1 - pw); cy1 = max(0, by1 - ph)
            cx2 = min(w, bx2 + pw); cy2 = min(h, by2 + ph)
            crop = img[cy1:cy2, cx1:cx2]

            if crop.size == 0:
                failed += 1
                continue

            # ── Quality check ────────────────────────────────────────────────
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            sharp = _sharpness(gray)
            face_size = best.get("face_size", min(bx2 - bx1, by2 - by1))

            if sharp < MIN_SHARPNESS or face_size < MIN_FACE_PX:
                rejected_quality += 1
                print(f"[Pipeline] Enrollment: rejected crop (sharpness={sharp:.1f}, size={face_size}px)")
                continue

            # ── Translate landmarks from full-image coords → crop coords ─────
            # CRITICAL: best["landmarks"] are in full-image pixel space.
            # get_embedding() receives 'crop' which starts at (cx1, cy1).
            # _align_face() uses estimateAffinePartial2D against a 112x112
            # reference, so landmark coords must be relative to the crop origin.
            lm_full = best["landmarks"]
            lm_crop = [[lx - cx1, ly - cy1] for lx, ly in lm_full] if lm_full else []

            # ── Base embedding ───────────────────────────────────────────────
            base_emb = get_embedding(crop, lm_crop)
            all_embeddings.append(base_emb)

            # ── Augmentation: rotate ±15° + flip  ───────────────────────────
            # Augment the padded crop. Landmarks are already in crop coords.
            # For rotation augments: rotate landmarks too so alignment stays valid.
            for angle in (-15, 15):
                ch, cw = crop.shape[:2]
                M = cv2.getRotationMatrix2D((cw // 2, ch // 2), angle, 1.0)
                rot = cv2.warpAffine(crop, M, (cw, ch),
                                     flags=cv2.INTER_LANCZOS4,
                                     borderMode=cv2.BORDER_REFLECT)
                # Rotate landmark coords to match the rotated crop
                if lm_crop:
                    ones = np.ones((len(lm_crop), 1), dtype=np.float32)
                    lm_arr = np.hstack([np.array(lm_crop, dtype=np.float32), ones])
                    lm_rot = (M @ lm_arr.T).T.tolist()
                else:
                    lm_rot = []
                aug_emb = get_embedding(rot, lm_rot)
                all_embeddings.append(aug_emb)

            # Horizontal flip — mirror the crop-space landmarks across vertical axis
            flipped = cv2.flip(crop, 1)
            if lm_crop:
                cw_flip = crop.shape[1]
                lm_flip = [[cw_flip - lx, ly] for lx, ly in lm_crop]
            else:
                lm_flip = []
            flip_emb = get_embedding(flipped, lm_flip)
            all_embeddings.append(flip_emb)

        if not all_embeddings:
            msg = "No face detected"
            if rejected_quality:
                msg = (f"All {rejected_quality} photo(s) were rejected due to poor quality "
                       f"(blurry or face too small). Please use better lighting and hold "
                       f"still while capturing.")
            return {"error": msg, "accepted": 0, "failed": failed, "quality_rejected": rejected_quality}

        # Clamp to MAX_TEMPLATES (remove near-duplicates by picking well-spread embeddings)
        templates = all_embeddings[:MAX_TEMPLATES]

        # L2-normalise every template
        templates = [
            (t / np.linalg.norm(t)).astype(np.float32) if np.linalg.norm(t) > 1e-8 else t
            for t in templates
        ]

        student = db_session.query(models.Student).filter(models.Student.id == student_id).first()
        if student is None:
            return {"error": f"Student ID {student_id} not found.", "accepted": 0, "failed": failed}

        # Store multi-template in new column; also store average in old column for compat
        student.embeddings = json.dumps([t.tolist() for t in templates])
        avg = np.mean(templates, axis=0).astype(np.float32)
        norm = np.linalg.norm(avg)
        student.embedding = json.dumps((avg / norm if norm > 1e-8 else avg).tolist())

        db_session.commit()
        self.reload_index(db_session)

        photos_accepted = len(images) - failed - rejected_quality
        print(f"[Pipeline] Enrolled student {student_id}: "
              f"{photos_accepted} photos → {len(templates)} templates stored.")
        return {
            "accepted": photos_accepted,
            "failed": failed,
            "quality_rejected": rejected_quality,
            "templates_stored": len(templates),
        }

    # ── Burst recognition ───────────────────────────────────────────────────

    def process_burst(self, frames, db_session):
        """
        Process a burst of frames (typically 5) for attendance.

        For each frame:
          1. Detect all faces (SCRFD 1280 — handles large classrooms)
          2. Embed each face (GhostFaceNet)
          3. Match against multi-template index using max-cosine similarity
          4. Apply COSINE_THRESHOLD + MIN_MARGIN checks to prevent misidentification

        Vote system: a student must be positively identified in >= VOTE_THRESHOLD
        out of N frames to be marked present.
        """
        import models
        with self._lock:
            has_index    = (self._index_matrix is not None and len(self._index_ids) > 0)
            index_matrix = self._index_matrix.copy() if has_index else None
            index_ids    = list(self._index_ids)

        vote_sets     = [set() for _ in frames]
        frame_details = []

        for frame_idx, frame in enumerate(frames):
            dets = detect(frame)
            crops_and_lm, valid_dets = [], []
            h, w = frame.shape[:2]

            for det in dets:
                dx1, dy1, dx2, dy2 = [int(v) for v in det["bbox"]]
                pw = int((dx2 - dx1) * CROP_MARGIN)
                ph = int((dy2 - dy1) * CROP_MARGIN)
                cx1 = max(0, dx1 - pw); cy1 = max(0, dy1 - ph)
                cx2 = min(w, dx2 + pw); cy2 = min(h, dy2 + ph)
                crop = frame[cy1:cy2, cx1:cx2]
                if crop.size == 0:
                    continue
                # Translate landmarks from full-frame coords → crop coords
                # (same fix as enroll_student — get_embedding receives the crop,
                #  not the full frame, so landmark origin must match crop origin)
                lm_full = det["landmarks"]
                lm_crop = [[lx - cx1, ly - cy1] for lx, ly in lm_full] if lm_full else []
                crops_and_lm.append((crop, lm_crop))
                valid_dets.append(det)

            embeddings = get_embeddings_batch(crops_and_lm) if crops_and_lm else []
            face_results = []

            for i, emb in enumerate(embeddings):
                det = valid_dets[i]
                student_id, name, score = None, "Unknown", 0.0

                if has_index and index_matrix is not None:
                    sims = index_matrix @ emb  # cosine similarity against all templates

                    # For multi-template: choose the highest score per student
                    # Build a student_id → best_score dict
                    per_student: dict[int, float] = {}
                    for idx, sid in enumerate(index_ids):
                        s = float(sims[idx])
                        if s > per_student.get(sid, -1.0):
                            per_student[sid] = s

                    if not per_student:
                        pass
                    else:
                        ranked = sorted(per_student.items(), key=lambda kv: kv[1], reverse=True)
                        best_sid, best_score_v    = ranked[0]
                        second_score              = ranked[1][1] if len(ranked) > 1 else 0.0
                        margin                    = best_score_v - second_score

                        if best_score_v >= COSINE_THRESHOLD and margin >= MIN_MARGIN:
                            student_id = best_sid
                            score      = best_score_v
                            name       = f"student_{student_id}"
                            vote_sets[frame_idx].add(student_id)

                x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
                face_results.append({
                    "bbox":         [x1, y1, x2, y2],
                    "conf":         round(det["conf"], 3),
                    "face_size":    det.get("face_size", 0),
                    "name":         name,
                    "student_id":   student_id,
                    "score":        round(score, 3),
                })

            frame_details.append({
                "frame_index":    frame_idx,
                "faces_detected": len(face_results),
                "faces":          face_results,
            })
            del frame, dets, crops_and_lm, embeddings, face_results
            gc.collect()

        vote_counts = {}
        for fs in vote_sets:
            for sid in fs:
                vote_counts[sid] = vote_counts.get(sid, 0) + 1

        confirmed_ids = [sid for sid, c in vote_counts.items() if c >= VOTE_THRESHOLD]
        confirmed_students = []

        if confirmed_ids:
            students = db_session.query(models.Student).filter(
                models.Student.id.in_(confirmed_ids)
            ).all()
            id_to_name = {s.id: s.name for s in students}

            for fd in frame_details:
                for face in fd["faces"]:
                    if face["student_id"] in id_to_name:
                        face["name"] = id_to_name[face["student_id"]]

            for s in students:
                s.current_status = models.StatusEnum.present
                db_session.add(models.AttendanceRecord(
                    student_id=s.id,
                    status=models.StatusEnum.present,
                ))
                confirmed_students.append({
                    "student_id": s.id,
                    "name":       s.name,
                    "votes":      vote_counts[s.id],
                    "out_of":     len(frames),
                })
            db_session.commit()

        return {
            "confirmed":     confirmed_students,
            "total_marked":  len(confirmed_students),
            "frame_details": frame_details,
            "vote_counts":   {str(k): v for k, v in vote_counts.items()},
        }

    def warmup(self):
        from vision.detector   import warmup as dw
        from vision.recognizer import warmup as rw
        dw(); rw()
        print("[Pipeline] All models warmed up and ready.")


pipeline = VisionPipeline()