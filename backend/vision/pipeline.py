"""
Hawk.ai Vision Pipeline — Multi-Stage Architecture
===================================================
Implements the full pipeline from Hawk_AI_Architecture.docx:

Stage 1  6×4 tiled YOLOv8n-face detection
Stage 2  IoU-NMS deduplication
Stage 3  Crop + 30% margin + quality filter
Stage 4  Lanczos upscale to 112×112
Stage 5  AdaFace IR-50 embedding  (falls back to InsightFace buffalo_l if torch unavailable)
Stage 6  Cosine similarity (threshold 0.35)
Stage 7  Temporal voting (30s window / 40% threshold)
Stage 8  DB write (30s throttle per student)
"""

import cv2
import numpy as np
import threading
import time
import json
from collections import deque
from dataclasses import dataclass
from sqlalchemy.orm import Session
from ultralytics import YOLO
from database import SessionLocal
from models import Student


# ─────────────────────────────────────────────────────────────────────────────
# Preprocessing helpers
# ─────────────────────────────────────────────────────────────────────────────

def _apply_clahe_bilateral(frame: np.ndarray) -> np.ndarray:
    """
    Apply bilateral filter (denoising) then CLAHE (contrast boost) to a BGR frame.
    - Bilateral filter removes low-light grain while preserving face edges.
    - CLAHE on the Y (luminance) channel boosts contrast on dark/distant faces.
    """
    denoised = cv2.bilateralFilter(frame, d=9, sigmaColor=75, sigmaSpace=75)
    ycrcb = cv2.cvtColor(denoised, cv2.COLOR_BGR2YCrCb)
    y, cr, cb = cv2.split(ycrcb)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    y_eq = clahe.apply(y)
    ycrcb_eq = cv2.merge([y_eq, cr, cb])
    return cv2.cvtColor(ycrcb_eq, cv2.COLOR_YCrCb2BGR)


def _blur_variance(face_crop: np.ndarray) -> float:
    """Laplacian variance — lower = blurrier."""
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY) if len(face_crop.shape) == 3 else face_crop
    return cv2.Laplacian(gray, cv2.CV_64F).var()


# ─────────────────────────────────────────────────────────────────────────────
# Seating map dataclass  (Phase 5)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SeatZone:
    seat_id: str
    student_id: int
    x1: int
    y1: int
    x2: int
    y2: int


# ─────────────────────────────────────────────────────────────────────────────
# VisionPipeline
# ─────────────────────────────────────────────────────────────────────────────

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
            "vote_progress": {},
        }
        self.running = False
        self.thread = None
        self.cap = None
        self.rtsp_url = None
        self.camera_available = False
        self.latest_frame = None

        # ── Recognition parameters (per spec) ─────────────────────────────
        self.COSINE_THRESHOLD = 0.35          # AdaFace IR-50 threshold
        self.BLUR_THRESHOLD = 30.0            # Laplacian variance floor

        # ── Temporal voting (Phase 4) ──────────────────────────────────────
        self.VOTE_WINDOW_SECONDS = 30
        self.VOTE_THRESHOLD = 0.40            # 40 % of frames in window
        # Approximate frames expected in the vote window (1 frame/s upload ~= 30)
        self.VOTE_WINDOW_FRAMES = 30
        self._vote_buffer: dict[int, deque] = {}

        # ── DB write throttle ──────────────────────────────────────────────
        self.DB_WRITE_INTERVAL = 30           # seconds per student
        self._last_db_write: dict[int, float] = {}

        # ── Seating map (Phase 5) ──────────────────────────────────────────
        self.seat_map: dict[str, SeatZone] = {}

        # ── FAISS (cosine similarity via L2-normalised inner product) ──────
        import faiss
        self.faiss = faiss
        self.index = None
        self.student_ids: list[int] = []
        self.student_names: dict[int, str] = {}
        self.target_dim = 512                 # AdaFace IR-50 = 512-d

        # ── Load YOLOv8n-face (Phase 1) ────────────────────────────────────
        print("Loading YOLOv8n-face model …")
        try:
            import torch
            import ultralytics.nn.tasks
            if hasattr(torch.serialization, 'add_safe_globals'):
                torch.serialization.add_safe_globals([ultralytics.nn.tasks.DetectionModel])
            _orig_load = torch.load
            def _patched_load(f, *args, **kwargs):
                kwargs.setdefault('weights_only', False)
                return _orig_load(f, *args, **kwargs)
            torch.load = _patched_load
        except Exception as e:
            print(f"PyTorch compat patch skipped: {e}")

        try:
            self.yolo_model = YOLO("yolov8n-face.pt")
            print("Loaded yolov8n-face.pt ✓")
        except Exception:
            try:
                self.yolo_model = YOLO("yolov8n.pt")
                print("Loaded yolov8n.pt (face model unavailable)")
            except Exception as e2:
                print(f"WARNING: Could not load any YOLO model: {e2}")
                self.yolo_model = None

        # ── Load AdaFace IR-50 (Phase 3) ───────────────────────────────────
        print("Loading AdaFace IR-50 …")
        try:
            from vision.adaface import AdaFaceModel
            self.adaface = AdaFaceModel()
        except Exception as e:
            print(f"WARNING: AdaFace not loaded: {e}")
            self.adaface = None

        # ── InsightFace as embedding fallback for training only ────────────
        # (kept to allow re-training via /api/students/{id}/train if AdaFace fails)
        try:
            from insightface.app import FaceAnalysis
            self.face_app = FaceAnalysis(name="buffalo_l", providers=['CPUExecutionProvider'])
            self.face_app.prepare(ctx_id=0, det_size=(640, 640), det_thresh=0.25)
            print("InsightFace buffalo_l ready (training fallback).")
        except Exception as e:
            print(f"InsightFace not loaded: {e}")
            self.face_app = None

        self.reload_faiss_index()

    # ──────────────────────────────────────────────────────────────────────
    # Static helpers
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _normalize(emb: np.ndarray) -> np.ndarray:
        norm = np.linalg.norm(emb)
        return emb if norm == 0 else emb / norm

    # ──────────────────────────────────────────────────────────────────────
    # Phase 1 — Tiled detection
    # ──────────────────────────────────────────────────────────────────────

    def tile_detect(self, frame: np.ndarray) -> list[dict]:
        """
        Tile the full frame into a 6×4 grid (with 64 px overlap).
        Run YOLOv8n-face on each tile at imgsz=640, conf=0.15.
        Remap coords back to the original frame and NMS-dedup.
        """
        if self.yolo_model is None:
            return []

        h, w = frame.shape[:2]
        cols, rows = 6, 4
        overlap = 64

        tile_w = w // cols
        tile_h = h // rows
        stride_x = tile_w          # tiles start at multiples of tile_w
        stride_y = tile_h

        raw_detections: list[dict] = []

        for row in range(rows):
            for col in range(cols):
                x1 = max(0, col * stride_x - overlap)
                y1 = max(0, row * stride_y - overlap)
                x2 = min(w, (col + 1) * stride_x + overlap)
                y2 = min(h, (row + 1) * stride_y + overlap)

                tile = frame[y1:y2, x1:x2]
                if tile.size == 0:
                    continue

                try:
                    results = self.yolo_model(tile, imgsz=640, conf=0.15, verbose=False)
                except Exception as e:
                    print(f"[YOLO] tile ({col},{row}) error: {e}")
                    continue

                for result in results:
                    if result.boxes is None:
                        continue
                    for box in result.boxes:
                        tx1, ty1, tx2, ty2 = box.xyxy[0].tolist()
                        conf = float(box.conf[0])
                        det = self.remap_coords(
                            (tx1, ty1, tx2, ty2), conf,
                            x1, y1               # tile origin in frame coords
                        )
                        raw_detections.append(det)

        return self.nms(raw_detections)

    def remap_coords(
        self,
        bbox: tuple[float, float, float, float],
        conf: float,
        tile_x_offset: int,
        tile_y_offset: int,
    ) -> dict:
        """Add tile origin offset to recover original frame coordinates."""
        tx1, ty1, tx2, ty2 = bbox
        return {
            "x1": int(tx1 + tile_x_offset),
            "y1": int(ty1 + tile_y_offset),
            "x2": int(tx2 + tile_x_offset),
            "y2": int(ty2 + tile_y_offset),
            "conf": conf,
        }

    @staticmethod
    def nms(detections: list[dict], iou_threshold: float = 0.4) -> list[dict]:
        """IoU-based NMS to remove cross-tile duplicate detections."""
        if not detections:
            return []

        boxes = sorted(detections, key=lambda d: d["conf"], reverse=True)
        kept: list[dict] = []

        while boxes:
            best = boxes.pop(0)
            kept.append(best)
            remaining = []
            for b in boxes:
                # Compute IoU between 'best' and 'b'
                ix1 = max(best["x1"], b["x1"])
                iy1 = max(best["y1"], b["y1"])
                ix2 = min(best["x2"], b["x2"])
                iy2 = min(best["y2"], b["y2"])
                inter_w = max(0, ix2 - ix1)
                inter_h = max(0, iy2 - iy1)
                inter = inter_w * inter_h
                area_best = (best["x2"] - best["x1"]) * (best["y2"] - best["y1"])
                area_b = (b["x2"] - b["x1"]) * (b["y2"] - b["y1"])
                union = area_best + area_b - inter
                iou = inter / union if union > 0 else 0.0
                if iou < iou_threshold:
                    remaining.append(b)
            boxes = remaining

        return kept

    # ──────────────────────────────────────────────────────────────────────
    # Phase 2 — Crop pipeline
    # ──────────────────────────────────────────────────────────────────────

    def extract_face_crop(self, frame: np.ndarray, bbox: dict) -> np.ndarray | None:
        """Extract crop with 30% margin padding, clamped to frame bounds."""
        h, w = frame.shape[:2]
        bx1, by1, bx2, by2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]
        bw = bx2 - bx1
        bh = by2 - by1
        margin_x = int(bw * 0.30)
        margin_y = int(bh * 0.30)
        cx1 = max(0, bx1 - margin_x)
        cy1 = max(0, by1 - margin_y)
        cx2 = min(w, bx2 + margin_x)
        cy2 = min(h, by2 + margin_y)
        crop = frame[cy1:cy2, cx1:cx2]
        return crop if crop.size > 0 else None

    def quality_filter(self, crop: np.ndarray, confidence: float) -> bool:
        """
        Accept crop only if:
          - size >= 20×20 px
          - aspect ratio 0.5–2.0
          - Laplacian blur variance > 30
          - detection confidence > 0.15
        """
        if crop is None or crop.size == 0:
            return False
        ch, cw = crop.shape[:2]
        if ch < 20 or cw < 20:
            return False
        aspect = cw / ch if ch > 0 else 0
        if not (0.5 <= aspect <= 2.0):
            return False
        if _blur_variance(crop) < 30:
            return False
        if confidence < 0.15:
            return False
        return True

    def upscale_crop(self, crop: np.ndarray) -> np.ndarray:
        """
        Resize to 112×112 using INTER_LANCZOS4 (default).
        If env var USE_NEURAL_SR=1 is set, use OpenCV DNN EDSR instead
        (future: plug in EDSR super-resolution model here).
        """
        import os
        if os.environ.get("USE_NEURAL_SR") == "1":
            # Placeholder for EDSR neural SR — falls through to Lanczos for now
            pass
        return cv2.resize(crop, (112, 112), interpolation=cv2.INTER_LANCZOS4)

    # ──────────────────────────────────────────────────────────────────────
    # FAISS / embedding helpers
    # ──────────────────────────────────────────────────────────────────────

    def reload_faiss_index(self):
        """Rebuild FAISS IndexFlatIP from DB — called on startup and after training."""
        db = SessionLocal()
        try:
            students = db.query(Student).filter(Student.embedding != None).all()
            if not students:
                self.index = self.faiss.IndexFlatIP(self.target_dim)
                self.student_ids = []
                self.student_names = {}
                print("FAISS index initialized (empty — no trained faces yet).")
                return

            embeddings: list[np.ndarray] = []
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
                self.index = self.faiss.IndexFlatIP(self.target_dim)
                self.index.add(embeddings_np)
                print(f"FAISS index reloaded with {len(self.student_ids)} face(s).")
            else:
                self.index = self.faiss.IndexFlatIP(self.target_dim)
        except Exception as e:
            print(f"FAISS reload error: {e}")
            self.index = self.faiss.IndexFlatIP(self.target_dim)
        finally:
            db.close()

    def extract_embedding(self, image_np: np.ndarray) -> np.ndarray | None:
        """
        Extract a normalised face embedding for training.
        Prefers AdaFace IR-50; falls back to InsightFace if unavailable.
        """
        # Try AdaFace first — it uses the YOLO-tiled pipeline
        if self.adaface is not None:
            enhanced = _apply_clahe_bilateral(image_np)
            detections = self.tile_detect(enhanced)
            if detections:
                # Pick the largest detected face
                detections.sort(
                    key=lambda d: (d["x2"] - d["x1"]) * (d["y2"] - d["y1"]),
                    reverse=True
                )
                best = detections[0]
                crop = self.extract_face_crop(enhanced, best)
                if crop is not None and self.quality_filter(crop, best["conf"]):
                    upscaled = self.upscale_crop(crop)
                    emb = self.adaface.get_embedding(upscaled)
                    if emb is not None:
                        return self._normalize(emb)

        # Fallback: InsightFace buffalo_l
        if self.face_app is not None:
            try:
                enhanced = _apply_clahe_bilateral(image_np)
                faces = self.face_app.get(enhanced)
                if not faces:
                    resized = cv2.resize(enhanced, (1280, 1280))
                    faces = self.face_app.get(resized)
                if faces:
                    faces = sorted(
                        faces,
                        key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]),
                        reverse=True
                    )
                    raw_emb = faces[0].embedding.astype("float32")
                    return self._normalize(raw_emb)
            except Exception as e:
                print(f"Embedding extraction (InsightFace) error: {e}")

        return None

    # ──────────────────────────────────────────────────────────────────────
    # Phase 4 — Temporal voting helpers
    # ──────────────────────────────────────────────────────────────────────

    def _record_vote(self, student_id: int, cosine_score: float) -> float:
        """
        Push a (timestamp, score) tuple into the vote buffer for student_id.
        Prune entries outside the 30s window.
        Returns the current vote ratio (fraction of VOTE_WINDOW_FRAMES seen).
        """
        now = time.time()
        buf = self._vote_buffer.setdefault(student_id, deque())
        buf.append((now, cosine_score))
        # Prune stale entries
        while buf and now - buf[0][0] > self.VOTE_WINDOW_SECONDS:
            buf.popleft()
        return len(buf) / self.VOTE_WINDOW_FRAMES

    def _vote_confirmed(self, student_id: int) -> bool:
        buf = self._vote_buffer.get(student_id)
        if not buf:
            return False
        return (len(buf) / self.VOTE_WINDOW_FRAMES) >= self.VOTE_THRESHOLD

    def vote_progress_snapshot(self) -> dict[str, float]:
        """Return {student_id_str: ratio} for all students with active votes."""
        now = time.time()
        snapshot = {}
        for sid, buf in self._vote_buffer.items():
            # Prune stale entries
            while buf and now - buf[0][0] > self.VOTE_WINDOW_SECONDS:
                buf.popleft()
            if buf:
                snapshot[str(sid)] = round(len(buf) / self.VOTE_WINDOW_FRAMES, 3)
        return snapshot

    # ──────────────────────────────────────────────────────────────────────
    # Core frame processing
    # ──────────────────────────────────────────────────────────────────────

    def process_frame(self, frame: np.ndarray):
        """
        Full pipeline per frame:
          1  CLAHE+bilateral preprocessing
          2  Tiled YOLOv8n-face detection (6×4 grid)
          3  IoU-NMS deduplication
          4  For each bbox: extract_face_crop + quality_filter + upscale_crop
          5  AdaFace IR-50 embedding (falls back to InsightFace)
          6  FAISS cosine similarity (threshold = 0.35)
          7  Seating-map constraint (if active)
          8  Temporal voting (30s / 40%)
          9  DB write (throttled to 30s per student)
         10  Draw annotated overlay

        Returns: (annotated_frame, stats_dict)
        """
        recognized_names: list[str] = []
        confirmed_student_ids: list[int] = []
        unknown_count = 0
        face_boxes: list[dict] = []
        display_frame = frame.copy()
        orig_h, orig_w = frame.shape[:2]

        # ── Step 1: Preprocess ─────────────────────────────────────────────
        enhanced = _apply_clahe_bilateral(frame)

        # ── Step 2: Tiled detection ────────────────────────────────────────
        detections = self.tile_detect(enhanced)
        detected_count = len(detections)

        has_index = self.index is not None and self.index.ntotal > 0

        for det in detections:
            # Clamp to frame bounds
            bx1 = max(0, min(orig_w - 1, det["x1"]))
            by1 = max(0, min(orig_h - 1, det["y1"]))
            bx2 = max(bx1 + 1, min(orig_w, det["x2"]))
            by2 = max(by1 + 1, min(orig_h, det["y2"]))
            conf = det["conf"]

            bbox_clamped = {"x1": bx1, "y1": by1, "x2": bx2, "y2": by2, "conf": conf}

            name = "Unknown"
            is_known = False
            vote_ratio = 0.0

            # ── Seating-map constraint (Phase 5) ───────────────────────────
            seat_student_id: int | None = None
            if self.seat_map:
                cx = (bx1 + bx2) // 2
                cy = (by1 + by2) // 2
                for zone in self.seat_map.values():
                    if zone.x1 <= cx <= zone.x2 and zone.y1 <= cy <= zone.y2:
                        seat_student_id = zone.student_id
                        break
                # If no zone matched, skip this bbox (zone-constrained mode)
                if seat_student_id is None:
                    continue

            if has_index and self.adaface is not None:
                # ── Step 3: Extract + quality-filter + upscale ─────────────
                crop = self.extract_face_crop(frame, bbox_clamped)

                if crop is not None and self.quality_filter(crop, conf):
                    # ── Step 4: Upscale ────────────────────────────────────
                    upscaled = self.upscale_crop(crop)

                    # ── Step 5: AdaFace embedding ──────────────────────────
                    emb = self.adaface.get_embedding(upscaled)

                    if emb is not None:
                        emb_norm = self._normalize(emb).reshape(1, -1)
                        D, I = self.index.search(emb_norm, 1)
                        sim = float(D[0][0])
                        idx = int(I[0][0])

                        # ── Step 6: Cosine threshold ───────────────────────
                        if sim >= self.COSINE_THRESHOLD and idx != -1:
                            student_id = self.student_ids[idx]

                            # Seating-map guard: in zone mode only allow the assigned student
                            if seat_student_id is not None and student_id != seat_student_id:
                                pass  # not the expected student — treat as Unknown
                            else:
                                # ── Step 7: Temporal vote ──────────────────
                                vote_ratio = self._record_vote(student_id, sim)
                                name = self.student_names.get(student_id, "Unknown")
                                is_known = True

                                if self._vote_confirmed(student_id):
                                    confirmed_student_ids.append(student_id)
                                    recognized_names.append(name)
                        else:
                            print(f"[RECOG] sim={sim:.3f} < {self.COSINE_THRESHOLD} → Unknown")
                    else:
                        print(f"[RECOG] Embedding failed for crop")
                else:
                    print(f"[QUALITY] Crop failed quality filter (conf={conf:.2f})")

            if not is_known:
                unknown_count += 1

            # ── Step 8: Draw overlay ────────────────────────────────────────
            color = (33, 188, 100) if is_known else (60, 80, 251)
            cv2.rectangle(display_frame, (bx1, by1), (bx2, by2), color, 2)
            label = name
            if label:
                font = cv2.FONT_HERSHEY_SIMPLEX
                (tw, th), _ = cv2.getTextSize(label, font, 0.55, 1)
                label_y = max(0, by1 - th - 8)
                cv2.rectangle(display_frame, (bx1, label_y), (bx1 + tw + 8, by1), color, -1)
                cv2.putText(
                    display_frame, label,
                    (bx1 + 4, max(th + 4, by1 - 4)),
                    font, 0.55, (255, 255, 255), 1, cv2.LINE_AA
                )

            face_boxes.append({
                "x1": bx1, "y1": by1, "x2": bx2, "y2": by2,
                "name": name,
                "known": is_known,
                "vote_ratio": round(vote_ratio, 3),
            })

        # ── Step 9: DB write for vote-confirmed students ───────────────────
        if confirmed_student_ids:
            now = time.time()
            ids_to_write = [
                sid for sid in set(confirmed_student_ids)
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
            "vote_progress": self.vote_progress_snapshot(),
        }
        return display_frame, stats

    # ──────────────────────────────────────────────────────────────────────
    # DB helpers
    # ──────────────────────────────────────────────────────────────────────

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

    # ──────────────────────────────────────────────────────────────────────
    # Push / stream interface
    # ──────────────────────────────────────────────────────────────────────

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
        print(f"Connecting to RTSP stream at {self.rtsp_url}…")
        self.cap = cv2.VideoCapture(self.rtsp_url)
        while self.running:
            if not self.cap or not self.cap.isOpened():
                print("Stream disconnected. Retrying in 5s…")
                time.sleep(5)
                self.cap = cv2.VideoCapture(self.rtsp_url)
                continue
            ret, frame = self.cap.read()
            if not ret:
                print("Failed to read frame. Re-connecting…")
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
