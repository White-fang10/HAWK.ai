import cv2
import numpy as np
import threading
import time
import json
from sqlalchemy.orm import Session
from ultralytics import YOLO
from insightface.app import FaceAnalysis
import faiss
from database import SessionLocal
from models import Student


def _apply_clahe_bilateral(frame: np.ndarray) -> np.ndarray:
    """
    Apply bilateral filter (denoising) then CLAHE (contrast boost) to a BGR frame.

    - Bilateral filter removes low-light grain while preserving face edges.
    - CLAHE on the Y (luminance) channel boosts contrast on dark/distant faces
      without amplifying the grain that bilateral already removed.
    """
    # Step 1: Denoise — keeps edges (faces) sharp, kills grain
    denoised = cv2.bilateralFilter(frame, d=9, sigmaColor=75, sigmaSpace=75)

    # Step 2: CLAHE on luminance channel only
    ycrcb = cv2.cvtColor(denoised, cv2.COLOR_BGR2YCrCb)
    y, cr, cb = cv2.split(ycrcb)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    y_eq = clahe.apply(y)
    ycrcb_eq = cv2.merge([y_eq, cr, cb])
    enhanced = cv2.cvtColor(ycrcb_eq, cv2.COLOR_YCrCb2BGR)
    return enhanced


def _blur_variance(face_crop: np.ndarray) -> float:
    """Laplacian variance — lower = blurrier. Used to skip recognition on blurry crops."""
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
    return cv2.Laplacian(gray, cv2.CV_64F).var()


class VisionPipeline:
    def __init__(self):
        self.lock = threading.Lock()
        self.frame_data = {
            "detected": 0,
            "recognized": [],
            "unknown": 0,
            "timestamp": time.strftime('%H:%M:%S'),
            "faces": [],
            "frame_width": 640,
            "frame_height": 360,
        }
        self.running = False
        self.thread = None
        self.cap = None
        self.rtsp_url = None
        self.camera_available = False
        self.latest_frame = None  # Latest annotated frame for MJPEG streaming

        # Consecutive recognition frames needed to be "confirmed" present
        self.CONSECUTIVE_FRAMES_REQUIRED = 2
        self.consecutive_counts: dict[int, int] = {}

        # Throttle DB writes: only update a student if not updated in last N seconds
        self.DB_WRITE_INTERVAL = 30  # seconds
        self._last_db_write: dict[int, float] = {}

        # ── Recognition tuning ──────────────────────────────────────────────
        # At 0.40, only confident matches go through. Better to show "Unknown"
        # than to mark the wrong student present (false positives).
        self.COSINE_THRESHOLD = 0.40

        # Laplacian variance below this = face crop too blurry for recognition.
        # Skip FAISS search and label as "Unknown" to avoid wrong matches.
        self.BLUR_THRESHOLD = 30.0

        # Load YOLO model (kept for compatibility, not used in frame processing)
        print("Loading YOLOv8 model (standby)...")
        try:
            import torch
            import ultralytics.nn.tasks
            if hasattr(torch.serialization, 'add_safe_globals'):
                torch.serialization.add_safe_globals([
                    ultralytics.nn.tasks.DetectionModel,
                ])
            _orig_load = torch.load
            def _patched_load(f, *args, **kwargs):
                if 'weights_only' not in kwargs:
                    kwargs['weights_only'] = False
                return _orig_load(f, *args, **kwargs)
            torch.load = _patched_load
        except Exception as e:
            print(f"PyTorch compat patch skipped: {e}")

        try:
            self.yolo_model = YOLO("yolov8n-face.pt")
            print("Loaded yolov8n-face.pt (standby)")
        except Exception as e:
            try:
                self.yolo_model = YOLO("yolov8n.pt")
                print("Loaded yolov8n.pt (standby)")
            except Exception as e2:
                print(f"WARNING: Could not load any YOLO model: {e2}")
                self.yolo_model = None

        # ── InsightFace buffalo_l (ResNet50) ────────────────────────────────
        # buffalo_l is the heavy-duty model — essential for long-distance recognition.
        # det_size=(1280,1280): larger detection grid → better at finding small distant faces.
        # det_thresh=0.25: slightly lower than default to catch more marginal distant detections,
        #   but NOT so low that it floods the pipeline with noise.
        print("Loading InsightFace buffalo_l model...")
        try:
            self.face_app = FaceAnalysis(name="buffalo_l", providers=['CPUExecutionProvider'])
            self.face_app.prepare(ctx_id=0, det_size=(1280, 1280), det_thresh=0.25)
            print("InsightFace buffalo_l loaded (det_size=1280x1280, det_thresh=0.25).")
        except Exception as e:
            print(f"ERROR loading InsightFace: {e}")
            self.face_app = None

        # ── FAISS index (cosine similarity via L2-normalised inner product) ──
        self.index = None
        self.student_ids = []
        self.student_names = {}
        self.target_dim = 512  # buffalo_l embedding dimension

        self.reload_faiss_index()

    # ────────────────────────────────────────────────────────────────────────
    # FAISS / Embedding helpers
    # ────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _normalize(emb: np.ndarray) -> np.ndarray:
        norm = np.linalg.norm(emb)
        return emb if norm == 0 else emb / norm

    def reload_faiss_index(self):
        """Rebuild FAISS IndexFlatIP from DB — called on startup and after training."""
        db = SessionLocal()
        try:
            students = db.query(Student).filter(Student.embedding != None).all()
            if not students:
                self.index = faiss.IndexFlatIP(self.target_dim)
                self.student_ids = []
                self.student_names = {}
                print("FAISS index initialized (empty — no trained faces yet).")
                return

            embeddings = []
            self.student_ids = []
            self.student_names = {}

            for s in students:
                try:
                    emb = np.array(json.loads(s.embedding), dtype="float32")
                    emb = self._normalize(emb)
                    embeddings.append(emb)
                    self.student_ids.append(s.id)
                    self.student_names[s.id] = s.name
                except Exception as e:
                    print(f"Error loading embedding for student {s.id}: {e}")

            if embeddings:
                embeddings_np = np.array(embeddings).astype("float32")
                self.index = faiss.IndexFlatIP(self.target_dim)
                self.index.add(embeddings_np)
                print(f"FAISS index reloaded with {len(self.student_ids)} face(s).")
            else:
                self.index = faiss.IndexFlatIP(self.target_dim)
        except Exception as e:
            print(f"FAISS reload error: {e}")
            self.index = faiss.IndexFlatIP(self.target_dim)
        finally:
            db.close()

    def extract_embedding(self, image_np: np.ndarray):
        """
        Extract a normalised face embedding for training.
        Applies preprocessing and tries multiple resolutions.
        """
        if self.face_app is None:
            return None
        try:
            enhanced = _apply_clahe_bilateral(image_np)
            faces = self.face_app.get(enhanced)
            if len(faces) == 0:
                resized = cv2.resize(enhanced, (1280, 1280))
                faces = self.face_app.get(resized)
            if len(faces) == 0:
                return None
            # Use the largest detected face
            faces = sorted(
                faces,
                key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]),
                reverse=True
            )
            raw_emb = faces[0].embedding.astype("float32")
            return self._normalize(raw_emb)
        except Exception as e:
            print(f"Embedding extraction error: {e}")
            return None

    # ────────────────────────────────────────────────────────────────────────
    # Core frame processing
    # ────────────────────────────────────────────────────────────────────────

    def process_frame(self, frame: np.ndarray):
        """
        Process a single frame:
          1. Bilateral filter + CLAHE preprocessing
          2. Upscale detection frame (detection only — embeddings from original crop)
          3. InsightFace detection (buffalo_l RetinaFace)
          4. Blur-check each face crop — skip recognition if too blurry
          5. FAISS cosine similarity search (threshold = 0.40)
          6. Draw annotated overlay on display frame
          7. Return (annotated_frame, stats_with_face_boxes)

        Returns: (annotated_frame, stats_dict)
        """
        recognized_names = []
        recognized_student_ids = []
        unknown_count = 0
        detected_count = 0
        face_boxes = []  # list of dicts for frontend overlay

        display_frame = frame.copy()
        orig_h, orig_w = frame.shape[:2]

        if self.face_app is not None:
            # ── Step 1: Preprocess ──────────────────────────────────────────
            enhanced = _apply_clahe_bilateral(frame)

            # ── Step 2: Upscale for detection only ─────────────────────────
            # Scale to 1.5× (capped at 1920×1080) so the detector sees larger faces.
            # Embeddings will be extracted from the ORIGINAL frame crop, not the
            # upscaled one, to avoid stretching artifacts corrupting the embedding.
            target_w = min(int(orig_w * 1.5), 1920)
            target_h = min(int(orig_h * 1.5), 1080)
            scale_x = target_w / orig_w
            scale_y = target_h / orig_h
            det_frame = cv2.resize(enhanced, (target_w, target_h), interpolation=cv2.INTER_LINEAR)

            # ── Step 3: Face detection ──────────────────────────────────────
            faces = self.face_app.get(det_frame)
            detected_count = len(faces)

            if detected_count > 0:
                font = cv2.FONT_HERSHEY_SIMPLEX

                # Prepare batch embeddings from FAISS if index has data
                has_index = self.index is not None and self.index.ntotal > 0

                for face in faces:
                    # Scale bbox back to original frame coordinates
                    bx1 = int(face.bbox[0] / scale_x)
                    by1 = int(face.bbox[1] / scale_y)
                    bx2 = int(face.bbox[2] / scale_x)
                    by2 = int(face.bbox[3] / scale_y)

                    # Clamp to frame bounds
                    bx1 = max(0, min(orig_w - 1, bx1))
                    by1 = max(0, min(orig_h - 1, by1))
                    bx2 = max(bx1 + 1, min(orig_w, bx2))
                    by2 = max(by1 + 1, min(orig_h, by2))

                    name = "Unknown"
                    is_known = False

                    if has_index:
                        # ── Step 4: Blur check (on ORIGINAL frame crop) ─────
                        face_crop = frame[by1:by2, bx1:bx2]
                        blur_score = _blur_variance(face_crop) if face_crop.size > 0 else 0.0

                        if blur_score < self.BLUR_THRESHOLD:
                            # Face is too blurry — don't attempt recognition.
                            # Safer to show Unknown than risk a false positive.
                            print(f"[BLUR] Face crop blur={blur_score:.1f} < {self.BLUR_THRESHOLD} → skipping recognition")
                        else:
                            # ── Step 5: Recognition ─────────────────────────
                            raw_emb = face.embedding.astype("float32")
                            norm = np.linalg.norm(raw_emb)
                            emb = (raw_emb / norm if norm > 0 else raw_emb).reshape(1, -1)
                            D, I = self.index.search(emb, 1)
                            sim = D[0][0]
                            idx = I[0][0]

                            if sim >= self.COSINE_THRESHOLD and idx != -1:
                                student_id = self.student_ids[idx]
                                name = self.student_names.get(student_id, "Unknown")
                                is_known = True
                                recognized_names.append(name)
                                recognized_student_ids.append(student_id)

                    if not is_known:
                        unknown_count += 1

                    # ── Step 6: Draw on display frame ───────────────────────
                    color = (33, 188, 100) if is_known else (60, 80, 251)  # green / red-ish
                    cv2.rectangle(display_frame, (bx1, by1), (bx2, by2), color, 2)
                    if name:
                        (tw, th), _ = cv2.getTextSize(name, font, 0.55, 1)
                        label_y = max(0, by1 - th - 8)
                        cv2.rectangle(display_frame, (bx1, label_y), (bx1 + tw + 8, by1), color, -1)
                        cv2.putText(
                            display_frame, name,
                            (bx1 + 4, max(th + 4, by1 - 4)),
                            font, 0.55, (255, 255, 255), 1, cv2.LINE_AA
                        )

                    face_boxes.append({
                        "x1": bx1, "y1": by1, "x2": bx2, "y2": by2,
                        "name": name,
                        "known": is_known,
                    })
            else:
                # No faces even with upscaling — nothing to draw
                pass

        # ── Consecutive-frames confirmation → DB write ──────────────────────
        current_seen_ids = set(recognized_student_ids)
        for sid in current_seen_ids:
            self.consecutive_counts[sid] = self.consecutive_counts.get(sid, 0) + 1
        for sid in list(self.consecutive_counts.keys()):
            if sid not in current_seen_ids:
                self.consecutive_counts[sid] = 0

        confirmed_ids = [
            sid for sid, count in self.consecutive_counts.items()
            if count >= self.CONSECUTIVE_FRAMES_REQUIRED
        ]
        if confirmed_ids:
            now = time.time()
            ids_to_write = [
                sid for sid in confirmed_ids
                if now - self._last_db_write.get(sid, 0) >= self.DB_WRITE_INTERVAL
            ]
            if ids_to_write:
                self._mark_students_present(ids_to_write)
                for sid in ids_to_write:
                    self._last_db_write[sid] = now

        stats = {
            "detected": detected_count,
            "recognized": list(set(recognized_names)),
            "unknown": unknown_count,
            "timestamp": time.strftime('%H:%M:%S'),
            "faces": face_boxes,
            "frame_width": orig_w,
            "frame_height": orig_h,
        }
        return display_frame, stats

    # ────────────────────────────────────────────────────────────────────────
    # DB helpers
    # ────────────────────────────────────────────────────────────────────────

    def _mark_students_present(self, student_ids: list[int]):
        """Write present status + AttendanceRecord for confirmed student IDs."""
        db = SessionLocal()
        try:
            from models import StatusEnum, AttendanceRecord
            import datetime

            db.query(Student).filter(Student.id.in_(student_ids)).update(
                {"current_status": StatusEnum.present},
                synchronize_session=False
            )
            for sid in student_ids:
                record = AttendanceRecord(
                    student_id=sid,
                    timestamp=datetime.datetime.utcnow(),
                    status=StatusEnum.present,
                    confidence=1.0
                )
                db.add(record)

            db.flush()

            for sid in student_ids:
                total = db.query(AttendanceRecord).filter(
                    AttendanceRecord.student_id == sid
                ).count()
                present = db.query(AttendanceRecord).filter(
                    AttendanceRecord.student_id == sid,
                    AttendanceRecord.status == StatusEnum.present
                ).count()
                pct = round((present / total) * 100, 1) if total > 0 else 0.0
                db.query(Student).filter(Student.id == sid).update(
                    {"attendance_percentage": pct},
                    synchronize_session=False
                )

            db.commit()
            names = [self.student_names.get(sid, str(sid)) for sid in student_ids]
            print(f"[DB] Marked present: {', '.join(names)}")
        except Exception as e:
            print(f"[DB] Error marking present: {e}")
            db.rollback()
        finally:
            db.close()

    # ────────────────────────────────────────────────────────────────────────
    # Push / stream interface
    # ────────────────────────────────────────────────────────────────────────

    def push_frame(self, frame: np.ndarray):
        """Process a frame uploaded via HTTP (smart board push mode)."""
        annotated_frame, stats = self.process_frame(frame)
        with self.lock:
            self.latest_frame = annotated_frame
            self.frame_data = stats
        return stats

    def start_stream(self, rtsp_url="rtsp://192.168.1.100:554/stream"):
        if self.running:
            return
        self.running = True
        self.rtsp_url = rtsp_url
        self.thread = threading.Thread(target=self._stream_loop, daemon=True)
        self.thread.start()

    def stop_stream(self):
        self.running = False
        if self.thread:
            self.thread.join()
        if self.cap:
            self.cap.release()

    def _stream_loop(self):
        print(f"Connecting to RTSP stream at {self.rtsp_url}...")
        self.cap = cv2.VideoCapture(self.rtsp_url)
        while self.running:
            if not self.cap or not self.cap.isOpened():
                print("Stream disconnected. Retrying in 5s...")
                time.sleep(5)
                self.cap = cv2.VideoCapture(self.rtsp_url)
                continue
            ret, frame = self.cap.read()
            if not ret:
                print("Failed to read frame. Re-connecting...")
                time.sleep(2)
                self.cap.release()
                self.cap = cv2.VideoCapture(self.rtsp_url)
                continue
            annotated_frame, stats = self.process_frame(frame)
            with self.lock:
                self.latest_frame = annotated_frame
                self.frame_data = stats


# Global pipeline instance — initialised after DB tables are created in main.py
pipeline = VisionPipeline()
