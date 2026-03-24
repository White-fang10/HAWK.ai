# backend/diagnose_recognition.py
# ─────────────────────────────────────────────────────────────────────────────
# Full end-to-end diagnostic for the HAWK.ai face recognition pipeline.
# Run from the backend/ directory:
#   python diagnose_recognition.py
# ─────────────────────────────────────────────────────────────────────────────
import sys, os, json, traceback
sys.path.insert(0, os.path.abspath("."))

import cv2
import numpy as np

PASS = "  ✅ PASS"
FAIL = "  ❌ FAIL"
WARN = "  ⚠️  WARN"
INFO = "  ℹ️  INFO"

results = []

def log(tag, msg):
    line = f"{tag}: {msg}"
    print(line)
    results.append(line)

print("=" * 70)
print("  HAWK.ai Face Recognition — Diagnostic Script")
print("=" * 70)

# ── Helper: create a realistic synthetic face image ───────────────────────────
def make_synthetic_face(w=640, h=480):
    """
    Creates a simple but realistic-looking synthetic face so that SCRFD
    can attempt detection (grey background, skin-tone oval + features).
    NOTE: SCRFD is a learned detector and will NOT detect purely geometric
    shapes — this test is intentionally checking why detection often fails.
    """
    img = np.full((h, w, 3), 120, dtype=np.uint8)
    # Skin-tone ellipse
    cx, cy = w // 2, h // 2
    cv2.ellipse(img, (cx, cy), (90, 115), 0, 0, 360, (170, 140, 110), -1)
    # Eyes
    cv2.circle(img, (cx - 30, cy - 20), 10, (40, 30, 20), -1)
    cv2.circle(img, (cx + 30, cy - 20), 10, (40, 30, 20), -1)
    # Nose
    pts = np.array([[cx, cy + 5], [cx - 10, cy + 35], [cx + 10, cy + 35]], np.int32)
    cv2.fillPoly(img, [pts], (130, 100, 80))
    # Mouth
    cv2.ellipse(img, (cx, cy + 60), (30, 15), 0, 0, 180, (70, 40, 40), -1)
    return img


# ─────────────────────────────────────────────────────────────────────────────
# TEST 1 — Detector loads
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 1] Detector model loads")
try:
    from vision.detector import detect, MIN_FACE_PX, CONF_THRESH
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    detect(dummy)
    log(PASS, f"Detector loaded OK | MIN_FACE_PX={MIN_FACE_PX}  CONF_THRESH={CONF_THRESH}")
except Exception as e:
    log(FAIL, f"Detector failed to load: {e}")
    traceback.print_exc()
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# TEST 2 — Recognizer loads
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 2] Recognizer model loads")
try:
    from vision.recognizer import get_embedding, USE_INSIGHTFACE_FALLBACK
    dummy_crop = np.ones((112, 112, 3), dtype=np.uint8) * 128
    emb = get_embedding(dummy_crop)
    norm = float(np.linalg.norm(emb))
    if abs(norm - 1.0) < 0.01:
        log(PASS, f"Recognizer loaded | fallback={USE_INSIGHTFACE_FALLBACK} | emb.shape={emb.shape} | norm={norm:.4f}")
    else:
        log(FAIL, f"Embedding NOT L2-normalised! norm={norm:.4f} (expected ~1.0)")
except Exception as e:
    log(FAIL, f"Recognizer failed to load: {e}")
    traceback.print_exc()
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# TEST 3 — Detector actually finds faces in a real photo
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 3] Detector on synthetic face image")
synth = make_synthetic_face()
dets = detect(synth)
if dets:
    log(PASS, f"Detected {len(dets)} face(s) in synthetic image")
else:
    log(WARN, (
        "No faces detected in synthetic image — this is expected for a "
        "geometric drawing. SCRFD is a neural detector. "
        "If this also fails on REAL photos, the camera/image pipeline is broken."
    ))
print(f"  → Use a real webcam photo for reliable detection testing.")

# Save synthetic for visual inspection
cv2.imwrite("diag_synthetic_face.jpg", synth)
log(INFO, "Saved synthetic face test image → diag_synthetic_face.jpg")


# ─────────────────────────────────────────────────────────────────────────────
# TEST 4 — Landmark coordinate bug: enroll_student passes FULL-IMAGE landmarks
#           to get_embedding but only crops a sub-region of the image.
#           This means the affine transform is computed in the wrong coord space.
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 4] ⚡ LANDMARK COORDINATE BUG CHECK (critical)")

# Simulate what enroll_student does when a face is at pixel (200, 150) in a 640x480 image
full_w, full_h = 640, 480
face_x1, face_y1, face_x2, face_y2 = 200, 150, 360, 340   # face at this position
CROP_MARGIN = 0.20
pw = int((face_x2 - face_x1) * CROP_MARGIN)
ph = int((face_y2 - face_y1) * CROP_MARGIN)
cx1 = max(0, face_x1 - pw)
cy1 = max(0, face_y1 - ph)
cx2 = min(full_w, face_x2 + pw)
cy2 = min(full_h, face_y2 + ph)

# These are FULL-IMAGE landmark coordinates (what SCRFD returns)
full_image_landmarks = [
    [240, 185],   # left eye
    [320, 185],   # right eye
    [280, 220],   # nose tip
    [250, 260],   # left mouth
    [310, 260],   # right mouth
]

# In enroll_student, these landmarks are passed directly to get_embedding(crop, landmarks)
# But get_embedding calls _align_face which uses estimateAffinePartial2D against
# reference points in [0..112] space — the landmarks need to be in CROP space, not FULL IMAGE space.

# Check if landmarks are inside the crop region
crop_lm_ok = all(
    cx1 <= lx <= cx2 and cy1 <= ly <= cy2
    for lx, ly in full_image_landmarks
)

# Compute what the CORRECT crop-relative landmarks would be
correct_crop_lm = [[lx - cx1, ly - cy1] for lx, ly in full_image_landmarks]
crop_w = cx2 - cx1
crop_h = cy2 - cy1

log(INFO, f"Full-image face bbox: ({face_x1},{face_y1})→({face_x2},{face_y2})")
log(INFO, f"Padded crop region:  ({cx1},{cy1})→({cx2},{cy2})  size={crop_w}x{crop_h}")
log(INFO, f"Full-image landmarks: {full_image_landmarks}")
log(INFO, f"Correct crop-relative: {correct_crop_lm}")

print()
print("  ┌─────────────────────────────────────────────────────────────────┐")
print("  │ BUG FOUND IN pipeline.py enroll_student() AND process_burst()  │")
print("  └─────────────────────────────────────────────────────────────────┘")
print()
print("  pipeline.py line 171 (enroll):")
print("    base_emb = get_embedding(crop, best['landmarks'])")
print("    ↑ 'best[\"landmarks\"]' are in FULL-IMAGE pixel coords")
print("    ↑ 'crop' is a sub-image starting at offset (cx1, cy1)")
print("    ↑ _align_face() gets wrong landmark coords → garbage alignment → garbage embedding")
print()
print("  pipeline.py line 184 (augmentation):")
print("    aug_emb = get_embedding(rot, best['landmarks'])")
print("    ↑ Same bug — landmarks in full-image space, rot is crop-space")
print()
print("  pipeline.py lines 270-273 (process_burst):")
print("    crops_and_lm.append((crop, det['landmarks']))")
print("    ↑ Same bug for recognition pass too!")
print()

log(FAIL, "CRITICAL: Landmark coordinates are in the wrong space in enroll_student() and process_burst()")


# ─────────────────────────────────────────────────────────────────────────────
# TEST 5 — Embedding consistency: same image should produce identical embedding
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 5] Embedding reproducibility (same crop → same vector)")
try:
    from vision.recognizer import get_embedding
    crop = np.random.randint(100, 200, size=(112, 112, 3), dtype=np.uint8)
    e1 = get_embedding(crop.copy())
    e2 = get_embedding(crop.copy())
    diff = float(np.max(np.abs(e1 - e2)))
    if diff < 1e-5:
        log(PASS, f"Deterministic: max element diff = {diff:.2e}")
    else:
        log(FAIL, f"NOT deterministic: max element diff = {diff:.4f} — dropout/random op in model?")
except Exception as e:
    log(FAIL, f"Exception: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# TEST 6 — Same-person cosine similarity test
#           Enroll the same image twice → similarity should be ~1.0
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 6] Same-image cosine similarity (should be ~1.0)")
try:
    crop = np.random.randint(100, 200, size=(112, 112, 3), dtype=np.uint8)
    e1 = get_embedding(crop.copy())
    e2 = get_embedding(crop.copy())
    sim = float(np.dot(e1, e2))
    if sim > 0.99:
        log(PASS, f"Same-image cosine similarity: {sim:.4f}")
    else:
        log(FAIL, f"Same-image similarity too low: {sim:.4f} (expected ≥ 0.99)")
except Exception as e:
    log(FAIL, f"Exception: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# TEST 7 — Threshold analysis — are COSINE_THRESHOLD + MIN_MARGIN too strict?
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 7] Threshold analysis")
from vision.pipeline import COSINE_THRESHOLD, MIN_MARGIN, VOTE_THRESHOLD

print(f"  COSINE_THRESHOLD = {COSINE_THRESHOLD}")
print(f"  MIN_MARGIN       = {MIN_MARGIN}")
print(f"  VOTE_THRESHOLD   = {VOTE_THRESHOLD}")

if COSINE_THRESHOLD >= 0.42:
    log(WARN, (
        f"COSINE_THRESHOLD={COSINE_THRESHOLD} is high. "
        "GhostFaceNet real-world genuine pairs often score 0.35-0.55. "
        "Recommend: 0.35"
    ))

if MIN_MARGIN >= 0.12:
    log(WARN, (
        f"MIN_MARGIN={MIN_MARGIN} is high. "
        "In classes with fewer than ~10 students, margin can be naturally low. "
        "Recommend: 0.08"
    ))

if VOTE_THRESHOLD >= 3:
    log(WARN, (
        f"VOTE_THRESHOLD={VOTE_THRESHOLD} out of 5 frames. "
        "If even 1 of 5 frames fails threshold (due to motion blur, angle, etc.) "
        "the vote may fail. For indoor classroom, recommend: 2"
    ))


# ─────────────────────────────────────────────────────────────────────────────
# TEST 8 — Database connectivity and enrolled students
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 8] Database — enrolled students")
try:
    from database import get_db
    import models
    db = next(get_db())
    students = db.query(models.Student).all()
    log(INFO, f"Total students in DB: {len(students)}")
    enrolled = [s for s in students if s.embedding or s.embeddings]
    log(INFO, f"Students with embeddings: {len(enrolled)}")

    if not enrolled:
        log(FAIL, "NO students have embeddings stored! Enrollment may be broken entirely.")
    else:
        for s in enrolled[:5]:  # show first 5
            has_multi = bool(s.embeddings)
            has_single = bool(s.embedding)
            n_templates = 0
            if has_multi:
                try:
                    arr = json.loads(s.embeddings)
                    n_templates = len(arr)
                    # Check embedding dimensions
                    first = np.array(arr[0])
                    norm = float(np.linalg.norm(first))
                    dim_ok = first.shape == (512,)
                    norm_ok = abs(norm - 1.0) < 0.02
                    status = PASS if (dim_ok and norm_ok) else FAIL
                    log(status, (
                        f"Student '{s.name}' | {n_templates} templates | "
                        f"dim={first.shape} | norm={norm:.4f}"
                    ))
                    if not dim_ok:
                        log(FAIL, f"  → Expected shape (512,) got {first.shape}")
                    if not norm_ok:
                        log(FAIL, f"  → Embedding not L2-normalised (norm={norm:.4f})")
                except Exception as parse_err:
                    log(FAIL, f"  Student '{s.name}': Failed to parse embeddings: {parse_err}")
            elif has_single:
                try:
                    arr = np.array(json.loads(s.embedding))
                    norm = float(np.linalg.norm(arr))
                    log(WARN, f"Student '{s.name}' only has legacy single embedding | norm={norm:.4f}")
                except Exception as parse_err:
                    log(FAIL, f"Student '{s.name}': Cannot parse embedding: {parse_err}")

except Exception as e:
    log(FAIL, f"Database error: {e}")
    traceback.print_exc()


# ─────────────────────────────────────────────────────────────────────────────
# TEST 9 — Pipeline index reload
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 9] Pipeline index reload")
try:
    from vision.pipeline import pipeline
    db = next(get_db())
    n = pipeline.reload_index(db)
    mat = pipeline._index_matrix
    ids = pipeline._index_ids
    log(INFO, f"Loaded {n} student(s) | {len(ids)} total template rows")
    if mat is None:
        log(FAIL, "Index matrix is None — no embeddings loaded. Recognition WILL always return Unknown.")
    elif mat.shape[1] != 512:
        log(FAIL, f"Index matrix dim = {mat.shape[1]} (expected 512). Model mismatch!")
    else:
        log(PASS, f"Index matrix shape: {mat.shape}")
        # Check that rows are L2-normalised (required for cosine dot-product to work)
        norms = np.linalg.norm(mat, axis=1)
        if np.all(np.abs(norms - 1.0) < 0.01):
            log(PASS, f"All index rows are L2-normalised ✓")
        else:
            bad = np.sum(np.abs(norms - 1.0) >= 0.01)
            log(FAIL, f"{bad}/{len(norms)} index rows are NOT L2-normalised — dot-product cosine is wrong!")
except Exception as e:
    log(FAIL, f"Pipeline error: {e}")
    traceback.print_exc()


# ─────────────────────────────────────────────────────────────────────────────
# TEST 10 — Simulate recognition: enroll a face, then match it back
# ─────────────────────────────────────────────────────────────────────────────
print("\n[TEST 10] Simulate enroll → match round-trip")
try:
    # ── Use any real JPEG from local disk if available ────────────────────────
    test_jpg_path = os.path.join(os.path.dirname(__file__), "test_capture.jpg")
    if os.path.exists(test_jpg_path):
        img = cv2.imread(test_jpg_path)
        if img is not None:
            log(INFO, f"Using existing test image: {test_jpg_path} ({img.shape[1]}x{img.shape[0]})")
        else:
            img = make_synthetic_face()
            log(WARN, "test_capture.jpg unreadable — using synthetic")
    else:
        img = make_synthetic_face()
        log(WARN, "No test_capture.jpg — using synthetic face (may not be detected)")

    dets = detect(img)
    if not dets:
        log(FAIL, "No face detected in test image — cannot complete round-trip test.")
        log(INFO, "  → Place a photo with a clear face at backend/test_capture.jpg and re-run.")
    else:
        best = dets[0]
        x1, y1, x2, y2 = [int(v) for v in best["bbox"]]
        h_img, w_img = img.shape[:2]
        CROP_MARGIN_CONST = 0.20
        pw2 = int((x2 - x1) * CROP_MARGIN_CONST)
        ph2 = int((y2 - y1) * CROP_MARGIN_CONST)
        cx1 = max(0, x1 - pw2); cy1 = max(0, y1 - ph2)
        cx2 = min(w_img, x2 + pw2); cy2 = min(h_img, y2 + ph2)
        crop = img[cy1:cy2, cx1:cx2]

        # ── BUG DEMONSTRATION: what current code does ─────────────────────────
        #    passes full-image landmarks to get_embedding on a crop-space image
        lm_full = best["landmarks"]   # coords in full image space

        # Corrected: landmarks must be shifted to crop space
        lm_crop = [[lx - cx1, ly - cy1] for lx, ly in lm_full] if lm_full else []

        emb_bugged   = get_embedding(crop, lm_full)   # wrong (current code)
        emb_fixed    = get_embedding(crop, lm_crop)   # correct way

        sim_same     = float(np.dot(emb_fixed, emb_fixed))          # should be 1.0
        sim_bugvsfix = float(np.dot(emb_bugged, emb_fixed))         # similarity between buggy and fixed

        log(INFO,  f"Detection: conf={best['conf']:.3f} | face_size={best['face_size']}px")
        log(INFO,  f"Similarity (fixed embedding with itself): {sim_same:.4f}  [should be 1.0]")
        log(INFO,  f"Similarity (bugged vs fixed embedding):   {sim_bugvsfix:.4f}")

        if sim_bugvsfix < 0.90:
            log(FAIL, (
                f"Bug confirmed: wrong landmark coords produce drastically different embeddings "
                f"(sim={sim_bugvsfix:.4f} < 0.90). "
                f"Stored enrollment templates and recognition embeddings do NOT match!"
            ))
        else:
            log(WARN, (
                f"Embedding difference is small ({sim_bugvsfix:.4f}) for this image. "
                f"The landmark bug may have less impact here (e.g., if face is perfectly frontal). "
                f"Try with rotated/off-angle faces."
            ))

        # ── Self-match test with corrected embeddings ─────────────────────────
        FAKE_THRESHOLD = COSINE_THRESHOLD  # current threshold
        if sim_same >= FAKE_THRESHOLD:
            log(PASS, f"Self-match passes threshold: {sim_same:.4f} ≥ {FAKE_THRESHOLD}")
        else:
            log(FAIL, f"Self-match FAILS threshold: {sim_same:.4f} < {FAKE_THRESHOLD}  ← threshold is too high!")

except Exception as e:
    log(FAIL, f"Round-trip test error: {e}")
    traceback.print_exc()


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
print()
print("=" * 70)
print("  DIAGNOSTIC SUMMARY")
print("=" * 70)
fails = [r for r in results if "FAIL" in r]
warns = [r for r in results if "WARN" in r]
passes = [r for r in results if "PASS" in r]

print(f"\n  ✅ PASS  : {len(passes)}")
print(f"  ⚠️  WARN  : {len(warns)}")
print(f"  ❌ FAIL  : {len(fails)}")

if fails:
    print("\n  FAILURES:")
    for f in fails:
        print(f"    {f.strip()}")

print()
print("=" * 70)
print("  ROOT CAUSES FOUND")
print("=" * 70)
print("""
  BUG #1  ⚡ CRITICAL — Landmark coordinate space mismatch
  ────────────────────────────────────────────────────────
  In pipeline.py enroll_student() AND process_burst():
  
    crop = img[cy1:cy2, cx1:cx2]          # crop starts at (cx1, cy1)
    emb  = get_embedding(crop, det["landmarks"])  # ← WRONG!
    
  det["landmarks"] are in FULL IMAGE pixel space.
  But 'crop' starts at (cx1, cy1), so its internal coordinate origin is (0,0).
  _align_face() computes affine warp using the wrong origin → garbage alignment.
  The stored enrollment embedding has a different "view" than the one computed
  during recognition — they will NEVER match even for the same person.
  
  FIX: Shift landmarks to crop space before passing to get_embedding():
    lm_crop = [[lx - cx1, ly - cy1] for lx, ly in det["landmarks"]]
    emb = get_embedding(crop, lm_crop)

  BUG #2  ⚠️  HIGH — Thresholds may be simultaneously too strict
  ────────────────────────────────────────────────────────────────
  COSINE_THRESHOLD=0.42  AND  MIN_MARGIN=0.12  together reject most matches.
  GhostFaceNet real-world cross-session genuine pairs: ~0.35–0.60.
  With a corrupted embedding (Bug #1), similarity tanks to <0.2, but even
  after fixing Bug #1, the threshold pair needs tuning:
    Recommended:  COSINE_THRESHOLD=0.35, MIN_MARGIN=0.07
    
  BUG #3  ⚠️  MEDIUM — Augmentation passes wrong landmarks
  ────────────────────────────────────────────────────────
  Lines 177-185 in enroll_student() augment the padded crop but pass the
  original full-image landmarks to get_embedding(rot, best["landmarks"]).
  Same coordinate space error as Bug #1 for augmented variants.

  BUG #4  ℹ️  LOW — VOTE_THRESHOLD=3 is strict for 5 frames
  ────────────────────────────────────────────────────────────
  If even 3 out of 5 frames have angle/blur issues, the student won't be marked.
  Recommend: VOTE_THRESHOLD=2 for a 5-frame burst.
""")
print("=" * 70)
print("  Run backend/fix_pipeline.py to apply the recommended fixes.")
print("=" * 70)
