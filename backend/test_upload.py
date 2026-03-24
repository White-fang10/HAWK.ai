import sys, os
sys.path.insert(0, os.path.abspath("."))

import cv2
import numpy as np
from vision.detector import detect
from vision.recognizer import get_embedding
from vision.pipeline import pipeline
from database import get_db
import models

db = next(get_db())

print("Testing webcam capture...")
cap = cv2.VideoCapture(0)
for _ in range(10):
    cap.read()
ret, frame = cap.read()
cap.release()

if not ret:
    print("ERROR: Cannot open webcam index 0")
    sys.exit()

cv2.imwrite("test_capture.jpg", frame)
print(f"Frame shape: {frame.shape}")
print(f"Mean brightness: {frame.mean():.1f}")

print("\nRunning detector...")
dets = detect(frame)
print(f"Faces found: {len(dets)}")

if not dets:
    print("FAIL - no faces detected")
    print("Open test_capture.jpg and check if your face is visible in it")
    sys.exit()

for d in dets:
    print(f"  conf={d['conf']:.3f}  bbox={[int(v) for v in d['bbox']]}")

print("\nTesting enrolment...")
student = db.query(models.Student).first()
print(f"Student: {student.name} (id={student.id})")
result = pipeline.enroll_student(student.id, [frame], db)
print(f"Result: {result}")

db.expire(student)
fresh = db.query(models.Student).filter(models.Student.id == student.id).first()
if fresh.embedding:
    import json
    emb = np.array(json.loads(fresh.embedding))
    print(f"Embedding saved: YES  norm={np.linalg.norm(emb):.4f}")
else:
    print("Embedding saved: NO")