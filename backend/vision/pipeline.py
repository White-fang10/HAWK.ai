# vision/pipeline.py
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import base64, gc, json, threading, cv2, numpy as np
from vision.detector   import detect_tiled, detect_tiled_enhanced, MIN_FACE_PX
from vision.recognizer import get_embedding, get_embeddings_batch

# ── Recognition thresholds ───────────────────────────────────────────────────
# Gamma-lift + adaptive CLAHE produces cleaner crops → embeddings are more reliable.
# Cosine threshold lowered slightly to accept good matches from dark/backlit faces.
COSINE_THRESHOLD = float(os.getenv("COSINE_THRESH", "0.28"))  # relaxed from 0.32
MIN_MARGIN       = float(os.getenv("MIN_MARGIN",    "0.04"))  # relaxed from 0.06 — avoid dropping valid marginal matches
VOTE_THRESHOLD   = int(os.getenv("VOTE_THRESH",      "1"))    # 1 strong frame is enough to confirm
CROP_MARGIN      = 0.20

# ── Enrollment quality thresholds ───────────────────────────────────────────
MIN_SHARPNESS = 40.0      # minimum Laplacian variance for an acceptable enrollment crop
MAX_TEMPLATES = 15

# ── Preview JPEG quality (base64 frames sent to frontend) ────────────────────
PREVIEW_JPEG_QUALITY = 75   # 0‑100; 75 ≈ good balance size vs. quality


# ── Quality helpers ───────────────────────────────────────────────────────────

def _sharpness(img_gray: np.ndarray) -> float:
    return float(cv2.Laplacian(img_gray, cv2.CV_64F).var())


def _augment_crop(aligned: np.ndarray) -> list[np.ndarray]:
    h, w = aligned.shape[:2]
    cx, cy = w // 2, h // 2
    variants = [aligned]

    for angle in (-15, 15):
        M = cv2.getRotationMatrix2D((cx, cy), angle, 1.0)
        rotated = cv2.warpAffine(aligned, M, (w, h), flags=cv2.INTER_LANCZOS4,
                                 borderMode=cv2.BORDER_REFLECT)
        variants.append(rotated)

    variants.append(cv2.flip(aligned, 1))
    return variants


# ── Preview helpers ───────────────────────────────────────────────────────────

def _draw_bboxes(frame: np.ndarray, face_results: list[dict]) -> np.ndarray:
    """
    Draw bounding boxes on a copy of the frame.
    Teal  = recognised student (with confidence %)
    Orange = unknown face
    Returns the annotated copy.
    """
    vis = frame.copy()
    for face in face_results:
        x1, y1, x2, y2 = [int(v) for v in face["bbox"]]
        identified = face.get("student_id") is not None
        color = (39, 210, 140) if identified else (30, 140, 255)   # BGR: teal / amber
        thick = 2

        cv2.rectangle(vis, (x1, y1), (x2, y2), color, thick)

        if identified:
            conf_pct = int(face.get("score", 0) * 100)
            label    = f"{face.get('name', 'Unknown')}  {conf_pct}%"
        else:
            label = "Unknown"

        # Badge background — slightly above the top of the box
        font       = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.48
        font_thick = 1
        (tw, th), baseline = cv2.getTextSize(label, font, font_scale, font_thick)
        pad = 4
        bgy1 = max(0, y1 - th - pad * 2)
        bgy2 = y1
        bgx2 = min(frame.shape[1], x1 + tw + pad * 2)
        cv2.rectangle(vis, (x1, bgy1), (bgx2, bgy2), color, cv2.FILLED)
        cv2.putText(
            vis, label, (x1 + pad, bgy2 - pad),
            font, font_scale, (255, 255, 255), font_thick, cv2.LINE_AA
        )

    return vis


def _frame_to_b64(frame: np.ndarray, quality: int = PREVIEW_JPEG_QUALITY) -> str:
    """Encode a BGR frame as base64 JPEG string for JSON transport."""
    # Downscale very large enhanced frames for the preview (cap at 1920 wide)
    h, w = frame.shape[:2]
    if w > 1920:
        scale = 1920 / w
        frame = cv2.resize(frame, (1920, int(h * scale)), interpolation=cv2.INTER_AREA)

    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return ""
    return base64.b64encode(buf).decode("utf-8")


# ── VisionPipeline ────────────────────────────────────────────────────────────

class VisionPipeline:
    def __init__(self):
        self._lock          = threading.Lock()
        self._index_ids     = []
        self._index_matrix  = None

    # ── Index management ────────────────────────────────────────────────────

    def reload_index(self, db_session):
        import models
        students = db_session.query(models.Student).filter(
            (models.Student.embeddings.isnot(None)) | (models.Student.embedding.isnot(None))
        ).all()

        ids, embeds = [], []
        for s in students:
            try:
                templates = []

                if s.embeddings:
                    raw = json.loads(s.embeddings)
                    for arr in raw:
                        emb = np.array(arr, dtype=np.float32)
                        if emb.shape == (512,):
                            norm = np.linalg.norm(emb)
                            if norm > 1e-8:
                                templates.append(emb / norm)

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
        import models
        all_embeddings, failed, rejected_quality = [], 0, 0

        for img in images:
            if img is None:
                failed += 1
                continue

            from vision.detector import detect_tiled_enhanced
            # Use SR-enhanced detection for enrollment too — same pipeline as inference
            enroll_enhanced, dets, _ = detect_tiled_enhanced(img)
            if not dets:
                failed += 1
                continue

            best = max(dets, key=lambda d: d["conf"])
            bx1, by1, bx2, by2 = [int(v) for v in best["bbox"]]
            h, w = enroll_enhanced.shape[:2]
            pw = int((bx2 - bx1) * CROP_MARGIN)
            ph = int((by2 - by1) * CROP_MARGIN)
            cx1 = max(0, bx1 - pw); cy1 = max(0, by1 - ph)
            cx2 = min(w, bx2 + pw); cy2 = min(h, by2 + ph)
            crop = enroll_enhanced[cy1:cy2, cx1:cx2]

            if crop.size == 0:
                failed += 1
                continue

            gray  = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            sharp = _sharpness(gray)
            face_size = best.get("face_size", min(bx2 - bx1, by2 - by1))

            if sharp < MIN_SHARPNESS or face_size < MIN_FACE_PX:
                rejected_quality += 1
                print(f"[Pipeline] Enrollment: rejected crop (sharpness={sharp:.1f}, size={face_size}px)")
                continue

            lm_full = best["landmarks"]
            lm_crop = [[lx - cx1, ly - cy1] for lx, ly in lm_full] if lm_full else []

            raw_width = best.get("raw_width", 9999)
            base_emb  = get_embedding(crop, lm_crop, raw_width)
            all_embeddings.append(base_emb)

            for angle in (-15, 15):
                ch, cw = crop.shape[:2]
                M = cv2.getRotationMatrix2D((cw // 2, ch // 2), angle, 1.0)
                rot = cv2.warpAffine(crop, M, (cw, ch),
                                     flags=cv2.INTER_LANCZOS4,
                                     borderMode=cv2.BORDER_REFLECT)
                if lm_crop:
                    ones   = np.ones((len(lm_crop), 1), dtype=np.float32)
                    lm_arr = np.hstack([np.array(lm_crop, dtype=np.float32), ones])
                    lm_rot = (M @ lm_arr.T).T.tolist()
                else:
                    lm_rot = []
                aug_emb = get_embedding(rot, lm_rot, raw_width)
                all_embeddings.append(aug_emb)

            flipped = cv2.flip(crop, 1)
            if lm_crop:
                cw_flip = crop.shape[1]
                lm_flip = [[cw_flip - lx, ly] for lx, ly in lm_crop]
            else:
                lm_flip = []
            flip_emb = get_embedding(flipped, lm_flip, raw_width)
            all_embeddings.append(flip_emb)

        if not all_embeddings:
            msg = "No face detected"
            if rejected_quality:
                msg = (
                    f"All {rejected_quality} photo(s) were rejected due to poor quality "
                    f"(blurry or face too small). Please use better lighting and hold "
                    f"still while capturing."
                )
            return {"error": msg, "accepted": 0, "failed": failed, "quality_rejected": rejected_quality}

        templates = all_embeddings[:MAX_TEMPLATES]
        templates = [
            (t / np.linalg.norm(t)).astype(np.float32) if np.linalg.norm(t) > 1e-8 else t
            for t in templates
        ]

        student = db_session.query(models.Student).filter(models.Student.id == student_id).first()
        if student is None:
            return {"error": f"Student ID {student_id} not found.", "accepted": 0, "failed": failed}

        student.embeddings = json.dumps([t.tolist() for t in templates])
        avg  = np.mean(templates, axis=0).astype(np.float32)
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
        Process a burst of frames for attendance.

        Pipeline per frame:
          1. Real-ESRGAN x4 → 2× frame  (720p→1440p, 1080p→2160p)
          2. Tiled SCRFD on enhanced frame
          3. Per-face: if raw_width < threshold → Real-ESRGAN on crop too
          4. GhostFaceNet embedding → match → vote

        Returns the standard attendance result PLUS:
          frame_details[i].preview_b64  — base64 JPEG of enhanced frame with bboxes drawn
          frame_details[i].enhanced     — True if frame was SR-enhanced
        """
        import models
        with self._lock:
            has_index    = (self._index_matrix is not None and len(self._index_ids) > 0)
            index_matrix = self._index_matrix.copy() if has_index else None
            index_ids    = list(self._index_ids)

        vote_sets     = [set() for _ in frames]
        frame_details = []

        for frame_idx, raw_frame in enumerate(frames):
            # ── Step 1+2: SR-enhance frame, detect faces ──────────────────
            enhanced_frame, dets, frame_was_enhanced = detect_tiled_enhanced(raw_frame)

            crops_and_lm, valid_dets = [], []
            h_enh, w_enh = enhanced_frame.shape[:2]

            for det in dets:
                dx1, dy1, dx2, dy2 = [int(v) for v in det["bbox"]]
                pw  = int((dx2 - dx1) * CROP_MARGIN)
                ph  = int((dy2 - dy1) * CROP_MARGIN)
                cx1 = max(0, dx1 - pw); cy1 = max(0, dy1 - ph)
                cx2 = min(w_enh, dx2 + pw); cy2 = min(h_enh, dy2 + ph)
                crop = enhanced_frame[cy1:cy2, cx1:cx2]
                if crop.size == 0:
                    continue

                # ── Step 3: face-level SR for very small faces ─────────────
                raw_width    = det.get("raw_width", 9999)
                lm_full      = det.get("landmarks")
                lm_crop_orig = [[lx - cx1, ly - cy1] for lx, ly in lm_full] if lm_full else []

                from vision.enhancer import enhance_face
                crop, face_was_enhanced = enhance_face(crop, raw_width)

                # When the crop is SR-enlarged, landmarks need rescaling
                if face_was_enhanced and lm_crop_orig:
                    orig_h = cy2 - cy1
                    orig_w = cx2 - cx1
                    new_h, new_w = crop.shape[:2]
                    sx = new_w / max(orig_w, 1)
                    sy = new_h / max(orig_h, 1)
                    lm_crop = [[lx * sx, ly * sy] for lx, ly in lm_crop_orig]
                else:
                    lm_crop = lm_crop_orig

                det["face_enhanced"] = face_was_enhanced
                crops_and_lm.append((crop, lm_crop, raw_width))
                valid_dets.append(det)

            # ── Step 4: batch embedding + matching ────────────────────────
            embeddings   = get_embeddings_batch(crops_and_lm) if crops_and_lm else []
            face_results = []

            for i, emb in enumerate(embeddings):
                det        = valid_dets[i]
                student_id = None
                name       = "Unknown"
                score      = 0.0

                if has_index and index_matrix is not None:
                    sims       = index_matrix @ emb
                    per_student: dict[int, float] = {}
                    for idx, sid in enumerate(index_ids):
                        s = float(sims[idx])
                        if s > per_student.get(sid, -1.0):
                            per_student[sid] = s

                    if per_student:
                        ranked       = sorted(per_student.items(), key=lambda kv: kv[1], reverse=True)
                        best_sid, best_score_v = ranked[0]
                        second_score = ranked[1][1] if len(ranked) > 1 else 0.0
                        margin       = best_score_v - second_score

                        # ── Debug: always log top scores so threshold can be tuned ──
                        top_scores_str = ", ".join(
                            f"s{sid}={sv:.3f}" for sid, sv in ranked[:3]
                        )
                        print(
                            f"[Pipeline] Face {i} | size={det.get('face_size',0)}px "
                            f"| best={best_score_v:.3f} margin={margin:.3f} "
                            f"| thresh={COSINE_THRESHOLD} min_margin={MIN_MARGIN} "
                            f"| top3=[{top_scores_str}] "
                            f"| {'MATCH ✓' if best_score_v >= COSINE_THRESHOLD and margin >= MIN_MARGIN else 'NO MATCH ✗'}"
                        )

                        if best_score_v >= COSINE_THRESHOLD and margin >= MIN_MARGIN:
                            student_id = best_sid
                            score      = best_score_v
                            name       = f"student_{student_id}"
                            vote_sets[frame_idx].add(student_id)
                    else:
                        print(f"[Pipeline] Face {i} | index empty — no students enrolled")

                x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
                face_results.append({
                    "bbox":          [x1, y1, x2, y2],
                    "conf":          round(det["conf"], 3),
                    "face_size":     det.get("face_size", 0),
                    "name":          name,
                    "student_id":    student_id,
                    "score":         round(score, 3),
                    "face_enhanced": det.get("face_enhanced", False),
                })

            # ── Build annotated preview ───────────────────────────────────
            annotated   = _draw_bboxes(enhanced_frame, face_results)
            preview_b64 = _frame_to_b64(annotated)

            frame_details.append({
                "frame_index":    frame_idx,
                "faces_detected": len(face_results),
                "faces":          face_results,
                "enhanced":       frame_was_enhanced,
                "preview_b64":    preview_b64,
            })

            del raw_frame, enhanced_frame, dets, crops_and_lm, embeddings, face_results
            gc.collect()

        # ── Voting ────────────────────────────────────────────────────────
        vote_counts = {}
        for fs in vote_sets:
            for sid in fs:
                vote_counts[sid] = vote_counts.get(sid, 0) + 1

        confirmed_ids      = [sid for sid, c in vote_counts.items() if c >= VOTE_THRESHOLD]
        confirmed_students = []

        if confirmed_ids:
            students   = db_session.query(models.Student).filter(
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

    # ── Smart burst: col×row grid with sharpness selection ─────────────────

    def process_burst_smart(self, frames: list, db_session, zone_metadata: list | None = None):
        """
        Enhanced burst processor for the col×row scanning grid.

        zone_metadata (one entry per frame):
          {
            col:          int   — column index (1..N_COLS)
            row:          int   — row index (1..N_ROWS,  1=front/near)
            row_label:    str   — "front"|"mid"|"back"
            center_x_pct: float — horizontal crop centre 0–1
            center_y_pct: float — vertical   crop centre 0–1
            zoom_factor:  float — zoom ratio used (1.0 = wide, 3.0 = 3×…)
            zoom_method:  str   — "adb"|"onvif"|"software"
            is_wide:      bool  — True only for the initial wide shot
          }

        Smart additions vs process_burst():
          • Sharpness-guided frame selection: within each (col,row) group
            only the top-2 sharpest frames are sent to the recogniser.
          • Software-zoom frames: enhance_crop_for_zoom() is applied to
            the extracted column strip before SCRFD to recover SR detail.
          • Wide frames: processed normally (full-frame tiled detect),
            their detections stored separately in the result.
        """
        from vision.enhancer import sharpness_score, enhance_crop_for_zoom

        if zone_metadata is None:
            zone_metadata = [
                {"col": 1, "row": 1, "row_label": "near", "center_x_pct": 0.5,
                 "center_y_pct": 0.5, "zoom_factor": 1.0, "zoom_method": "software",
                 "is_wide": False}
                for _ in frames
            ]

        # ── Group frames by (col, row) zone ───────────────────────────────
        # Zone key: (col, row) or "wide" for wide-shot frames
        from collections import defaultdict
        zone_groups: dict = defaultdict(list)  # key → [(frame_idx, frame, meta)]
        for i, (frame, meta) in enumerate(zip(frames, zone_metadata)):
            if meta.get("is_wide", False):
                key = "wide"
            else:
                key = (meta.get("col", 1), meta.get("row", 1))
            zone_groups[key].append((i, frame, meta))

        # ── Select best frames per zone by sharpness ──────────────────────
        TOP_N_PER_ZONE = 2   # keep 2 sharpest frames per zone for recognition
        selected_indices: list[int] = []
        for key, group in zone_groups.items():
            if key == "wide":
                # Include all wide frames
                selected_indices.extend(idx for idx, _, _ in group)
                continue
            # Score each frame
            scored = [(idx, frame, meta, sharpness_score(frame)) for idx, frame, meta in group]
            scored.sort(key=lambda t: t[3], reverse=True)
            selected_indices.extend(idx for idx, _, _, _ in scored[:TOP_N_PER_ZONE])

        selected_indices.sort()  # maintain temporal order

        # ── Build filtered lists ───────────────────────────────────────────
        sel_frames = [frames[i] for i in selected_indices]
        sel_meta   = [zone_metadata[i] for i in selected_indices]

        # ── Recognition ───────────────────────────────────────────────────
        with self._lock:
            has_index    = (self._index_matrix is not None and len(self._index_ids) > 0)
            index_matrix = self._index_matrix.copy() if has_index else None
            index_ids    = list(self._index_ids)

        import models, gc
        vote_sets     = [set() for _ in sel_frames]
        frame_details = []

        for frame_idx, (raw_frame, meta) in enumerate(zip(sel_frames, sel_meta)):
            is_wide       = meta.get("is_wide", False)
            zoom_factor   = meta.get("zoom_factor", 1.0)
            zoom_method   = meta.get("zoom_method", "software")
            center_x_pct  = meta.get("center_x_pct", 0.5)
            center_y_pct  = meta.get("center_y_pct", 0.5)

            # ── Frame preprocessing ────────────────────────────────────────
            if is_wide or zoom_method in ("adb", "onvif"):
                # Full-frame SR enhance for wide shots and hardware-zoom frames
                enhanced_frame, dets, frame_was_enhanced = detect_tiled_enhanced(raw_frame)
            else:
                # Software zoom: pre-SR the column crop region before detection
                fh, fw = raw_frame.shape[:2]
                zoom_c  = max(1.0, zoom_factor)
                cw_px   = int(fw / zoom_c)
                ch_px   = int(fh / zoom_c)
                cx_off  = max(0, min(fw - cw_px, int(fw * center_x_pct - cw_px / 2)))
                cy_off  = max(0, min(fh - ch_px, int(fh * center_y_pct - ch_px / 2)))
                col_crop = raw_frame[cy_off: cy_off + ch_px, cx_off: cx_off + cw_px]

                # SR-upscale the crop, then detect on the upscaled crop
                sr_crop, _ = enhance_crop_for_zoom(col_crop, zoom_factor)
                enhanced_frame, dets, frame_was_enhanced = detect_tiled_enhanced(sr_crop)

            crops_and_lm, valid_dets = [], []
            h_enh, w_enh = enhanced_frame.shape[:2]

            for det in dets:
                dx1, dy1, dx2, dy2 = [int(v) for v in det["bbox"]]
                pw  = int((dx2 - dx1) * CROP_MARGIN)
                ph  = int((dy2 - dy1) * CROP_MARGIN)
                cx1 = max(0, dx1 - pw); cy1 = max(0, dy1 - ph)
                cx2 = min(w_enh, dx2 + pw); cy2 = min(h_enh, dy2 + ph)
                crop = enhanced_frame[cy1:cy2, cx1:cx2]
                if crop.size == 0:
                    continue

                raw_width    = det.get("raw_width", 9999)
                lm_full      = det.get("landmarks")
                lm_crop_orig = [[lx - cx1, ly - cy1] for lx, ly in lm_full] if lm_full else []

                from vision.enhancer import enhance_face
                crop, face_was_enhanced = enhance_face(crop, raw_width)

                if face_was_enhanced and lm_crop_orig:
                    orig_h = cy2 - cy1; orig_w = cx2 - cx1
                    new_h, new_w = crop.shape[:2]
                    sx = new_w / max(orig_w, 1); sy = new_h / max(orig_h, 1)
                    lm_crop = [[lx * sx, ly * sy] for lx, ly in lm_crop_orig]
                else:
                    lm_crop = lm_crop_orig

                det["face_enhanced"] = face_was_enhanced
                crops_and_lm.append((crop, lm_crop, raw_width))
                valid_dets.append(det)

            # ── Batch embedding + matching ─────────────────────────────────
            embeddings   = get_embeddings_batch(crops_and_lm) if crops_and_lm else []
            face_results = []

            for i, emb in enumerate(embeddings):
                det        = valid_dets[i]
                student_id = None
                name       = "Unknown"
                score      = 0.0

                if has_index and index_matrix is not None:
                    sims        = index_matrix @ emb
                    per_student: dict[int, float] = {}
                    for idx, sid in enumerate(index_ids):
                        s = float(sims[idx])
                        if s > per_student.get(sid, -1.0):
                            per_student[sid] = s

                    if per_student:
                        ranked       = sorted(per_student.items(), key=lambda kv: kv[1], reverse=True)
                        best_sid, best_score_v = ranked[0]
                        second_score = ranked[1][1] if len(ranked) > 1 else 0.0
                        margin       = best_score_v - second_score

                        if best_score_v >= COSINE_THRESHOLD and margin >= MIN_MARGIN:
                            student_id = best_sid
                            score      = best_score_v
                            name       = f"student_{student_id}"
                            vote_sets[frame_idx].add(student_id)

                x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
                face_results.append({
                    "bbox":          [x1, y1, x2, y2],
                    "conf":          round(det["conf"], 3),
                    "face_size":     det.get("face_size", 0),
                    "name":          name,
                    "student_id":    student_id,
                    "score":         round(score, 3),
                    "face_enhanced": det.get("face_enhanced", False),
                })

            annotated   = _draw_bboxes(enhanced_frame, face_results)
            preview_b64 = _frame_to_b64(annotated)

            frame_details.append({
                "frame_index":    frame_idx,
                "original_index": selected_indices[frame_idx],
                "faces_detected": len(face_results),
                "faces":          face_results,
                "enhanced":       frame_was_enhanced,
                "preview_b64":    preview_b64,
                "zone_col":       meta.get("col"),
                "zone_row":       meta.get("row"),
                "zone_row_label": meta.get("row_label", ""),
                "zoom_method":    zoom_method,
                "zoom_factor":    zoom_factor,
                "is_wide":        is_wide,
            })

            del raw_frame, enhanced_frame, dets, crops_and_lm, embeddings, face_results
            gc.collect()

        # ── Voting ─────────────────────────────────────────────────────────
        vote_counts = {}
        for fs in vote_sets:
            for sid in fs:
                vote_counts[sid] = vote_counts.get(sid, 0) + 1

        confirmed_ids      = [sid for sid, c in vote_counts.items() if c >= VOTE_THRESHOLD]
        confirmed_students = []

        if confirmed_ids:
            students   = db_session.query(models.Student).filter(
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
                    "out_of":     len(sel_frames),
                })
            db_session.commit()

        return {
            "confirmed":          confirmed_students,
            "total_marked":       len(confirmed_students),
            "frame_details":      frame_details,
            "vote_counts":        {str(k): v for k, v in vote_counts.items()},
            "frames_selected":    len(sel_frames),
            "frames_received":    len(frames),
            "sharpness_filtered": len(frames) - len(sel_frames),
        }

    def warmup(self):
        from vision.detector   import warmup as dw
        from vision.recognizer import warmup as rw
        dw(); rw()
        print("[Pipeline] All models warmed up and ready.")


pipeline = VisionPipeline()