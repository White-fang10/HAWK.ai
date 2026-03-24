# backend/debug.py
from database import get_db
import models, json, numpy as np

db = next(get_db())

print("=" * 60)
print("DATABASE CHECK")
print("=" * 60)

students = db.query(models.Student).all()
print(f"Total students: {len(students)}\n")

for s in students:
    if s.embedding:
        emb = np.array(json.loads(s.embedding))
        norm = np.linalg.norm(emb)
        print(f"Name  : {s.name}")
        print(f"Length: {len(emb)}")
        print(f"Norm  : {norm:.6f}  {'<-- ZERO VECTOR (bad)' if norm < 0.1 else '<-- OK'}")
        print(f"Sample: {emb[:5]}")
        print()
    else:
        print(f"Name  : {s.name}  --> NO EMBEDDING")
        print()

print("=" * 60)
print("RECOGNIZER CHECK")
print("=" * 60)

import sys, os
sys.path.insert(0, os.path.abspath("."))

from vision.recognizer import get_embedding, USE_INSIGHTFACE_FALLBACK, _mbf_rec_model
import numpy as np
import cv2

print(f"Using fallback : {USE_INSIGHTFACE_FALLBACK}")
print(f"MBF model      : {_mbf_rec_model}")
print()

# Test with a dummy white image
dummy = np.ones((112, 112, 3), dtype=np.uint8) * 128
emb = get_embedding(dummy)
norm = np.linalg.norm(emb)
print(f"Test embedding norm : {norm:.6f}  {'<-- ZERO (broken)' if norm < 0.1 else '<-- OK (working)'}")
print(f"Test embedding sample: {emb[:5]}")