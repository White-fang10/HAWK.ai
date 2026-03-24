"""
migrate_add_embeddings.py
─────────────────────────
Safe, idempotent migration to add the `embeddings` column to the `students`
table. Run once after updating models.py.

Usage:
  cd backend
  venv\Scripts\python.exe migrate_add_embeddings.py
"""

import sys, os
sys.path.insert(0, os.path.abspath("."))

from database import engine
from sqlalchemy import text, inspect

inspector = inspect(engine)
columns   = [c["name"] for c in inspector.get_columns("students")]

if "embeddings" in columns:
    print("[Migration] Column 'embeddings' already exists — nothing to do.")
else:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE students ADD COLUMN embeddings TEXT"))
        conn.commit()
    print("[Migration] ✓ Added 'embeddings' column to students table.")

print("[Migration] Done. Restart the backend to pick up the schema change.")
