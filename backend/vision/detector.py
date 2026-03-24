# vision/detector.py
# ─────────────────────────────────────────────────────────────────────────────
# SCRFD face detector using InsightFace buffalo_sc model pack.
# Runs strictly on CPU — fast enough for detection, frees GPU for recognition.
#
# SETUP (run once before starting server):
#   python -c "from insightface.app import FaceAnalysis; \
#   FaceAnalysis(name='buffalo_sc', allowed_modules=['detection']).prepare(ctx_id=-1, det_size=(640,640))"
# ─────────────────────────────────────────────────────────────────────────────
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import cv2
import numpy as np
from insightface.app import FaceAnalysis

# ── Config — read from env or use smart defaults ────────────────────────────────
# DETECTOR_SIZE: 1280 gives significantly better coverage of distant / back-row
# faces since the model sees more pixels per face.
# Full-resolution camera images are passed in, so upping this costs only compute.
_ENV_SIZE   = int(os.getenv("DETECTOR_SIZE", "1280"))
INPUT_SIZE  = (_ENV_SIZE, _ENV_SIZE)

CONF_THRESH = 0.35   # lower → catch more faces (more false boxes too)
                     # raise → stricter, fewer false detections

# Minimum face shortest-side in pixels to accept.
# Faces smaller than this are too small for reliable 512-d embeddings.
MIN_FACE_PX = 40     # ~40px face = student about 8–10m away in 1080p frame

# ── Singleton ──────────────────────────────────────────────────────────────────
_app: FaceAnalysis | None = None


def _get_app() -> FaceAnalysis:
    global _app
    if _app is not None:
        return _app

    try:
        _app = FaceAnalysis(
            name="buffalo_sc",
            allowed_modules=["detection"],   # skip recognition module
            providers=["CPUExecutionProvider"],  # always CPU for detection
        )
        _app.prepare(ctx_id=-1, det_size=INPUT_SIZE)
        print(f"[Detector] SCRFD (buffalo_sc/det_500m) ready on CPU")
        print(f"[Detector] Input size: {INPUT_SIZE} | Conf threshold: {CONF_THRESH} | Min face: {MIN_FACE_PX}px")
        return _app

    except Exception as e:
        raise RuntimeError(
            f"\n[Detector] Failed to load SCRFD model: {e}\n\n"
            "Run this command to download the model first:\n\n"
            "  python -c \"from insightface.app import FaceAnalysis; "
            "FaceAnalysis(name='buffalo_sc', allowed_modules=['detection'])"
            ".prepare(ctx_id=-1, det_size=(640,640)); print('Done')\"\n"
        )


# ── Public API ─────────────────────────────────────────────────────────────────

def detect(img_bgr: np.ndarray) -> list[dict]:
    """
    Detect all faces in a single BGR image.

    Accepts the full-resolution image from the camera (e.g. 1080p, 4K).
    SCRFD internally scales it to INPUT_SIZE for the network pass, then
    projects detections back to original pixel coordinates.

    Args:
        img_bgr: numpy array in BGR format, any resolution.
                 Pass the camera image at its NATIVE resolution — do NOT
                 downscale before calling; let the detector handle scaling
                 so no information is lost.

    Returns:
        List of dicts sorted by confidence descending (only faces >= MIN_FACE_PX):
        {
            "bbox":      [x1, y1, x2, y2],   # floats, original image coords
            "conf":      float,               # detection confidence 0.0–1.0
            "landmarks": [[x,y], ...]         # 5 facial keypoints, or [] if unavailable
            "face_size": int,                 # shortest side of bbox in pixels
        }
    """
    if img_bgr is None or img_bgr.size == 0:
        return []

    app   = _get_app()
    faces = app.get(img_bgr)

    results = []
    for face in faces:
        conf = float(face.det_score)
        if conf < CONF_THRESH:
            continue

        bbox = face.bbox.tolist()   # [x1, y1, x2, y2]
        x1, y1, x2, y2 = bbox
        face_w = x2 - x1
        face_h = y2 - y1
        face_size = int(min(face_w, face_h))

        # Skip faces that are too small to get reliable embeddings from
        if face_size < MIN_FACE_PX:
            continue

        kps = []
        if hasattr(face, "kps") and face.kps is not None:
            kps = face.kps.tolist()  # [[x,y] x 5]

        results.append({
            "bbox":      bbox,
            "conf":      conf,
            "landmarks": kps,
            "face_size": face_size,
        })

    results.sort(key=lambda d: d["conf"], reverse=True)
    return results


def warmup():
    """
    Pre-load the model so the first real request is not slow.
    Call this during application startup.
    """
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    detect(dummy)
    print("[Detector] Warmup complete.")


# ── Standalone validation ──────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else "test.jpg"
    img  = cv2.imread(path)

    if img is None:
        print(f"Cannot read: {path}")
        sys.exit(1)

    print(f"Image: {img.shape[1]}x{img.shape[0]}")
    dets = detect(img)
    print(f"Detected: {len(dets)} faces (>={MIN_FACE_PX}px, conf>={CONF_THRESH})")

    for d in dets:
        x1, y1, x2, y2 = [int(v) for v in d["bbox"]]
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(img, f"{d['conf']:.2f} | {d['face_size']}px", (x1, max(0, y1 - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
        if d["landmarks"]:
            for lx, ly in d["landmarks"]:
                cv2.circle(img, (int(lx), int(ly)), 2, (0, 0, 255), -1)

    out = "detection_result.jpg"
    cv2.imwrite(out, img)
    print(f"Saved annotated result → {out}")