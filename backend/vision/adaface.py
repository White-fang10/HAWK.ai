"""
AdaFace IR-50 face recognition model wrapper.

Downloads adaface_ir50_webface4m.ckpt (~166 MB) on first run to ~/.hawk_models/adaface/
Falls back to InsightFace buffalo_l embedding if torch is not available.
"""

import numpy as np
import os
import cv2

# Path where the model checkpoint will be cached
_MODEL_DIR = os.path.join(os.path.expanduser("~"), ".hawk_models", "adaface")
_CKPT_NAME = "adaface_ir50_webface4m.ckpt"
_CKPT_URL = "https://github.com/mk-minchul/AdaFace/releases/download/v1.0.0/adaface_ir50_webface4m.ckpt"


def _get_ckpt_path() -> str:
    os.makedirs(_MODEL_DIR, exist_ok=True)
    return os.path.join(_MODEL_DIR, _CKPT_NAME)


class AdaFaceModel:
    """
    Wraps AdaFace IR-50 for 512-d face embedding extraction.
    On first instantiation the checkpoint is downloaded automatically.
    If PyTorch / timm is unavailable, falls back to InsightFace buffalo_l.
    """

    def __init__(self):
        self._model = None
        self._use_adaface = False
        self._insightface_app = None

        try:
            import torch
            import timm  # noqa: F401 – just verify it's importable
            self._torch = torch
            self._load_adaface()
        except ImportError as e:
            print(f"[AdaFace] torch/timm not available ({e}). Falling back to InsightFace buffalo_l.")
            self._init_insightface_fallback()

    # ──────────────────────────────────────────────────────────────────────
    # AdaFace loading
    # ──────────────────────────────────────────────────────────────────────

    def _load_adaface(self):
        import torch

        ckpt_path = _get_ckpt_path()

        if not os.path.exists(ckpt_path):
            print(f"[AdaFace] Downloading checkpoint → {ckpt_path}  (~166 MB, first-run only) …")
            self._download_ckpt(ckpt_path)

        try:
            from vision.adaface_net import build_model as _build
            self._model = _build("ir_50")
            statedict = torch.load(ckpt_path, map_location="cpu", weights_only=False)
            # The checkpoint may wrap weights under a 'state_dict' key
            sd = statedict.get("state_dict", statedict)
            # Strip 'module.' prefix if present (DataParallel artifact)
            sd = {k.replace("module.", ""): v for k, v in sd.items()}
            self._model.load_state_dict(sd, strict=False)
            self._model.eval()
            self._use_adaface = True
            print("[AdaFace] IR-50 WebFace4M loaded successfully.")
        except Exception as e:
            print(f"[AdaFace] Could not load network architecture ({e}). Falling back to InsightFace.")
            self._init_insightface_fallback()

    @staticmethod
    def _download_ckpt(dest: str):
        import urllib.request
        try:
            urllib.request.urlretrieve(_CKPT_URL, dest)
            print("[AdaFace] Download complete.")
        except Exception as e:
            print(f"[AdaFace] Download failed: {e}. Will attempt InsightFace fallback.")
            if os.path.exists(dest):
                os.remove(dest)
            raise

    def _init_insightface_fallback(self):
        try:
            from insightface.app import FaceAnalysis
            self._insightface_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
            self._insightface_app.prepare(ctx_id=0, det_size=(640, 640), det_thresh=0.25)
            print("[AdaFace] InsightFace buffalo_l fallback ready.")
        except Exception as e:
            print(f"[AdaFace] InsightFace fallback also failed: {e}. Embeddings will be unavailable.")

    # ──────────────────────────────────────────────────────────────────────
    # Public helpers
    # ──────────────────────────────────────────────────────────────────────

    def preprocess(self, crop_bgr: np.ndarray) -> "torch.Tensor":
        """
        Convert a BGR crop to a normalised [1, 3, 112, 112] float tensor
        in the range [-1, 1] expected by AdaFace IR-50.
        """
        import torch
        rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        resized = cv2.resize(rgb, (112, 112), interpolation=cv2.INTER_LANCZOS4)
        arr = resized.astype(np.float32) / 255.0          # [0, 1]
        arr = (arr - 0.5) / 0.5                            # [-1, 1]
        tensor = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)  # [1,3,112,112]
        return tensor

    def get_embedding(self, crop_bgr: np.ndarray) -> np.ndarray | None:
        """
        Returns a L2-normalised 512-d float32 embedding vector, or None on failure.
        Uses AdaFace if available, otherwise falls back to InsightFace.
        """
        if crop_bgr is None or crop_bgr.size == 0:
            return None

        if self._use_adaface and self._model is not None:
            return self._adaface_embedding(crop_bgr)
        elif self._insightface_app is not None:
            return self._insightface_embedding(crop_bgr)
        return None

    def _adaface_embedding(self, crop_bgr: np.ndarray) -> np.ndarray | None:
        import torch
        try:
            tensor = self.preprocess(crop_bgr)
            with torch.no_grad():
                emb, _ = self._model(tensor)   # AdaFace returns (embedding, norm)
            vec = emb.squeeze().cpu().numpy().astype(np.float32)
            norm = np.linalg.norm(vec)
            return vec / norm if norm > 0 else vec
        except Exception as e:
            print(f"[AdaFace] Embedding error: {e}")
            return None

    def _insightface_embedding(self, crop_bgr: np.ndarray) -> np.ndarray | None:
        try:
            faces = self._insightface_app.get(crop_bgr)
            if not faces:
                return None
            emb = faces[0].embedding.astype(np.float32)
            norm = np.linalg.norm(emb)
            return emb / norm if norm > 0 else emb
        except Exception as e:
            print(f"[AdaFace-fallback] Embedding error: {e}")
            return None
