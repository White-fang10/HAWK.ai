# backend/test_enroll.py
# Tests the full enrolment pipeline end to end
import sys, os
sys.path.insert(0, os.path.abspath("."))

import cv2
import numpy as np
from database import get_db
import models
from vision.pipeline import pipeline

db = next(get_db())

# List students
students = db.query(models.Student).all()
print(f"Students: {[s.name for s in students]}\n")

# Pick first student
s = students[0]
print(f"Testing enrolment for: {s.name} (id={s.id})")

# Create a test image — white face on grey background
# In real use this comes from the camera
test_img = np.ones((480, 640, 3), dtype=np.uint8) * 128
# Draw a rough face-like oval so detector has something to find
cv2.ellipse(test_img, (320, 240), (100, 130), 0, 0, 360, (200, 180, 160), -1)
cv2.circle(test_img, (285, 210), 15, (80, 60, 40), -1)   # left eye
cv2.circle(test_img, (355, 210), 15, (80, 60, 40), -1)   # right eye
cv2.ellipse(test_img, (320, 300), (40, 20), 0, 0, 180, (80, 60, 40), -1)  # mouth

print("\nStep 1: Testing detector...")
from vision.detector import detect_tiled_enhanced
enhanced, dets, was_sr = detect_tiled_enhanced(test_img)
print(f"  Enhanced frame: {enhanced.shape[1]}×{enhanced.shape[0]}, SR={'yes' if was_sr else 'no'}")
print(f"  Detections: {len(dets)}")

print("\nStep 2: Testing recognizer directly...")
from vision.recognizer import get_embedding
dummy_crop = np.ones((112, 112, 3), dtype=np.uint8) * 150
emb = get_embedding(dummy_crop)
import numpy as np
print(f"  Embedding norm: {np.linalg.norm(emb):.4f}  (should be 1.0)")

print("\nStep 3: Testing pipeline.enroll_student...")
# Use a real-looking image
real_test = np.ones((480, 640, 3), dtype=np.uint8) * 200
result = pipeline.enroll_student(s.id, [real_test], db)
print(f"  Result: {result}")

print("\nStep 4: Checking database after enrolment...")
db.expire(s)
s_fresh = db.query(models.Student).filter(models.Student.id == s.id).first()
if s_fresh.embedding:
    import json
    emb2 = np.array(json.loads(s_fresh.embedding))
    print(f"  Embedding saved: YES")
    print(f"  Norm: {np.linalg.norm(emb2):.4f}")
else:
    print(f"  Embedding saved: NO  <-- PROBLEM IS HERE")

print("\nStep 5: Reloading index...")
pipeline.reload_index(db)
print(f"  Index size: {len(pipeline._index_ids)}")