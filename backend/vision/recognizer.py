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

# ── CLAHE — FIXED ──────────────────────────────────────────────────────────────
# tileGridSize=(8,8) is correct for 112x112 ArcFace-style crops
# (4,4) was wrong → tiles were 28x28px → aggressive local contrast that
# introduces block artifacts and corrupts embeddings
_clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


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
    """Apply CLAHE only in dark/poor-contrast images; skip if already well-lit."""
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    # Skip CLAHE if the image is already bright enough (mean L > 140 out of 255)
    # Avoids destroying contrast in well-lit classroom shots
    if float(l.mean()) > 140:
        return crop
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

def get_embedding(img_bgr: np.ndarray, landmarks: list = None) -> np.ndarray:
    """
    Align and embed a single face crop.
    Returns np.ndarray shape (512,), float32, L2-normalised.
    """
    aligned = _align_face(img_bgr, landmarks or [])
    aligned = _apply_clahe(aligned)

    if USE_INSIGHTFACE_FALLBACK:
        return _embed_via_mbf(aligned)

    tensor = _prepare_tensor(aligned)
    emb    = _session.run(None, {_input_name: tensor})[0][0]
    return _l2_norm(emb)


def get_embeddings_batch(crops_and_landmarks: list) -> list:
    """
    Embed multiple face crops.
    MBF fallback: one by one (no batch API).
    GhostFaceNet ONNX: single GPU call for all crops.
    """
    if not crops_and_landmarks:
        return []

    if USE_INSIGHTFACE_FALLBACK:
        return [get_embedding(crop, lm) for crop, lm in crops_and_landmarks]

    tensors = []
    for crop_bgr, landmarks in crops_and_landmarks:
        aligned = _align_face(crop_bgr, landmarks or [])
        aligned = _apply_clahe(aligned)
        tensors.append(_prepare_tensor(aligned)[0])

    batch = np.stack(tensors, axis=0)
    embs  = _session.run(None, {_input_name: batch})[0]
    return [_l2_norm(emb) for emb in embs]


def warmup():
    dummy = np.zeros((112, 112, 3), dtype=np.uint8)
    get_embedding(dummy)
    print("[Recognizer] Warmup complete.")