# backend/test_upload.py
# Simulates what the frontend sends during enrolment
# Run this while the server is STOPPED

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

# ── Test 1: Can detector find a face in a REAL photo? ─────────────────────────
print("=" * 60)
print("TEST 1: Take a real photo with your webcam right now")
print("=" * 60)

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("ERROR: Cannot open webcam")
else:
    # Wait for camera to warm up
    for _ in range(10):
        cap.read()

    ret, frame = cap.read()
    cap.release()

    if ret:
        cv2.imwrite("test_capture.jpg", frame)
        print(f"Captured frame: {frame.shape} | Mean brightness: {frame.mean():.1f}")

        dets = detect(frame)
        print(f"Faces detected: {len(dets)}")

        if dets:
            print("SUCCESS — detector works on real webcam photo")
            for i, d in enumerate(dets):
                print(f"  Face {i+1}: conf={d['conf']:.3f} bbox={[int(v) for v in d['bbox']]}")

            # Test embedding
            best = max(dets, key=lambda d: d["conf"])
            x1,y1,x2,y2 = [int(v) for v in best["bbox"]]
            h,w = frame.shape[:2]
            pw = int((x2-x1)*0.2); ph = int((y2-y1)*0.2)
            x1=max(0,x1-pw); y1=max(0,y1-ph)
            x2=min(w,x2+pw); y2=min(h,y2+ph)
            crop = frame[y1:y2, x1:x2]
            emb = get_embedding(crop, best["landmarks"])
            print(f"  Embedding norm: {np.linalg.norm(emb):.4f}")
        else:
            print("FAIL — detector found NO faces in webcam photo")
            print("Saved as test_capture.jpg — open it and check if your face is visible")
    else:
        print("ERROR: Could not read frame from webcam")

# ── Test 2: Enrol using the real webcam photo ─────────────────────────────────
print()
print("=" * 60)
print("TEST 2: Enrol first student using real webcam photo")
print("=" * 60)

if os.path.exists("test_capture.jpg"):
    img = cv2.imread("test_capture.jpg")
    student = db.query(models.Student).first()
    print(f"Enrolling: {student.name}")
    result = pipeline.enroll_student(student.id, [img], db)
    print(f"Result: {result}")

    db.expire(student)
    fresh = db.query(models.Student).filter(models.Student.id == student.id).first()
    print(f"Embedding saved: {'YES' if fresh.embedding else 'NO'}")