# vision/enhancer.py
# ─────────────────────────────────────────────────────────────────────────────
# Fast, detection-friendly enhancement pipeline (no neural SR required).
#
# WHY the change:
#   Real-ESRGAN on the full frame before SCRFD was the bottleneck:
#     • It runs on CPU → dozens of seconds per frame
#     • Doubled every dimension → 4× more tiles → detector runs much longer
#     • ESRGAN tile artifacts sometimes confuse SCRFD and SUPPRESS detections
#     • Net result: far fewer faces detected than the plain (no-enhancer) baseline
#
# New approach — "lightweight face-optimised preprocessing":
#
#   Tier 1 — Full-frame  (before SCRFD):
#     1. Bilateral denoise  — removes sensor noise while preserving face edges
#     2. CLAHE              — local contrast boost (handles dark / backlit rooms)
#     3. Lanczos ×2 upscale — doubles resolution cheaply so 15 px faces → 30 px;
#                             SCRFD reliably detects ≥ 20 px faces
#     Total latency on CPU: ≈ 50–200 ms vs. 10–40 s for ESRGAN
#
#   Tier 2 — Face-crop  (before recogniser):
#     1. Lanczos ×2 upscale (only for crops < ENHANCE_THRESHOLD wide)
#     2. CLAHE on the crop
#     3. Unsharp mask       — sharpens fine facial features for better embedding
#     Total latency per crop: ≈ 1–5 ms
#
#   Zone-crop (software-zoom crops before detection):
#     Zoom ≤ 1.5×  → CLAHE only
#     Zoom > 1.5×  → Lanczos ×2 + CLAHE + unsharp
#
# No external dependencies beyond OpenCV — works immediately, no model download.
# ─────────────────────────────────────────────────────────────────────────────
import os
import numpy as np
import cv2

# ── Config ────────────────────────────────────────────────────────────────────
# Face smaller than this (in raw frame pixels) gets a Lanczos ×2 upscale
# before the recogniser, so MBF/GhostFaceNet gets a bigger crop to work with.
ENHANCE_THRESHOLD = int(os.getenv("ENHANCE_THRESHOLD", "60"))

# Frames larger than this (megapixels) are already high-res → skip ×2 upscale,
# apply CLAHE only. (4K  ≈ 8.3 MP)
FRAME_ENHANCE_MAX_MP = float(os.getenv("FRAME_ENHANCE_MAX_MP", "8.3"))

# Bilateral filter parameters — light touch: removes grain without blurring face edges.
# d=3 is faster and less aggressive than d=5; CLAHE does the heavy lifting.
BILATERAL_D      = int(os.getenv("BILATERAL_D",      "3"))    # neighbourhood diameter
BILATERAL_SIGMA  = float(os.getenv("BILATERAL_SIGMA", "35.0"))  # colour & space sigma

# CLAHE parameters (base values — boosted for dark frames automatically)
CLAHE_CLIP  = float(os.getenv("CLAHE_CLIP",  "2.5"))
CLAHE_GRID  = int(os.getenv("CLAHE_GRID",   "8"))

# Gamma lookup tables — lift dark / backlit faces before CLAHE
def _build_gamma_lut(gamma: float) -> np.ndarray:
    inv = 1.0 / gamma
    return np.array([int((i / 255.0) ** inv * 255 + 0.5) for i in range(256)], dtype=np.uint8)

# gamma < 1.0 brightens shadows (0.5 = strong lift, 0.7 = moderate)
_GAMMA_LUT_STRONG   = _build_gamma_lut(0.50)   # very dark / strong backlight
_GAMMA_LUT_MODERATE = _build_gamma_lut(0.70)   # mildly dark room

# Unsharp mask parameters (face crop only)
UNSHARP_SIGMA  = float(os.getenv("UNSHARP_SIGMA",  "1.0"))
UNSHARP_AMOUNT = float(os.getenv("UNSHARP_AMOUNT", "0.8"))


# ── Core helpers ──────────────────────────────────────────────────────────────

def _clahe(img: np.ndarray, clip: float = CLAHE_CLIP, grid: int = CLAHE_GRID) -> np.ndarray:
    """Apply CLAHE to the L channel (LAB) to boost local contrast."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=clip, tileGridSize=(grid, grid)).apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def _bilateral_denoise(img: np.ndarray) -> np.ndarray:
    """Edge-preserving denoise — light touch so face features stay crisp."""
    return cv2.bilateralFilter(img, BILATERAL_D, BILATERAL_SIGMA, BILATERAL_SIGMA)


def _lanczos2x(img: np.ndarray) -> np.ndarray:
    """Double resolution with Lanczos — good quality, runs in < 20 ms for HD."""
    h, w = img.shape[:2]
    return cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)


def _unsharp(img: np.ndarray,
             sigma: float = UNSHARP_SIGMA,
             amount: float = UNSHARP_AMOUNT) -> np.ndarray:
    """Unsharp mask — accentuates fine facial features for embeddings."""
    blurred = cv2.GaussianBlur(img, (0, 0), sigma)
    return np.clip(
        cv2.addWeighted(img, 1.0 + amount, blurred, -amount, 0), 0, 255
    ).astype(np.uint8)


def _adaptive_gamma(img: np.ndarray) -> tuple:
    """
    Apply gamma correction to lift shadowed / backlit faces.

    Checks the mean L channel to decide how aggressively to lift.

    Returns:
        (corrected_bgr, mean_L: float)
    """
    lab  = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    mean_l = float(l.mean())

    if mean_l < 60:          # very dark / strong backlight
        l = cv2.LUT(l, _GAMMA_LUT_STRONG)
        print(f"[Enhancer] Dark frame (mean_L={mean_l:.0f}) → strong gamma lift (0.50)")
    elif mean_l < 100:       # mildly dark
        l = cv2.LUT(l, _GAMMA_LUT_MODERATE)
        print(f"[Enhancer] Dim frame (mean_L={mean_l:.0f}) → moderate gamma lift (0.70)")
    # else: well-lit frame, no gamma needed

    corrected = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
    return corrected, mean_l


# ── Tier 1: Full-frame enhancement (before SCRFD) ────────────────────────────

def enhance_frame(frame_bgr: np.ndarray) -> tuple:
    """
    Fast, detection-friendly frame preprocessing with backlight compensation.

    Steps (for frames < 4K):
      1. Adaptive gamma lift  →  lifts shadowed / backlit faces before CLAHE
      2. Bilateral denoise    →  removes grain while preserving face edges
      3. CLAHE                →  boosts local contrast (dark room / backlight)
      4. Lanczos ×2 upscale  →  doubles resolution so 15 px faces hit 30 px
                                 (SCRFD minimum for reliable detection)

    4K+ frames skip upscale and use CLAHE only.

    Returns:
        (enhanced_frame, was_upscaled: bool)
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return frame_bgr, False

    h, w = frame_bgr.shape[:2]
    mp   = (w * h) / 1_000_000.0

    # --- 4K+: gamma + CLAHE only, no upscale needed ---
    if mp >= FRAME_ENHANCE_MAX_MP:
        gamma_d, mean_l = _adaptive_gamma(frame_bgr)
        clahe_clip = 4.0 if mean_l < 80 else 2.5
        print(f"[Enhancer] Frame {w}×{h} ({mp:.1f} MP) — 4K, CLAHE only (clip={clahe_clip})")
        return _clahe(gamma_d, clip=clahe_clip, grid=4), False

    # --- Sub-4K: gamma → denoise → CLAHE → ×2 upscale ---
    gamma_d, mean_l = _adaptive_gamma(frame_bgr)
    denoised = _bilateral_denoise(gamma_d)

    # Use stronger CLAHE clip for dark/backlit frames
    clahe_clip = 4.0 if mean_l < 60 else (3.0 if mean_l < 100 else CLAHE_CLIP)
    clahe_d  = _clahe(denoised, clip=clahe_clip)
    upscaled = _lanczos2x(clahe_d)

    print(
        f"[Enhancer] Frame {w}×{h} mean_L={mean_l:.0f} clip={clahe_clip} → "
        f"gamma+bilateral+CLAHE+Lanczos×2 → {w*2}×{h*2}"
    )
    return upscaled, True


# ── Tier 2: Face-crop enhancement (before recogniser) ────────────────────────

def enhance_face(crop_bgr: np.ndarray, raw_width: int) -> tuple:
    """
    Upsample + sharpen a small face crop before embedding extraction.

    Only activates when raw_width < ENHANCE_THRESHOLD (back-row students).

    Pipeline:
      1. Lanczos ×2 upscale  →  ~15 px face → ~30 px  (much better for MBF)
      2. CLAHE               →  local contrast for dark faces
      3. Unsharp mask        →  sharpens eye/nose details for discriminability

    Returns:
        (enhanced_crop, was_enhanced: bool)
    """
    if raw_width >= ENHANCE_THRESHOLD:
        return crop_bgr, False   # front/mid row — large enough already

    if crop_bgr is None or crop_bgr.size == 0:
        return crop_bgr, False

    h, w = crop_bgr.shape[:2]
    if h < 8 or w < 8:
        return crop_bgr, False

    upscaled = _lanczos2x(crop_bgr)
    enhanced = _clahe(upscaled, clip=2.5, grid=4)
    enhanced = _unsharp(enhanced, sigma=0.8, amount=1.0)

    return enhanced, True


# ── Zone-crop enhancement (software-zoom regions before detection) ─────────────

def enhance_crop_for_zoom(crop_bgr: np.ndarray, zoom_factor: float) -> tuple:
    """
    Enhance a column/row region extracted by software-zoom.

    zoom ≤ 1.5 → CLAHE only (mild zoom, resolution is fine)
    zoom > 1.5  → Lanczos ×2 + CLAHE + unsharp (strong zoom, needs SR)

    Returns:
        (enhanced_crop, was_upscaled: bool)
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return crop_bgr, False

    if zoom_factor <= 1.5:
        return _clahe(crop_bgr), False

    upscaled = _lanczos2x(crop_bgr)
    enhanced = _clahe(upscaled)
    enhanced = _unsharp(enhanced)

    h, w = crop_bgr.shape[:2]
    print(
        f"[Enhancer] Zone crop {w}×{h} (zoom {zoom_factor:.1f}×) → "
        f"Lanczos ×2 + CLAHE + unsharp → {w*2}×{h*2}"
    )
    return enhanced, True


# ── Sharpness metric ──────────────────────────────────────────────────────────

def sharpness_score(img_bgr: np.ndarray) -> float:
    """
    Laplacian variance — higher = sharper.
    Used to pick the best frame per zone in process_burst_smart().
    """
    if img_bgr is None or img_bgr.size == 0:
        return 0.0
    try:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except Exception:
        return 0.0


# ── Warmup ────────────────────────────────────────────────────────────────────

def warmup():
    """Run a small dummy frame through the pipeline to JIT-compile paths."""
    dummy = np.zeros((64, 64, 3), dtype=np.uint8)
    enhance_frame(dummy)
    enhance_face(dummy, raw_width=10)
    print(
        "[Enhancer] Warmup complete | Mode: "
        "bilateral-denoise + CLAHE + Lanczos ×2 (fast OpenCV pipeline)"
    )
