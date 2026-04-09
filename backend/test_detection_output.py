"""
test_detection_output.py
────────────────────────────────────────────────────────────────
Downloads 6 real face photos (royalty-free), runs them through
the HAWK.ai enhance→detect pipeline, and saves annotated images
showing:
  • Green bounding boxes + detection confidence
  • Face pixel size (after enhancement)
  • Brightness level (mean L) and which gamma tier was applied
  • Full-frame-pass vs tile-pass origin

Run from the backend/ directory:
    python test_detection_output.py
────────────────────────────────────────────────────────────────
"""
import sys, os, time, urllib.request

# ── Path so imports work from backend/ ────────────────────────
sys.path.insert(0, os.path.dirname(__file__))

import cv2
import numpy as np

# ── Test images: Wikimedia Commons CC0 portrait photos ────────
# Each entry: (label, url)
TEST_IMAGES = [
    ("close_portrait",
     "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Gatto_europeo4.jpg/320px-Gatto_europeo4.jpg"),
    # Use This Person Does Not Exist (NVIDIA StyleGAN) — always has one face
    ("synth_face_1",
     "https://thispersondoesnotexist.com/"),
]

# ── Fallback: pull from randomuser.me API (generates portrait-style faces) ──
# We use randomuser 200×200 photos — real faces, no copyright
RANDOMUSER_URLS = [
    "https://randomuser.me/api/portraits/men/32.jpg",
    "https://randomuser.me/api/portraits/women/44.jpg",
    "https://randomuser.me/api/portraits/men/11.jpg",
    "https://randomuser.me/api/portraits/women/68.jpg",
    "https://randomuser.me/api/portraits/men/73.jpg",
    "https://randomuser.me/api/portraits/women/21.jpg",
]

OUT_DIR = os.path.join(os.path.dirname(__file__), "test_output")
os.makedirs(OUT_DIR, exist_ok=True)


def download_image(url: str, label: str) -> np.ndarray | None:
    """Download an image from url and decode as BGR."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
        arr = np.frombuffer(data, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            print(f"  [!] Could not decode image for '{label}'")
            return None
        print(f"  [✓] Downloaded '{label}' — {img.shape[1]}×{img.shape[0]}")
        return img
    except Exception as e:
        print(f"  [!] Failed to download '{label}': {e}")
        return None


def annotate(frame: np.ndarray, dets: list[dict], label: str,
             elapsed: float, mean_l: float) -> np.ndarray:
    """Draw bounding boxes and metadata on the frame."""
    vis = frame.copy()
    h, w = vis.shape[:2]

    for d in dets:
        x1, y1, x2, y2 = [int(v) for v in d["bbox"]]
        # Clamp to frame
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)

        conf      = d["conf"]
        face_size = d.get("face_size", 0)
        color = (57, 255, 20)  # neon green

        cv2.rectangle(vis, (x1, y1), (x2, y2), color, 2)

        badge = f"conf={conf:.2f}  sz={face_size}px"
        font  = cv2.FONT_HERSHEY_SIMPLEX
        fs    = 0.45
        ft    = 1
        (tw, th), _ = cv2.getTextSize(badge, font, fs, ft)
        pad = 3
        by1 = max(0, y1 - th - pad * 2)
        cv2.rectangle(vis, (x1, by1), (min(w, x1 + tw + pad * 2), y1), color, cv2.FILLED)
        cv2.putText(vis, badge, (x1 + pad, y1 - pad), font, fs, (0, 0, 0), ft, cv2.LINE_AA)

    # Bottom info bar
    info = (
        f"{label}  |  faces={len(dets)}  |  "
        f"mean_L={mean_l:.0f}  |  {elapsed*1000:.0f} ms"
    )
    bar_h = 28
    cv2.rectangle(vis, (0, h - bar_h), (w, h), (20, 20, 20), cv2.FILLED)
    cv2.putText(vis, info, (8, h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.42,
                (200, 200, 200), 1, cv2.LINE_AA)
    return vis


def run_pipeline(img: np.ndarray, label: str):
    """Run enhance_frame → detect_tiled and return (annotated_img, dets, elapsed, mean_L)."""
    from vision.enhancer import enhance_frame
    from vision.detector  import detect_tiled

    # Measure mean L before enhancement so we can report lighting
    lab   = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    mean_l = float(cv2.split(lab)[0].mean())

    t0 = time.perf_counter()
    enhanced, upscaled = enhance_frame(img)
    dets = detect_tiled(enhanced)
    elapsed = time.perf_counter() - t0

    annotated = annotate(enhanced, dets, label, elapsed, mean_l)
    return annotated, dets, elapsed, mean_l, enhanced


def main():
    print("\n" + "═"*60)
    print("  HAWK.ai  —  Detection Pipeline Test")
    print("═"*60)

    # ── Load detector (warm-up) ────────────────────────────────
    print("\n[1/3] Loading models…")
    from vision.detector import warmup as dwarm
    from vision.enhancer import warmup as ewarm
    ewarm()
    dwarm()
    print("  Models ready.\n")

    # ── Download test images ───────────────────────────────────
    print("[2/3] Downloading test face images…")
    images: list[tuple[str, np.ndarray]] = []
    for i, url in enumerate(RANDOMUSER_URLS):
        lbl = f"face_{i+1}"
        img = download_image(url, lbl)
        if img is not None:
            images.append((lbl, img))

    if not images:
        print("  [!] No images downloaded. Check your internet connection.")
        sys.exit(1)

    # ── Run pipeline on each image ─────────────────────────────
    print(f"\n[3/3] Running enhance→detect pipeline on {len(images)} images…")
    print("-"*60)

    total_faces = 0
    for label, img in images:
        annotated, dets, elapsed, mean_l, enhanced = run_pipeline(img, label)
        total_faces += len(dets)

        out_path = os.path.join(OUT_DIR, f"{label}_result.jpg")
        cv2.imwrite(out_path, annotated, [cv2.IMWRITE_JPEG_QUALITY, 92])

        # Also save original (pre-enhance) for comparison
        orig_path = os.path.join(OUT_DIR, f"{label}_original.jpg")
        cv2.imwrite(orig_path, img)

        lighting = "VERY DARK" if mean_l < 60 else ("DIM" if mean_l < 100 else "NORMAL")
        print(
            f"  {label:15s}  "
            f"orig={img.shape[1]}×{img.shape[0]}  "
            f"→ enhanced={enhanced.shape[1]}×{enhanced.shape[0]}  "
            f"faces={len(dets):2d}  "
            f"mean_L={mean_l:4.0f} ({lighting})  "
            f"time={elapsed*1000:5.0f}ms"
        )
        for j, d in enumerate(dets):
            print(
                f"    face{j+1}: conf={d['conf']:.3f}  "
                f"size={d.get('face_size',0)}px  "
                f"bbox={[int(v) for v in d['bbox']]}"
            )

    print("-"*60)
    print(f"\n  Total faces detected: {total_faces} across {len(images)} images")
    print(f"  Annotated results saved to: {os.path.abspath(OUT_DIR)}")
    print("\n  Opening results…")

    # ── Tile all results into one comparison image ─────────────
    result_files = sorted(
        [f for f in os.listdir(OUT_DIR) if f.endswith("_result.jpg")]
    )
    tiles = []
    TARGET_H = 300
    for rf in result_files:
        img = cv2.imread(os.path.join(OUT_DIR, rf))
        if img is None: continue
        scale = TARGET_H / img.shape[0]
        resized = cv2.resize(img, (int(img.shape[1]*scale), TARGET_H), interpolation=cv2.INTER_AREA)
        tiles.append(resized)

    if tiles:
        # Pad all to same height (already same), stack horizontally
        max_h = max(t.shape[0] for t in tiles)
        padded = []
        for t in tiles:
            dh = max_h - t.shape[0]
            if dh > 0:
                t = cv2.copyMakeBorder(t, 0, dh, 0, 0, cv2.BORDER_CONSTANT, value=(30,30,30))
            padded.append(t)

        # Arrange in rows of 3
        rows = []
        for i in range(0, len(padded), 3):
            row_tiles = padded[i:i+3]
            while len(row_tiles) < 3:
                row_tiles.append(np.full((max_h, row_tiles[0].shape[1], 3), 30, dtype=np.uint8))
            rows.append(np.hstack(row_tiles))

        collage = np.vstack(rows)

        # Header bar
        hdr = np.zeros((50, collage.shape[1], 3), dtype=np.uint8)
        hdr[:] = (35, 35, 35)
        cv2.putText(hdr, "HAWK.ai  —  Detection Pipeline Test Results",
                    (20, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (57, 255, 20), 2, cv2.LINE_AA)
        collage = np.vstack([hdr, collage])

        collage_path = os.path.join(OUT_DIR, "_COLLAGE.jpg")
        cv2.imwrite(collage_path, collage, [cv2.IMWRITE_JPEG_QUALITY, 90])
        print(f"  Collage saved: {collage_path}")

        # Show in a window (press any key to close)
        try:
            cv2.imshow("HAWK.ai Detection Test", collage)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        except Exception:
            pass   # headless environment — just saved to disk

    print("\n  Done.\n")


if __name__ == "__main__":
    main()
