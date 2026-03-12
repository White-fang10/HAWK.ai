from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from datetime import datetime
import enum


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


# --- Student Schemas ---
class StudentBase(BaseModel):
    name: str
    roll: str
    email: str
    phone: str
    avatar: str


class StudentCreate(StudentBase):
    pass


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    roll: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None


class StudentOut(StudentBase):
    id: int
    attendance: float
    status: StatusEnum

    model_config = ConfigDict(from_attributes=True)


# --- Attendance Schemas ---
class DailyAttendanceOut(BaseModel):
    day: str
    present: int
    absent: int
    late: int


class WeeklyAttendanceOut(BaseModel):
    week: str
    rate: float


class AttendanceDistributionOut(BaseModel):
    name: str
    value: int
    fill: str


# --- Alert Schemas ---
class AlertOut(BaseModel):
    id: int
    type: AlertTypeEnum
    message: str
    time: str

    model_config = ConfigDict(from_attributes=True)


# --- Class Insights ---
class TrendEnum(str, enum.Enum):
    up = "up"
    down = "down"
    neutral = "neutral"


class ClassInsightOut(BaseModel):
    label: str
    value: str
    trend: TrendEnum


# --- Auth Schemas ---
class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    token: str
    role: str
    name: str
    email: str


# --- Teacher Schemas ---
class TeacherBase(BaseModel):
    name: str
    subject: str
    email: str
    phone: Optional[str] = None
    attendance_percentage: float = 0.0
    performance_score: float = 0.0
    performance_label: str = "Good"


class TeacherCreate(TeacherBase):
    pass


class TeacherUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    attendance_percentage: Optional[float] = None
    performance_score: Optional[float] = None
    performance_label: Optional[str] = None


class TeacherOut(TeacherBase):
    id: int
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# --- Class Schemas ---
class ClassBase(BaseModel):
    class_name: str
    teacher_id: Optional[int] = None
    room_number: Optional[str] = None
    section: Optional[str] = None
    enrollment: int = 0
    max_enrollment: int = 50
    attendance_percentage: float = 0.0
    status: str = "Active"


class ClassCreate(ClassBase):
    teacher_password: Optional[str] = None  # Creates/updates teacher login account


class ClassUpdate(BaseModel):
    class_name: Optional[str] = None
    teacher_id: Optional[int] = None
    room_number: Optional[str] = None
    section: Optional[str] = None
    enrollment: Optional[int] = None
    max_enrollment: Optional[int] = None
    attendance_percentage: Optional[float] = None
    status: Optional[str] = None
    teacher_password: Optional[str] = None  # Update teacher login password


class ClassOut(ClassBase):
    id: int
    teacher_name: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# --- Admin User Schemas ---
class AdminUserBase(BaseModel):
    name: str
    email: str
    role: RoleEnum = RoleEnum.admin


class AdminUserCreate(AdminUserBase):
    password: str


class AdminUserOut(AdminUserBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# --- Admin Stats ---
class AdminStatsOut(BaseModel):
    students: int
    teachers: int
    classes: int
    attendance: float
    student_trend: str = "+0%"
    class_trend: str = "+0%"
    attendance_trend: str = "+0%"
