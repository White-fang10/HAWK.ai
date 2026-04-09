# vision/recognizer.py
# ─────────────────────────────────────────────────────────────────────────────
# GhostFaceNet face recognizer — hybrid CPU/GPU execution.
# Falls back to InsightFace MBF if GhostFaceNet ONNX is not present.
# ─────────────────────────────────────────────────────────────────────────────
import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import cv2
import numpy as np
import onnxruntime as ort
from pathlib import Path
# Face SR is now applied upstream in pipeline.py (Real-ESRGAN).
# Crops reaching get_embedding() are already enhanced — no per-crop call needed here.

# ── Model path ────────────────────────────────────────────────────────────────
MODEL_PATH = Path(__file__).parent.parent / "models" / "ghostfacenet_w1.3_s1.onnx"

# ── Provider selection ────────────────────────────────────────────────────────
def _select_providers() -> list:
    available = ort.get_available_providers()
    print(f"[Recognizer] Available ONNX providers: {available}")
    if "CUDAExecutionProvider" in available:
        print("[Recognizer] → Selected: CUDA (NVIDIA GPU)")
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    if "DmlExecutionProvider" in available:
        print("[Recognizer] → Selected: DirectML (Windows GPU)")
        return ["DmlExecutionProvider", "CPUExecutionProvider"]
    print("[Recognizer] → Selected: CPU only")
    return ["CPUExecutionProvider"]

# ── Load GhostFaceNet ONNX session ────────────────────────────────────────────
def _load_session():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"GhostFaceNet model not found at: {MODEL_PATH}")
    providers = _select_providers()
    sess      = ort.InferenceSession(str(MODEL_PATH), providers=providers)
    print(f"[Recognizer] GhostFaceNet loaded | Provider: {sess.get_providers()[0]}")
    return sess

# ── Globals ───────────────────────────────────────────────────────────────────
USE_INSIGHTFACE_FALLBACK = not MODEL_PATH.exists()
_session        = None
_input_name     = ""
_mbf_rec_model  = None   # direct handle to MBF recognition model


def _init():
    global _session, _input_name, _mbf_rec_model, USE_INSIGHTFACE_FALLBACK

    if USE_INSIGHTFACE_FALLBACK:
        print("[Recognizer] GhostFaceNet ONNX not found — using InsightFace MBF fallback")
        from insightface.app import FaceAnalysis

        app = FaceAnalysis(
            name="buffalo_sc",
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        app.prepare(ctx_id=-1, det_size=(640, 640))

        # ── CRITICAL FIX ──────────────────────────────────────────────────────
        # Find the MBF recognition model directly from the loaded models dict.
        # The key is NOT "recognition" — it is the model filename without extension
        # e.g. "w600k_mbf". We find it by checking for get_feat() method.
        for name, model in app.models.items():
            print(f"[Recognizer] Found model: '{name}' | has get_feat: {hasattr(model, 'get_feat')}")
            if hasattr(model, "get_feat"):
                _mbf_rec_model = model
                print(f"[Recognizer] Using '{name}' for embedding extraction")
                break

        if _mbf_rec_model is None:
            raise RuntimeError(
                "[Recognizer] Could not find MBF recognition model with get_feat(). "
                "Check InsightFace installation."
            )

        print("[Recognizer] InsightFace MBF ready")
    else:
        _session    = _load_session()
        _input_name = _session.get_inputs()[0].name


_init()


# ── Face alignment ─────────────────────────────────────────────────────────────
_REF_LANDMARKS = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
], dtype=np.float32)

# ── CLAHE — always applied, tuned for 112×112 ArcFace crops ─────────────────
_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

# Gamma lookup table (pre-computed for speed) — lifts dark faces
def _build_gamma_lut(gamma: float) -> np.ndarray:
    inv = 1.0 / gamma
    return np.array([int((i / 255.0) ** inv * 255 + 0.5) for i in range(256)], dtype=np.uint8)

_GAMMA_LIFT_LUT = _build_gamma_lut(0.6)   # brightens mid-tones without blowing highlights


def _align_face(img_bgr: np.ndarray, landmarks: list) -> np.ndarray:
    if not landmarks or len(landmarks) < 5:
        return cv2.resize(img_bgr, (112, 112), interpolation=cv2.INTER_LANCZOS4)
    src = np.array(landmarks, dtype=np.float32)
    M, _ = cv2.estimateAffinePartial2D(src, _REF_LANDMARKS)
    if M is None:
        return cv2.resize(img_bgr, (112, 112), interpolation=cv2.INTER_LANCZOS4)
    return cv2.warpAffine(
        img_bgr, M, (112, 112),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT,
    )


def _apply_clahe(crop: np.ndarray) -> np.ndarray:
    """Apply CLAHE + optional gamma lift for dark faces.
    Always applied — dark classroom frames need contrast normalisation.
    Gamma lift kicks in only when mean L < 80 (very dark / backlit faces).
    """
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    mean_l = float(l.mean())

    # Lift very dark frames with gamma before CLAHE
    if mean_l < 80:
        l = cv2.LUT(l, _GAMMA_LIFT_LUT)

    # Always apply CLAHE — crops reaching here are 112×112 faces that need contrast equalization
    l = _clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


def _prepare_tensor(crop: np.ndarray) -> np.ndarray:
    img = crop.astype(np.float32) / 255.0
    img = (img - 0.5) / 0.5
    img = img[:, :, ::-1]           # BGR -> RGB
    return img.transpose(2, 0, 1)[np.newaxis]


def _l2_norm(emb: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(emb)
    return (emb / norm).astype(np.float32) if norm > 1e-8 else emb.astype(np.float32)


# ── MBF embedding — FIXED ─────────────────────────────────────────────────────
def _embed_via_mbf(aligned_bgr: np.ndarray) -> np.ndarray:
    """
    Extract embedding using InsightFace MBF via get_feat().
    get_feat() accepts a pre-aligned 112x112 BGR image directly —
    no detection step needed, no padding tricks.
    """
    # get_feat expects (1, 3, 112, 112) float32 in [-1, 1] RGB
    # BUT InsightFace's get_feat internally handles the preprocessing,
    # so we just pass the raw 112x112 BGR crop directly.
    emb = _mbf_rec_model.get_feat(aligned_bgr)
    return _l2_norm(np.array(emb).flatten())


# ── Public API ─────────────────────────────────────────────────────────────────

def get_embedding(img_bgr: np.ndarray, landmarks: list = None,
                  raw_width: int = 9999) -> np.ndarray:
    """
    Align and embed a single face crop.

    Args:
        img_bgr:   BGR face crop.
        landmarks: 5-point facial landmarks in crop coordinates.
        raw_width: Width of the face bbox in original frame pixels.
                   Values < ENHANCE_THRESHOLD trigger GFPGAN restoration.
                   Pass det["raw_width"] from the detector.

    Returns:
        np.ndarray shape (512,), float32, L2-normalised.
    """
    crop    = img_bgr   # SR already applied by pipeline before this call
    aligned = _align_face(crop, landmarks or [])
    aligned = _apply_clahe(aligned)

    if USE_INSIGHTFACE_FALLBACK:
        return _embed_via_mbf(aligned)

    tensor = _prepare_tensor(aligned)
    emb    = _session.run(None, {_input_name: tensor})[0][0]
    return _l2_norm(emb)


def get_embeddings_batch(crops_and_landmarks: list) -> list:
    """
    Embed multiple face crops.

    crops_and_landmarks: list of (crop_bgr, landmarks, raw_width)
      raw_width is optional — if the tuple is only 2 elements, enhancement
      is skipped (raw_width defaults to 9999 = "large face, no enhance").

    MBF fallback: one by one (no batch API).
    GhostFaceNet ONNX: single GPU call for all crops.
    """
    if not crops_and_landmarks:
        return []

    if USE_INSIGHTFACE_FALLBACK:
        results = []
        for item in crops_and_landmarks:
            if len(item) == 3:
                crop, lm, rw = item
            else:
                crop, lm = item; rw = 9999
            results.append(get_embedding(crop, lm, rw))
        return results

    tensors = []
    for item in crops_and_landmarks:
        if len(item) == 3:
            crop_bgr, landmarks, rw = item
        else:
            crop_bgr, landmarks = item; rw = 9999
        # crop_bgr already SR-enhanced by pipeline — no additional enhance call needed
        aligned  = _align_face(crop_bgr, landmarks or [])
        aligned  = _apply_clahe(aligned)
        tensors.append(_prepare_tensor(aligned)[0])

    batch = np.stack(tensors, axis=0)
    embs  = _session.run(None, {_input_name: batch})[0]
    return [_l2_norm(emb) for emb in embs]


def warmup():
    dummy = np.zeros((112, 112, 3), dtype=np.uint8)
    get_embedding(dummy)
    print("[Recognizer] Warmup complete.")