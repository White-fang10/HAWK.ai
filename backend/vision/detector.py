# vision/detector.py
# ─────────────────────────────────────────────────────────────────────────────
# SCRFD face detector — 6×4 tiled grid on a lightweight-enhanced frame.
#
# Detection pipeline:
#   1. enhance_frame()         → bilateral denoise + CLAHE + Lanczos ×2 upscale
#                                Fast: ~50–200 ms on CPU (vs 10–40 s for ESRGAN)
#   2. 6-col × 4-row tiles     → each tile ~640–960 px wide
#   3. SCRFD on each tile      → 15 px faces → 30 px after ×2 → detected ✓
#   4. Remap bboxes to enhanced-frame coords
#   5. Global NMS              → remove duplicate cross-tile detections
#
# SETUP (run once before starting server):
#   python -c "from insightface.app import FaceAnalysis; \
#   FaceAnalysis(name='buffalo_l', allowed_modules=['detection']).prepare(ctx_id=-1, det_size=(640,640))"
# ─────────────────────────────────────────────────────────────────────────────
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import cv2
import numpy as np
from insightface.app import FaceAnalysis

# ── Config ────────────────────────────────────────────────────────────────────
_ENV_SIZE   = int(os.getenv("DETECTOR_SIZE", "640"))
INPUT_SIZE  = (_ENV_SIZE, _ENV_SIZE)

# Confidence threshold for SCRFD detections.
# 0.12 is permissive enough to catch dark/backlit faces in classrooms;
# NMS and the margin check in the recogniser handle any false positives.
CONF_THRESH    = float(os.getenv("CONF_THRESH", "0.12"))

# Minimum face size in the ENHANCED frame (pixels).
# After Lanczos ×2: a 15 px original face = 30 px in enhanced frame → above threshold.
MIN_FACE_PX    = int(os.getenv("MIN_FACE_PX", "18"))

# NMS overlap threshold for merging cross-tile duplicates.
TILE_IOU_THRESH = float(os.getenv("TILE_IOU_THRESH", "0.40"))

# Tiling grid
N_COLS = int(os.getenv("DETECTOR_COLS", "6"))
N_ROWS = int(os.getenv("DETECTOR_ROWS", "4"))
TILE_OVERLAP = float(os.getenv("TILE_OVERLAP", "0.25"))   # 25% overlap between adjacent tiles

# Megapixel threshold: frames below this get full 6×4 tiling.
# Above 8MP (4K): skip tiling (already high-res, single pass).
TILE_MEGAPIX_THRESHOLD = float(os.getenv("TILE_MP_THRESH", "8.0"))

# ── Singleton ──────────────────────────────────────────────────────────────────
_app: FaceAnalysis | None = None


def _get_app() -> FaceAnalysis:
    global _app
    if _app is not None:
        return _app

    for model_name in ("buffalo_l", "buffalo_sc"):
        try:
            _app = FaceAnalysis(
                name=model_name,
                allowed_modules=["detection"],
                providers=["CPUExecutionProvider"],
            )
            _app.prepare(ctx_id=-1, det_size=INPUT_SIZE)
            print(f"[Detector] Tiled SCRFD ready — {N_COLS}×{N_ROWS} tiles, conf={CONF_THRESH}")
            return _app
        except Exception as e:
            print(f"[Detector] Could not load {model_name}: {e} — trying next…")
            _app = None

    raise RuntimeError(
        "\n[Detector] No SCRFD model found. Download with:\n"
        'python -c "from insightface.app import FaceAnalysis; '
        "FaceAnalysis(name='buffalo_l', allowed_modules=['detection'])"
        '.prepare(ctx_id=-1, det_size=(640,640)); print(\'Done\')"\n'
    )


# ── NMS ────────────────────────────────────────────────────────────────────────

def _iou(a: list, b: list) -> float:
    ix1 = max(a[0], b[0]); iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2]); iy2 = min(a[3], b[3])
    iw = max(0.0, ix2 - ix1); ih = max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


def _nms(detections: list[dict], iou_thresh: float) -> list[dict]:
    if not detections:
        return []
    detections = sorted(detections, key=lambda d: d["conf"], reverse=True)
    kept = []
    suppressed = [False] * len(detections)
    for i, det in enumerate(detections):
        if suppressed[i]:
            continue
        kept.append(det)
        for j in range(i + 1, len(detections)):
            if not suppressed[j] and _iou(det["bbox"], detections[j]["bbox"]) > iou_thresh:
                suppressed[j] = True
    return kept


# ── Core single-tile detection ─────────────────────────────────────────────────

def _detect_tile(tile_bgr: np.ndarray) -> list[dict]:
    """Run SCRFD on a single tile. Returns raw detections in tile-local coords."""
    if tile_bgr is None or tile_bgr.size == 0:
        return []

    app   = _get_app()
    faces = app.get(tile_bgr)

    results = []
    for face in faces:
        conf = float(face.det_score)
        if conf < CONF_THRESH:
            continue

        bbox = face.bbox.tolist()
        x1, y1, x2, y2 = bbox
        fw   = x2 - x1
        fh   = y2 - y1
        fmin = int(min(fw, fh))
        if fmin < MIN_FACE_PX:
            continue

        kps = face.kps.tolist() if (hasattr(face, "kps") and face.kps is not None) else []

        results.append({
            "bbox":      bbox,
            "conf":      conf,
            "landmarks": kps,
            "face_size": fmin,
            "raw_width": int(fw),
        })

    return results


# ── 2-pass detection: full-frame first, then tiled ────────────────────────────
#
# WHY two passes?
#   • Tiling is optimised for SMALL distant faces (15–40 px).
#   • A LARGE nearby face (e.g. 400+ px wide) spans multiple tiles after ×2
#     upscale — each tile only sees a partial face → SCRFD cannot detect it.
#   • Pass 1 (full-frame single-pass) catches large nearby faces reliably.
#   • Pass 2 (6×4 tiled) catches small distant faces that Pass 1 misses.
#   • Both sets are merged with global NMS to remove duplicates.

def detect_tiled(img_bgr: np.ndarray) -> list[dict]:
    """
    Two-pass face detection:
      Pass 1 — full-frame single shot  (catches large / close faces)
      Pass 2 — 6-col × 4-row tiling    (catches small / distant faces)

    Results from both passes are merged with global NMS.

    Returns:
        List of dicts in *img_bgr* pixel coordinates, sorted by conf descending.
    """
    if img_bgr is None or img_bgr.size == 0:
        return []

    h, w    = img_bgr.shape[:2]
    megapix = (w * h) / 1_000_000.0

    # 4K+ → single-pass only (already high resolution, no tiling needed)
    if megapix > TILE_MEGAPIX_THRESHOLD:
        return _detect_single(img_bgr)

    # ── Pass 1: full-frame (catches large nearby faces) ───────────────────────
    all_dets: list[dict] = list(_detect_tile(img_bgr))  # deep copy the list
    pass1_count = len(all_dets)

    # ── Pass 2: tiled grid (catches small distant faces) ─────────────────────
    stride_x = w / N_COLS
    stride_y = h / N_ROWS
    tile_w   = int(stride_x * (1.0 + TILE_OVERLAP))
    tile_h   = int(stride_y * (1.0 + TILE_OVERLAP))

    for row in range(N_ROWS):
        for col in range(N_COLS):
            ox  = int(col * stride_x)
            oy  = int(row * stride_y)
            x2t = min(ox + tile_w, w)
            y2t = min(oy + tile_h, h)

            tile = img_bgr[oy:y2t, ox:x2t]
            if tile.size == 0:
                continue

            tile_dets = _detect_tile(tile)

            # Remap tile-local coords → full-image coords
            for d in tile_dets:
                tx1, ty1, tx2, ty2 = d["bbox"]
                d["bbox"] = [tx1 + ox, ty1 + oy, tx2 + ox, ty2 + oy]
                if d["landmarks"]:
                    d["landmarks"] = [[lx + ox, ly + oy] for lx, ly in d["landmarks"]]

            all_dets.extend(tile_dets)

    # ── Global NMS over both passes ───────────────────────────────────────────
    merged = _nms(all_dets, TILE_IOU_THRESH)
    merged.sort(key=lambda d: d["conf"], reverse=True)

    print(
        f"[Detector] detect_tiled: pass1={pass1_count} full-frame "
        f"pass2={len(all_dets)-pass1_count} tiled "
        f"→ after NMS={len(merged)} faces"
    )
    return merged


def _detect_single(img_bgr: np.ndarray) -> list[dict]:
    """Single-pass detection for high-resolution frames (4K+)."""
    results = _detect_tile(img_bgr)
    results.sort(key=lambda d: d["conf"], reverse=True)
    return results


# ── Main entry-point (enhance + detect) ───────────────────────────────────────

def detect_tiled_enhanced(
    img_bgr: np.ndarray,
    tile_overlap: float = TILE_OVERLAP,
) -> tuple[np.ndarray, list[dict], bool]:
    """
    Run enhance_frame() → detect_tiled().

    Returns:
        (enhanced_frame, detections, was_neural_sr)

    Detections are in *enhanced-frame* pixel coordinates.
    The pipeline must use enhanced_frame for all face crops.
    """
    from vision.enhancer import enhance_frame

    enhanced, was_enhanced = enhance_frame(img_bgr)
    dets = detect_tiled(enhanced)

    print(
        f"[Detector] detect_tiled_enhanced: "
        f"orig={img_bgr.shape[1]}×{img_bgr.shape[0]}, "
        f"enhanced={enhanced.shape[1]}×{enhanced.shape[0]}, "
        f"sr={'neural' if was_enhanced else 'lanczos/none'}, "
        f"faces={len(dets)}"
    )
    return enhanced, dets, was_enhanced


# ── Warmup ────────────────────────────────────────────────────────────────────

def warmup():
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    _detect_tile(dummy)
    print("[Detector] Warmup complete.")


# ── Standalone validation ──────────────────────────────────────────────────────
if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "test.jpg"
    img  = cv2.imread(path)
    if img is None:
        print(f"Cannot read: {path}"); sys.exit(1)

    print(f"Image: {img.shape[1]}×{img.shape[0]}")
    enhanced, dets, was_sr = detect_tiled_enhanced(img)
    print(f"Detected: {len(dets)} faces (SR={'neural' if was_sr else 'fallback'})")

    for d in dets:
        x1, y1, x2, y2 = [int(v) for v in d["bbox"]]
        cv2.rectangle(enhanced, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(
            enhanced, f"{d['conf']:.2f} | {d['face_size']}px",
            (x1, max(0, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1
        )

    out = "detection_result_tiled.jpg"
    cv2.imwrite(out, enhanced)
    print(f"Saved → {out}")