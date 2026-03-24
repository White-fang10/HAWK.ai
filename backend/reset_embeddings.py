"""
Hawk.ai — reset_embeddings.py
==============================
Clears all stored face embeddings from the database so students can be
re-enrolled with the new AdaFace IR-50 model.

Student records (name, roll, email, phone) are KEPT.
Only the face embedding data is cleared.

Run from the backend directory:
    python reset_embeddings.py

Options:
    python reset_embeddings.py --full   # Also reset attendance percentages and status
"""

import sys
import os

# Ensure we are in the backend directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
import models

def reset_embeddings(full: bool = False):
    db = SessionLocal()
    try:
        students = db.query(models.Student).all()
        count = 0
        for s in students:
            s.embedding = None
            if full:
                s.attendance_percentage = 0.0
                s.current_status = models.StatusEnum.absent
            count += 1
        db.commit()
        print(f"✅ Cleared embeddings for {count} student(s).")
        if full:
            print("   Also reset attendance percentages and status to 'absent'.")
        print("\nAll students must now be re-enrolled via the Student Directory.")
        print("Use 'Add Student → Upload Photo' or 'Live Capture' for each student.")
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    full = "--full" in sys.argv
    print("=" * 55)
    print("  Hawk.ai — Reset Face Embeddings")
    print("=" * 55)
    if full:
        print("MODE: Full reset (embeddings + attendance + status)")
    else:
        print("MODE: Embeddings only (student records kept)")
    print()
    reset_embeddings(full=full)
