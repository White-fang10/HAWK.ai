from fastapi import FastAPI, Depends, HTTPException, WebSocket, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date
from database import engine, Base, get_db
import models, schemas
import time
from typing import List
import uvicorn
import asyncio
import json
import cv2
import numpy as np
from contextlib import asynccontextmanager
import datetime
import io
from pydantic import BaseModel

# ✅ Create DB tables BEFORE importing pipeline (pipeline queries DB at import time)
Base.metadata.create_all(bind=engine)

from vision.pipeline import pipeline

import os

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed default admin users (must be here — on_event is ignored when lifespan is set)
    db = next(get_db())
    try:
        _seed_admin_users(db)
    finally:
        db.close()

    # Start RTSP camera stream in background ONLY if RTSP_URL is set
    rtsp_url = os.getenv("RTSP_URL", "").strip()
    if rtsp_url:
        print(f"[STARTUP] Starting RTSP stream from {rtsp_url}")
        pipeline.start_stream(rtsp_url)
    else:
        print("[STARTUP] No RTSP_URL set — running in HTTP push mode (smart board upload).")
    yield
    pipeline.stop_stream()

app = FastAPI(title="Hawk.ai Attendance Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Hawk.ai Backend API is running"}

# ─────────────────────────────────────────────
# STUDENT ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/api/students", response_model=List[schemas.StudentOut])
def get_students(db: Session = Depends(get_db)):
    students = db.query(models.Student).order_by(models.Student.roll).all()
    return [
        schemas.StudentOut(
            id=s.id, name=s.name, roll=s.roll, email=s.email, phone=s.phone,
            avatar=s.avatar or s.name[:2].upper(),
            attendance=s.attendance_percentage,
            status=s.current_status.value if s.current_status else "absent"
        ) for s in students
    ]

@app.post("/api/students", response_model=schemas.StudentOut)
def create_student(student: schemas.StudentCreate, db: Session = Depends(get_db)):
    db_student = models.Student(
        name=student.name, roll=student.roll, email=student.email,
        phone=student.phone, avatar=student.avatar,
        attendance_percentage=0.0, current_status="absent"
    )
    db.add(db_student)
    db.commit()
    db.refresh(db_student)
    return schemas.StudentOut(
        id=db_student.id, name=db_student.name, roll=db_student.roll,
        email=db_student.email, phone=db_student.phone,
        avatar=db_student.avatar or db_student.name[:2].upper(),
        attendance=db_student.attendance_percentage,
        status=db_student.current_status.value
    )

@app.delete("/api/students/{student_id}")
def delete_student(student_id: int, db: Session = Depends(get_db)):
    student = db.query(models.Student).filter(models.Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    db.delete(student)
    db.commit()
    pipeline.reload_faiss_index()
    return {"message": "Student deleted successfully"}

@app.post("/api/students/{student_id}/train")
async def train_student(student_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    student = db.query(models.Student).filter(models.Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file. Could not decode the uploaded image.")

    print(f"[TRAIN] Processing image for student {student.name} (id={student_id}), shape={img.shape}")

    embedding = pipeline.extract_embedding(img)
    if embedding is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "No face detected in the image. "
                "Please ensure the student's face is clearly visible, well-lit, "
                "and facing the camera directly."
            )
        )

    student.embedding = json.dumps(embedding.tolist())
    db.commit()
    pipeline.reload_faiss_index()
    print(f"[TRAIN] Successfully trained face for {student.name}. FAISS index has {pipeline.index.ntotal} faces.")
    return {"message": f"Face registered successfully for {student.name}. AI model updated."}

# ─────────────────────────────────────────────
# SUMMARY STATS (real data from DB)
# ─────────────────────────────────────────────

@app.get("/api/analytics/summary")
def get_summary_stats(db: Session = Depends(get_db)):
    students = db.query(models.Student).all()
    total = len(students)
    if total == 0:
        return {"total": 0, "present": 0, "absent": 0, "late": 0, "rate": 0.0}
    present = sum(1 for s in students if s.current_status and s.current_status.value == "present")
    late = sum(1 for s in students if s.current_status and s.current_status.value == "late")
    absent = total - present - late
    rate = round(((present + late) / total) * 100, 1) if total > 0 else 0.0
    return {"total": total, "present": present, "absent": absent, "late": late, "rate": rate}

# ─────────────────────────────────────────────
# ANALYTICS ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/api/analytics/distribution")
def get_attendance_distribution(db: Session = Depends(get_db)):
    """Live present/absent/late breakdown from current student statuses."""
    students = db.query(models.Student).all()
    present = sum(1 for s in students if s.current_status and s.current_status.value == "present")
    late = sum(1 for s in students if s.current_status and s.current_status.value == "late")
    absent = sum(1 for s in students if s.current_status and s.current_status.value == "absent")
    return [
        {"name": "Present", "value": present, "fill": "#219EBC"},
        {"name": "Late",    "value": late,    "fill": "#1E3A5F"},
        {"name": "Absent",  "value": absent,  "fill": "#0D1B2A"},
    ]

@app.get("/api/analytics/daily", response_model=List[schemas.DailyAttendanceOut])
def get_daily_analytics(db: Session = Depends(get_db)):
    """Return present/absent/late counts per weekday for the current Mon–Sun week.
    Falls back to mock data if no AttendanceRecord rows exist yet."""
    today = datetime.date.today()
    # Monday of the current week
    week_start = today - datetime.timedelta(days=today.weekday())

    result = []
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    # Total students for absent calculation
    total_students = db.query(models.Student).count()

    for i in range(7):
        day_date = week_start + datetime.timedelta(days=i)
        day_label = day_names[i]

        # Only include Mon–Fri (skip weekend unless there are records)
        if i >= 5:
            # Check if any records exist for this weekend day
            has_records = db.query(models.AttendanceRecord).filter(
                func.date(models.AttendanceRecord.timestamp) == day_date.isoformat()
            ).count() > 0
            if not has_records:
                continue

        present = db.query(models.AttendanceRecord).filter(
            func.date(models.AttendanceRecord.timestamp) == day_date.isoformat(),
            models.AttendanceRecord.status == models.StatusEnum.present
        ).count()

        late = db.query(models.AttendanceRecord).filter(
            func.date(models.AttendanceRecord.timestamp) == day_date.isoformat(),
            models.AttendanceRecord.status == models.StatusEnum.late
        ).count()

        # Only add this day if it's in the past or today (don't show future days)
        if day_date <= today:
            absent = max(0, total_students - present - late)
            result.append({"day": day_label, "present": present, "absent": absent, "late": late})

    # Fallback: if no real data yet, return mock data so charts aren't empty
    if not result or all(r["present"] == 0 and r["late"] == 0 for r in result):
        return [
            {"day": "Mon", "present": 0, "absent": total_students, "late": 0},
            {"day": "Tue", "present": 0, "absent": total_students, "late": 0},
            {"day": "Wed", "present": 0, "absent": total_students, "late": 0},
            {"day": "Thu", "present": 0, "absent": total_students, "late": 0},
            {"day": "Fri", "present": 0, "absent": total_students, "late": 0},
        ]

    return result

@app.get("/api/analytics/weekly", response_model=List[schemas.WeeklyAttendanceOut])
def get_weekly_analytics(db: Session = Depends(get_db)):
    """Return attendance rate per week for the last 4 weeks."""
    today = datetime.date.today()
    total_students = db.query(models.Student).count()
    result = []

    for i in range(4):
        # Start from the most recent Monday, going back i weeks
        week_start = today - datetime.timedelta(days=today.weekday()) - datetime.timedelta(weeks=i)
        week_end = week_start + datetime.timedelta(days=6)
        week_label = f"Week {4 - i}"

        if total_students == 0:
            result.insert(0, {"week": week_label, "rate": 0.0})
            continue

        # Count unique students who had at least 1 present record that week
        present_records = db.query(models.AttendanceRecord.student_id).filter(
            func.date(models.AttendanceRecord.timestamp) >= week_start.isoformat(),
            func.date(models.AttendanceRecord.timestamp) <= week_end.isoformat(),
            models.AttendanceRecord.status == models.StatusEnum.present
        ).distinct().count()

        rate = round((present_records / total_students) * 100, 1) if total_students > 0 else 0.0
        result.insert(0, {"week": week_label, "rate": rate})

    return result

@app.get("/api/analytics/insights", response_model=List[schemas.ClassInsightOut])
def get_class_insights(db: Session = Depends(get_db)):
    students = db.query(models.Student).all()
    total = len(students)
    if total == 0:
        return [{"label": "Total Students", "value": "0", "trend": "neutral"}]
    avg = round(sum(s.attendance_percentage for s in students) / total, 1)
    below75 = sum(1 for s in students if s.attendance_percentage < 75)
    top = max(students, key=lambda s: s.attendance_percentage)
    return [
        {"label": "Average Class Attendance", "value": f"{avg}%", "trend": "up"},
        {"label": "Students Below 75%", "value": str(below75), "trend": "down" if below75 > 0 else "up"},
        {"label": "Total Students", "value": str(total), "trend": "neutral"},
        {"label": "Top Attending Student", "value": top.name, "trend": "up"},
    ]

# ─────────────────────────────────────────────
# ALERTS ENDPOINT (dynamic from DB absent students)
# ─────────────────────────────────────────────

@app.get("/api/alerts", response_model=List[schemas.AlertOut])
def get_alerts(db: Session = Depends(get_db)):
    absent = db.query(models.Student).filter(
        models.Student.current_status == models.StatusEnum.absent
    ).all()
    alerts = []
    for i, s in enumerate(absent[:5], 1):
        alerts.append({
            "id": i,
            "type": "warning",
            "message": f"{s.name} has not been detected in class",
            "time": "just now"
        })
    if not alerts:
        alerts.append({
            "id": 1, "type": "info",
            "message": "All students have been detected. Attendance is on track.",
            "time": "just now"
        })
    below50 = db.query(models.Student).filter(models.Student.attendance_percentage < 50).all()
    for s in below50[:3]:
        alerts.append({
            "id": len(alerts) + 1,
            "type": "alert",
            "message": f"{s.name}'s attendance dropped below 50%",
            "time": "just now"
        })
    return alerts

# ─────────────────────────────────────────────
# ATTENDANCE RESET
# ─────────────────────────────────────────────

@app.post("/api/attendance/reset")
def reset_attendance(db: Session = Depends(get_db)):
    """Reset all students to 'absent' status for a new session."""
    db.query(models.Student).update({"current_status": models.StatusEnum.absent})
    db.commit()
    return {"message": "Attendance reset successfully. All students marked absent."}

# ─────────────────────────────────────────────
# REPORT HELPERS
# ─────────────────────────────────────────────

def _get_report_students(period: str, db: Session):
    """Return (students_with_stats, period_label, date_range_str) for the requested period."""
    today = datetime.date.today()

    if period == "daily":
        date_label = today.strftime("%d %b %Y")
        start = end = today

    elif period == "weekly":
        end = today
        start = today - datetime.timedelta(days=6)
        date_label = f"{start.strftime('%d %b')} – {end.strftime('%d %b %Y')}"

    elif period == "monthly":
        start = today.replace(day=1)
        end = today
        date_label = today.strftime("%B %Y")

    else:
        raise HTTPException(status_code=400, detail=f"Unknown period '{period}'. Use daily, weekly, or monthly.")

    students = db.query(models.Student).all()
    rows = []
    for s in students:
        # Count present records in the period
        present = db.query(models.AttendanceRecord).filter(
            models.AttendanceRecord.student_id == s.id,
            func.date(models.AttendanceRecord.timestamp) >= start.isoformat(),
            func.date(models.AttendanceRecord.timestamp) <= end.isoformat(),
            models.AttendanceRecord.status == models.StatusEnum.present
        ).count()
        status = s.current_status.value if s.current_status else "absent"
        rows.append({
            "name": s.name,
            "roll": s.roll,
            "email": s.email,
            "phone": s.phone or "—",
            "status": status.capitalize(),
            "attendance_pct": f"{s.attendance_percentage:.1f}%",
            "period_present": present,
        })

    return rows, date_label, f"{start.isoformat()} to {end.isoformat()}"


def _build_excel(rows, title: str, date_label: str) -> bytes:
    """Build an Excel workbook and return the bytes."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl not installed. Run: pip install openpyxl")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Attendance Report"

    # ── Header branding ────────────────────────────────────────────────────
    ws.merge_cells("A1:G1")
    ws["A1"] = f"🦅 Hawk.ai — {title}"
    ws["A1"].font = Font(bold=True, size=14, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor="023047")
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 28

    ws.merge_cells("A2:G2")
    ws["A2"] = f"Period: {date_label}  |  Generated: {datetime.datetime.now().strftime('%d %b %Y %H:%M')}"
    ws["A2"].font = Font(italic=True, size=10, color="555555")
    ws["A2"].alignment = Alignment(horizontal="center")
    ws.row_dimensions[2].height = 18

    # ── Column headers ─────────────────────────────────────────────────────
    headers = ["#", "Name", "Roll No.", "Email", "Phone", "Status", "Attendance %"]
    header_row = 4
    header_fill = PatternFill("solid", fgColor="219EBC")
    header_font = Font(bold=True, color="FFFFFF", size=10)
    thin = Side(style="thin", color="CCCCCC")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=header_row, column=col, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border

    # ── Data rows ──────────────────────────────────────────────────────────
    status_colors = {"Present": "D1F0F6", "Absent": "FFE5CC", "Late": "FFF4CC"}

    for i, row in enumerate(rows, 1):
        r = header_row + i
        values = [i, row["name"], row["roll"], row["email"], row["phone"], row["status"], row["attendance_pct"]]
        bg = status_colors.get(row["status"], "FFFFFF")
        row_fill = PatternFill("solid", fgColor=bg) if row["status"] != "Present" else None

        for col, val in enumerate(values, 1):
            cell = ws.cell(row=r, column=col, value=val)
            cell.alignment = Alignment(vertical="center")
            cell.border = border
            if row_fill and col == 6:
                cell.fill = row_fill
            elif col == 6 and row["status"] == "Present":
                cell.fill = PatternFill("solid", fgColor="D1F0F6")

    # ── Column widths ──────────────────────────────────────────────────────
    col_widths = [5, 24, 14, 32, 16, 12, 16]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # Summary row
    summary_row = header_row + len(rows) + 2
    ws.cell(row=summary_row, column=1, value=f"Total Students: {len(rows)}")
    ws.cell(row=summary_row, column=1).font = Font(bold=True, size=10)
    present_count = sum(1 for r in rows if r["status"] == "Present")
    ws.cell(row=summary_row, column=3, value=f"Present: {present_count}")
    ws.cell(row=summary_row, column=3).font = Font(bold=True, color="219EBC")
    absent_count = sum(1 for r in rows if r["status"] == "Absent")
    ws.cell(row=summary_row, column=5, value=f"Absent: {absent_count}")
    ws.cell(row=summary_row, column=5).font = Font(bold=True, color="FB8500")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def _build_pdf(rows, title: str, date_label: str) -> bytes:
    """Build a PDF report and return the bytes."""
    try:
        from fpdf import FPDF
    except ImportError:
        raise HTTPException(status_code=500, detail="fpdf2 not installed. Run: pip install fpdf2")

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=15)

    # ── Title ──────────────────────────────────────────────────────────────
    pdf.set_fill_color(2, 48, 71)   # #023047
    pdf.rect(0, 0, 297, 28, "F")
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_xy(10, 8)
    pdf.cell(0, 10, f"Hawk.ai  |  {title}", ln=True)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_xy(10, 19)
    pdf.cell(0, 6, f"Period: {date_label}    Generated: {datetime.datetime.now().strftime('%d %b %Y %H:%M')}")

    pdf.set_text_color(0, 0, 0)
    pdf.ln(14)

    # ── Summary strip ──────────────────────────────────────────────────────
    present_c = sum(1 for r in rows if r["status"] == "Present")
    absent_c  = sum(1 for r in rows if r["status"] == "Absent")
    late_c    = sum(1 for r in rows if r["status"] == "Late")
    rate_c    = round((present_c + late_c) / len(rows) * 100, 1) if rows else 0.0

    pdf.set_fill_color(242, 250, 253)
    pdf.set_draw_color(33, 158, 188)
    pdf.set_font("Helvetica", "B", 10)
    for label, val, color in [
        ("Total", str(len(rows)), (2, 48, 71)),
        ("Present", str(present_c), (33, 158, 188)),
        ("Absent",  str(absent_c),  (251, 133, 0)),
        ("Late",    str(late_c),    (255, 183, 3)),
        ("Rate",    f"{rate_c}%",   (33, 158, 188)),
    ]:
        pdf.set_fill_color(242, 250, 253)
        pdf.cell(40, 10, f"{label}: {val}", border=1, align="C", fill=True, ln=0)
    pdf.ln(14)

    # ── Table header ──────────────────────────────────────────────────────
    col_widths = [10, 55, 30, 75, 35, 25, 35]
    col_headers = ["#", "Name", "Roll No.", "Email", "Phone", "Status", "Attendance"]

    pdf.set_fill_color(33, 158, 188)
    pdf.set_text_color(255, 255, 255)
    pdf.set_font("Helvetica", "B", 9)
    for w, h in zip(col_widths, col_headers):
        pdf.cell(w, 8, h, border=1, align="C", fill=True)
    pdf.ln()

    # ── Table rows ────────────────────────────────────────────────────────
    pdf.set_font("Helvetica", "", 8)
    status_colors_pdf = {
        "Present": (209, 240, 246),
        "Absent":  (255, 229, 204),
        "Late":    (255, 244, 204),
    }

    for i, row in enumerate(rows, 1):
        status = row["status"]
        bg = status_colors_pdf.get(status, (255, 255, 255))
        pdf.set_fill_color(*bg)
        pdf.set_text_color(30, 30, 30)

        values = [str(i), row["name"], row["roll"], row["email"], row["phone"], status, row["attendance_pct"]]
        fill = status != "Present" or i % 2 == 0  # slight alternating
        for val, w in zip(values, col_widths):
            pdf.cell(w, 7, str(val)[:30], border=1, align="C" if w <= 35 else "L", fill=True)
        pdf.ln()

    return pdf.output()


# ─────────────────────────────────────────────
# REPORT DOWNLOAD ENDPOINTS
# ─────────────────────────────────────────────

@app.get("/api/reports/{period}/excel")
def download_excel_report(period: str, db: Session = Depends(get_db)):
    """Download an Excel (.xlsx) attendance report. period = daily | weekly | monthly"""
    rows, date_label, _ = _get_report_students(period, db)
    title_map = {"daily": "Daily Attendance Report", "weekly": "Weekly Attendance Report", "monthly": "Monthly Attendance Report"}
    title = title_map.get(period, "Attendance Report")

    xlsx_bytes = _build_excel(rows, title, date_label)

    filename = f"hawk_ai_{period}_report_{datetime.date.today().isoformat()}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@app.get("/api/reports/{period}/pdf")
def download_pdf_report(period: str, db: Session = Depends(get_db)):
    """Download a PDF attendance report. period = daily | weekly | monthly"""
    rows, date_label, _ = _get_report_students(period, db)
    title_map = {"daily": "Daily Attendance Report", "weekly": "Weekly Attendance Report", "monthly": "Monthly Attendance Report"}
    title = title_map.get(period, "Attendance Report")

    pdf_bytes = _build_pdf(rows, title, date_label)

    filename = f"hawk_ai_{period}_report_{datetime.date.today().isoformat()}.pdf"
    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

def generate_mjpeg():
    while True:
        with pipeline.lock:
            frame = pipeline.latest_frame
        
        if frame is None:
            time.sleep(0.1)
            continue
            
        ret, jpeg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        if ret:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + jpeg.tobytes() + b'\r\n')
        # Rate limit MJPEG generation to ~20 FPS 
        time.sleep(0.05)

@app.get("/api/camera/stream")
def camera_stream():
    return StreamingResponse(generate_mjpeg(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/api/camera/stats")
def camera_stats():
    with pipeline.lock:
        return pipeline.frame_data


# ─────────────────────────────────────────────
# SMART BOARD — HTTP FRAME UPLOAD (push mode)
# ─────────────────────────────────────────────

# Async lock to prevent overlapping heavy frame processing
_upload_lock = asyncio.Lock()

@app.post("/api/camera/upload")
async def upload_frame(file: UploadFile = File(...)):
    """Accept a JPEG/PNG frame from the smart board browser,
    run YOLO + InsightFace on it, update attendance, and return stats.
    
    The smart board browser captures webcam frames via canvas.toBlob()
    and POSTs them here. If the previous frame is still processing,
    return cached stats immediately to avoid request pile-up.
    """
    # If a frame is already being processed, return cached stats immediately
    if _upload_lock.locked():
        with pipeline.lock:
            return pipeline.frame_data

    async with _upload_lock:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            raise HTTPException(status_code=400, detail="Could not decode the uploaded frame image.")

        # Offload CPU-heavy YOLO + InsightFace to a thread pool
        # so the event loop remains free to serve other requests
        stats = await asyncio.to_thread(pipeline.push_frame, frame)
        return stats


@app.get("/api/camera/health")
def camera_health():
    """Simple health check for the smart board to verify backend connectivity."""
    return {"status": "ok", "message": "Hawk.ai backend is reachable"}


@app.put("/api/students/{student_id}", response_model=schemas.StudentOut)
def update_student(student_id: int, student: schemas.StudentUpdate, db: Session = Depends(get_db)):
    db_student = db.query(models.Student).filter(models.Student.id == student_id).first()
    if not db_student:
        raise HTTPException(status_code=404, detail="Student not found")
    for field, value in student.model_dump(exclude_unset=True).items():
        setattr(db_student, field, value)
    db.commit()
    db.refresh(db_student)
    return schemas.StudentOut(
        id=db_student.id, name=db_student.name, roll=db_student.roll,
        email=db_student.email, phone=db_student.phone,
        avatar=db_student.avatar or db_student.name[:2].upper(),
        attendance=db_student.attendance_percentage,
        status=db_student.current_status.value if db_student.current_status else "absent"
    )


# ─────────────────────────────────────────────
# AUTH ENDPOINT
# ─────────────────────────────────────────────

import hashlib
import secrets

def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def _verify_password(password: str, hashed: str) -> bool:
    return _hash_password(password) == hashed

def _seed_admin_users(db: Session):
    """Create default admin users if none exist."""
    if db.query(models.AdminUser).count() == 0:
        defaults = [
            models.AdminUser(
                name="Super Admin",
                email="admin@hawkai.edu",
                password_hash=_hash_password("admin123"),
                role=models.RoleEnum.super_admin,
            ),
            models.AdminUser(
                name="Dr. Sarah Mitchell",
                email="user@hawkai.edu",
                password_hash=_hash_password("user123"),
                role=models.RoleEnum.teacher,
            ),
        ]
        for u in defaults:
            db.add(u)
        db.commit()

# NOTE: _seed_admin_users is called inside the lifespan() context manager above.
# @app.on_event("startup") is ignored when lifespan is set, so we removed it.

@app.post("/api/auth/login", response_model=schemas.LoginResponse)
def login(request: schemas.LoginRequest, db: Session = Depends(get_db)):
    email = request.email.strip().lower()
    user = db.query(models.AdminUser).filter(func.lower(models.AdminUser.email) == email).first()
    if not user or not _verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    # Simple token: base64 of user_id + secret
    token = hashlib.sha256(f"{user.id}:{user.email}:{secrets.token_hex(8)}".encode()).hexdigest()
    role_map = {
        models.RoleEnum.super_admin: "admin",
        models.RoleEnum.admin: "admin",
        models.RoleEnum.teacher: "user",
    }
    return schemas.LoginResponse(
        token=token,
        role=role_map.get(user.role, "user"),
        name=user.name,
        email=user.email,
    )


# ─────────────────────────────────────────────
# ADMIN — STATS
# ─────────────────────────────────────────────

@app.get("/api/admin/stats", response_model=schemas.AdminStatsOut)
def get_admin_stats(db: Session = Depends(get_db)):
    students = db.query(models.Student).count()
    teachers = db.query(models.Teacher).count()
    classes = db.query(models.Class).count()
    all_students = db.query(models.Student).all()
    if all_students:
        avg_att = round(sum(s.attendance_percentage for s in all_students) / len(all_students), 1)
    else:
        avg_att = 0.0
    return schemas.AdminStatsOut(
        students=students,
        teachers=teachers,
        classes=classes,
        attendance=avg_att,
        student_trend="+2.5%",
        class_trend="+4%",
        attendance_trend="+1.2%",
    )


# ─────────────────────────────────────────────
# ADMIN — TEACHER CRUD
# ─────────────────────────────────────────────

@app.get("/api/admin/teachers", response_model=List[schemas.TeacherOut])
def get_teachers(db: Session = Depends(get_db)):
    return db.query(models.Teacher).all()

@app.post("/api/admin/teachers", response_model=schemas.TeacherOut)
def create_teacher(teacher: schemas.TeacherCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Teacher).filter(models.Teacher.email == teacher.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Teacher with this email already exists")
    db_teacher = models.Teacher(**teacher.model_dump())
    db.add(db_teacher)
    db.commit()
    db.refresh(db_teacher)
    return db_teacher

@app.put("/api/admin/teachers/{teacher_id}", response_model=schemas.TeacherOut)
def update_teacher(teacher_id: int, teacher: schemas.TeacherUpdate, db: Session = Depends(get_db)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not db_teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    for field, value in teacher.model_dump(exclude_unset=True).items():
        setattr(db_teacher, field, value)
    db.commit()
    db.refresh(db_teacher)
    return db_teacher

@app.delete("/api/admin/teachers/{teacher_id}")
def delete_teacher(teacher_id: int, db: Session = Depends(get_db)):
    db_teacher = db.query(models.Teacher).filter(models.Teacher.id == teacher_id).first()
    if not db_teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    db.delete(db_teacher)
    db.commit()
    return {"message": "Teacher deleted successfully"}


# ─────────────────────────────────────────────
# ADMIN — CLASS CRUD
# ─────────────────────────────────────────────

@app.get("/api/admin/classes", response_model=List[schemas.ClassOut])
def get_classes(db: Session = Depends(get_db)):
    classes = db.query(models.Class).all()
    result = []
    for c in classes:
        teacher_name = None
        if c.teacher_id:
            teacher = db.query(models.Teacher).filter(models.Teacher.id == c.teacher_id).first()
            teacher_name = teacher.name if teacher else None
        result.append(schemas.ClassOut(
            id=c.id, class_name=c.class_name, teacher_id=c.teacher_id,
            room_number=c.room_number, section=c.section,
            enrollment=c.enrollment, max_enrollment=c.max_enrollment,
            attendance_percentage=c.attendance_percentage, status=c.status,
            teacher_name=teacher_name, created_at=c.created_at
        ))
    return result

@app.post("/api/admin/classes", response_model=schemas.ClassOut)
def create_class(cls: schemas.ClassCreate, db: Session = Depends(get_db)):
    # Extract password (not stored in Class model)
    class_data = cls.model_dump(exclude={"teacher_password"})
    db_class = models.Class(**class_data)
    db.add(db_class)
    db.commit()
    db.refresh(db_class)

    # If a teacher is assigned and a password is provided, create/update their login
    if db_class.teacher_id and cls.teacher_password:
        teacher = db.query(models.Teacher).filter(models.Teacher.id == db_class.teacher_id).first()
        if teacher and teacher.email:
            existing_user = db.query(models.AdminUser).filter(models.AdminUser.email == teacher.email).first()
            if existing_user:
                existing_user.password_hash = _hash_password(cls.teacher_password)
                existing_user.name = teacher.name
            else:
                new_user = models.AdminUser(
                    name=teacher.name,
                    email=teacher.email,
                    password_hash=_hash_password(cls.teacher_password),
                    role=models.RoleEnum.teacher,
                    is_active=True,
                )
                db.add(new_user)
            db.commit()

    teacher_name = None
    if db_class.teacher_id:
        teacher = db.query(models.Teacher).filter(models.Teacher.id == db_class.teacher_id).first()
        teacher_name = teacher.name if teacher else None
    return schemas.ClassOut(
        id=db_class.id, class_name=db_class.class_name, teacher_id=db_class.teacher_id,
        room_number=db_class.room_number, section=db_class.section,
        enrollment=db_class.enrollment, max_enrollment=db_class.max_enrollment,
        attendance_percentage=db_class.attendance_percentage, status=db_class.status,
        teacher_name=teacher_name, created_at=db_class.created_at
    )

@app.put("/api/admin/classes/{class_id}", response_model=schemas.ClassOut)
def update_class(class_id: int, cls: schemas.ClassUpdate, db: Session = Depends(get_db)):
    db_class = db.query(models.Class).filter(models.Class.id == class_id).first()
    if not db_class:
        raise HTTPException(status_code=404, detail="Class not found")
    update_data = cls.model_dump(exclude_unset=True, exclude={"teacher_password"})
    for field, value in update_data.items():
        setattr(db_class, field, value)
    db.commit()
    db.refresh(db_class)

    # Update teacher login password if provided
    if cls.teacher_password and db_class.teacher_id:
        teacher = db.query(models.Teacher).filter(models.Teacher.id == db_class.teacher_id).first()
        if teacher and teacher.email:
            existing_user = db.query(models.AdminUser).filter(models.AdminUser.email == teacher.email).first()
            if existing_user:
                existing_user.password_hash = _hash_password(cls.teacher_password)
                db.commit()

    teacher_name = None
    if db_class.teacher_id:
        teacher = db.query(models.Teacher).filter(models.Teacher.id == db_class.teacher_id).first()
        teacher_name = teacher.name if teacher else None
    return schemas.ClassOut(
        id=db_class.id, class_name=db_class.class_name, teacher_id=db_class.teacher_id,
        room_number=db_class.room_number, section=db_class.section,
        enrollment=db_class.enrollment, max_enrollment=db_class.max_enrollment,
        attendance_percentage=db_class.attendance_percentage, status=db_class.status,
        teacher_name=teacher_name, created_at=db_class.created_at
    )

@app.delete("/api/admin/classes/{class_id}")
def delete_class(class_id: int, db: Session = Depends(get_db)):
    db_class = db.query(models.Class).filter(models.Class.id == class_id).first()
    if not db_class:
        raise HTTPException(status_code=404, detail="Class not found")
    db.delete(db_class)
    db.commit()
    return {"message": "Class deleted successfully"}


# ─────────────────────────────────────────────
# ADMIN — USER MANAGEMENT
# ─────────────────────────────────────────────

@app.get("/api/admin/users", response_model=List[schemas.AdminUserOut])
def get_admin_users(db: Session = Depends(get_db)):
    return db.query(models.AdminUser).all()

@app.post("/api/admin/users", response_model=schemas.AdminUserOut)
def create_admin_user(user: schemas.AdminUserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.AdminUser).filter(models.AdminUser.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    db_user = models.AdminUser(
        name=user.name,
        email=user.email,
        role=user.role,
        password_hash=_hash_password(user.password),
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.delete("/api/admin/users/{user_id}")
def delete_admin_user(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(db_user)
    db.commit()
    return {"message": "User deleted"}

@app.put("/api/admin/users/{user_id}/reset-password")
def reset_user_password(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    new_password = "reset123"
    db_user.password_hash = _hash_password(new_password)
    db.commit()
    return {"message": f"Password reset. New temporary password: {new_password}"}


# ─────────────────────────────────────────────
# ADMIN — SEARCH
# ─────────────────────────────────────────────

@app.get("/api/admin/search")
def admin_search(q: str = "", db: Session = Depends(get_db)):
    if not q or len(q) < 2:
        return {"students": [], "teachers": [], "classes": []}
    query = f"%{q.lower()}%"
    students = db.query(models.Student).filter(
        (models.Student.name.ilike(query)) | (models.Student.roll.ilike(query)) | (models.Student.email.ilike(query))
    ).limit(5).all()
    teachers = db.query(models.Teacher).filter(
        (models.Teacher.name.ilike(query)) | (models.Teacher.subject.ilike(query)) | (models.Teacher.email.ilike(query))
    ).limit(5).all()
    classes = db.query(models.Class).filter(
        models.Class.class_name.ilike(query)
    ).limit(5).all()
    return {
        "students": [{"id": s.id, "name": s.name, "roll": s.roll, "type": "student"} for s in students],
        "teachers": [{"id": t.id, "name": t.name, "subject": t.subject, "type": "teacher"} for t in teachers],
        "classes": [{"id": c.id, "name": c.class_name, "type": "class"} for c in classes],
    }


# ─────────────────────────────────────────────
# MIGRATION STATUS (Phase 3 — AdaFace upgrade)
# ─────────────────────────────────────────────

@app.get("/api/migration/status")
def migration_status(db: Session = Depends(get_db)):
    """
    Returns whether the database contains embeddings that were generated
    by InsightFace buffalo_l (incompatible with AdaFace IR-50).
    The frontend uses this to show a re-registration warning banner.
    """
    students_with_embeddings = db.query(models.Student).filter(
        models.Student.embedding != None
    ).count()
    return {
        "needs_reregistration": students_with_embeddings > 0,
        "registered_count": students_with_embeddings,
        "reason": (
            "AdaFace IR-50 embeddings are mathematically incompatible with the "
            "previous InsightFace buffalo_l embeddings. All students must re-register "
            "their face by uploading a new photo."
        ),
    }


# ─────────────────────────────────────────────
# SEATING MAP (Phase 5)
# ─────────────────────────────────────────────

class SeatingAssignment(BaseModel):
    seat_id: str
    student_id: int
    zone: dict  # {x1, y1, x2, y2}

@app.get("/api/seating")
def list_seating():
    """Return all current seat assignments from the in-memory seat map."""
    from vision.pipeline import pipeline as _pipeline
    from vision.pipeline import SeatZone
    result = []
    for seat_id, zone in _pipeline.seat_map.items():
        result.append({
            "seat_id": zone.seat_id,
            "student_id": zone.student_id,
            "zone": {"x1": zone.x1, "y1": zone.y1, "x2": zone.x2, "y2": zone.y2},
        })
    return result

@app.post("/api/seating")
def assign_seat(assignment: SeatingAssignment):
    """Assign (or update) a student to a seat zone."""
    from vision.pipeline import pipeline as _pipeline
    from vision.pipeline import SeatZone
    zone_data = assignment.zone
    zone = SeatZone(
        seat_id=assignment.seat_id,
        student_id=assignment.student_id,
        x1=int(zone_data.get("x1", 0)),
        y1=int(zone_data.get("y1", 0)),
        x2=int(zone_data.get("x2", 0)),
        y2=int(zone_data.get("y2", 0)),
    )
    _pipeline.seat_map[assignment.seat_id] = zone
    return {"message": f"Seat {assignment.seat_id} assigned to student {assignment.student_id}."}

@app.delete("/api/seating/{seat_id}")
def remove_seat(seat_id: str):
    """Remove a seat assignment from the in-memory seat map."""
    from vision.pipeline import pipeline as _pipeline
    if seat_id not in _pipeline.seat_map:
        raise HTTPException(status_code=404, detail=f"Seat '{seat_id}' not found.")
    del _pipeline.seat_map[seat_id]
    return {"message": f"Seat {seat_id} assignment removed."}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
