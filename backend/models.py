from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from database import Base
import enum
import datetime


class StatusEnum(str, enum.Enum):
    present = "present"
    absent = "absent"
    late = "late"


class AlertTypeEnum(str, enum.Enum):
    warning = "warning"
    alert = "alert"
    info = "info"


class RoleEnum(str, enum.Enum):
    super_admin = "super_admin"
    admin = "admin"
    teacher = "teacher"


class PerformanceEnum(str, enum.Enum):
    excellent = "Excellent"
    good = "Good"
    average = "Average"
    review = "Review Required"


# ─────────────────────────────────────────────
# Existing Models
# ─────────────────────────────────────────────

class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    roll = Column(String, unique=True, index=True)
    email = Column(String, unique=True, index=True)
    phone = Column(String)
    avatar = Column(String)
    attendance_percentage = Column(Float, default=0.0)
    current_status = Column(Enum(StatusEnum), default=StatusEnum.absent)

    # AI Embeddings stored as JSON array of floats
    embedding = Column(String, nullable=True)

    attendance_records = relationship("AttendanceRecord", back_populates="student", cascade="all, delete-orphan")


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("students.id"))
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(Enum(StatusEnum))
    confidence = Column(Float, default=1.0)

    student = relationship("Student", back_populates="attendance_records")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(Enum(AlertTypeEnum))
    message = Column(String)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    severity = Column(String, default="warning")
    status = Column(String, default="active")


# ─────────────────────────────────────────────
# New Admin Models
# ─────────────────────────────────────────────

class Teacher(Base):
    __tablename__ = "teachers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    subject = Column(String)
    email = Column(String, unique=True, index=True)
    phone = Column(String, nullable=True)
    attendance_percentage = Column(Float, default=0.0)
    performance_score = Column(Float, default=0.0)
    performance_label = Column(String, default="Good")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    classes = relationship("Class", back_populates="teacher")


class Class(Base):
    __tablename__ = "classes"

    id = Column(Integer, primary_key=True, index=True)
    class_name = Column(String, index=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)
    room_number = Column(String, nullable=True)
    section = Column(String, nullable=True)
    enrollment = Column(Integer, default=0)
    max_enrollment = Column(Integer, default=50)
    attendance_percentage = Column(Float, default=0.0)
    status = Column(String, default="Active")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    teacher = relationship("Teacher", back_populates="classes")


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(Enum(RoleEnum), default=RoleEnum.admin)
    profile_image = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
