"""
backend/test_recognition.py
Tests recognition against an image file (avoids camera lock conflicts).

Usage:
  python test_recognition.py               # uses test_face.jpg if present
  python test_recognition.py myface.jpg    # use any image
"""
import sys, os, json
sys.path.insert(0, os.path.abspath("."))

import cv2
import numpy as np
from database import get_db
import models
from vision.pipeline import pipeline, COSINE_THRESHOLD, MIN_MARGIN, VOTE_THRESHOLD
from vision.detector import detect_tiled_enhanced
from vision.recognizer import get_embedding
from vision.enhancer import enhance_face

# ── Load index ────────────────────────────────────────────────────────────────
db = next(get_db())
pipeline.reload_index(db)

n_templates = len(pipeline._index_ids)
n_students  = len(set(pipeline._index_ids))
print(f"\n[Test] Index: {n_templates} templates for {n_students} students")
print(f"[Test] Thresholds: COSINE={COSINE_THRESHOLD}, MARGIN={MIN_MARGIN}, VOTE={VOTE_THRESHOLD}\n")

if n_templates == 0:
    print("ERROR: No students enrolled — enrol students first via the UI.")
    sys.exit(1)

# ── Student name map ──────────────────────────────────────────────────────────
students = db.query(models.Student).all()
id_to_name = {s.id: s.name for s in students}

# ── Load image ────────────────────────────────────────────────────────────────
img_path = sys.argv[1] if len(sys.argv) > 1 else "test_face.jpg"
if not os.path.exists(img_path):
    print(f"Image not found: {img_path}")
    print("Usage:  python test_recognition.py path/to/face.jpg")
    print("\nHint: save a photo from the Live Monitor preview as test_face.jpg")
    print("      OR screenshot the detection result and crop to just the frame.")
    sys.exit(1)

frame = cv2.imread(img_path)
if frame is None:
    print(f"ERROR: Could not decode image: {img_path}")
    sys.exit(1)

print(f"[Test] Image: {img_path}  ({frame.shape[1]}x{frame.shape[0]})")

# ── Detect ────────────────────────────────────────────────────────────────────
enhanced, dets, was_sr = detect_tiled_enhanced(frame)
print(f"[Test] Enhanced: {enhanced.shape[1]}x{enhanced.shape[0]} | SR={'neural' if was_sr else 'lanczos'} | Faces={len(dets)}\n")

if not dets:
    print("NO FACES DETECTED in image — try a clearer/brighter photo")
    sys.exit(0)

# ── Per-face recognition ──────────────────────────────────────────────────────
CROP_MARGIN  = 0.20
h_enh, w_enh = enhanced.shape[:2]
index_matrix = pipeline._index_matrix
index_ids    = pipeline._index_ids

for i, det in enumerate(dets):
    dx1, dy1, dx2, dy2 = [int(v) for v in det["bbox"]]
    pw  = int((dx2 - dx1) * CROP_MARGIN)
    ph  = int((dy2 - dy1) * CROP_MARGIN)
    cx1 = max(0, dx1 - pw);  cy1 = max(0, dy1 - ph)
    cx2 = min(w_enh, dx2 + pw); cy2 = min(h_enh, dy2 + ph)
    crop = enhanced[cy1:cy2, cx1:cx2]

    raw_width = det.get("raw_width", 9999)
    lm_full   = det.get("landmarks", [])
    lm_crop   = [[lx - cx1, ly - cy1] for lx, ly in lm_full] if lm_full else []

    crop, face_enhanced = enhance_face(crop, raw_width)
    if face_enhanced and lm_crop:
        orig_h = cy2 - cy1; orig_w = cx2 - cx1
        new_h, new_w = crop.shape[:2]
        sx = new_w / max(orig_w, 1); sy = new_h / max(orig_h, 1)
        lm_crop = [[lx * sx, ly * sy] for lx, ly in lm_crop]

    emb = get_embedding(crop, lm_crop, raw_width)

    # Cosine similarity
    sims = index_matrix @ emb
    per_student: dict = {}
    for idx, sid in enumerate(index_ids):
        s = float(sims[idx])
        if s > per_student.get(sid, -1.0):
            per_student[sid] = s

    ranked = sorted(per_student.items(), key=lambda kv: kv[1], reverse=True)
    best_sid, best_score = ranked[0]
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = best_score - second_score

    print(f"── Face {i+1} ─────────────────────────────────")
    print(f"   Size:      {det['face_size']}px  |  det_conf={det['conf']:.2f}  |  face_sr={'yes' if face_enhanced else 'no'}")
    print(f"   Scores vs enrolled students:")
    for sid, score in ranked:
        name = id_to_name.get(sid, f"id{sid}")
        bar  = "█" * int(score * 40)
        marker = " ← BEST" if sid == best_sid else ""
        print(f"     {name:20s}  {score:.4f}  {bar}{marker}")

    print(f"   Threshold: {COSINE_THRESHOLD} (need score ≥ this)")
    print(f"   Margin:    {margin:.4f} (need ≥ {MIN_MARGIN})")

    if best_score >= COSINE_THRESHOLD and margin >= MIN_MARGIN:
        print(f"   ✓ RECOGNISED: {id_to_name.get(best_sid,'?')} (score={best_score:.4f})")
    else:
        reasons = []
        if best_score < COSINE_THRESHOLD:
            reasons.append(f"score {best_score:.3f} < {COSINE_THRESHOLD}")
        if margin < MIN_MARGIN:
            reasons.append(f"margin {margin:.3f} < {MIN_MARGIN}")
        print(f"   ✗ UNKNOWN  ({', '.join(reasons)})")
    print()

# ── Save annotated image ──────────────────────────────────────────────────────
out_path = "test_recognition_result.jpg"
vis = enhanced.copy()
for det in dets:
    x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
    cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 255, 0), 2)
    cv2.putText(vis, f"{det['face_size']}px {det['conf']:.2f}",
                (x1, max(0, y1-6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0,255,0), 1)
max_w = 1280
if vis.shape[1] > max_w:
    vis = cv2.resize(vis, (max_w, int(vis.shape[0] * max_w / vis.shape[1])))
cv2.imwrite(out_path, vis)
print(f"[Test] Annotated result → {out_path}")
print(f"\n── Summary ────────────────────────────────────────")
print(f"  If all scores are LOW (< 0.25): students are not properly enrolled")
print(f"    → Re-enrol with better lighting photos from the UI")
print(f"  If scores are MODERATE (0.25-0.40): lower COSINE_THRESH env var")
print(f"    → set COSINE_THRESH=0.28 in your .env and restart server")
print(f"  If best score is HIGH but margin is LOW (< 0.06): multiple similar faces")
print(f"    → lower MIN_MARGIN env var: set MIN_MARGIN=0.04")
