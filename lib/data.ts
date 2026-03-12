export const students = [
  { id: 1, name: "Aarav Sharma", roll: "CS2024001", email: "aarav@university.edu", phone: "+91 98765 43210", attendance: 96, status: "present" as const, avatar: "AS" },
  { id: 2, name: "Priya Patel", roll: "CS2024002", email: "priya@university.edu", phone: "+91 98765 43211", attendance: 88, status: "present" as const, avatar: "PP" },
  { id: 3, name: "Rahul Verma", roll: "CS2024003", email: "rahul@university.edu", phone: "+91 98765 43212", attendance: 72, status: "late" as const, avatar: "RV" },
  { id: 4, name: "Sneha Gupta", roll: "CS2024004", email: "sneha@university.edu", phone: "+91 98765 43213", attendance: 94, status: "present" as const, avatar: "SG" },
  { id: 5, name: "Vikram Singh", roll: "CS2024005", email: "vikram@university.edu", phone: "+91 98765 43214", attendance: 65, status: "absent" as const, avatar: "VS" },
  { id: 6, name: "Ananya Reddy", roll: "CS2024006", email: "ananya@university.edu", phone: "+91 98765 43215", attendance: 91, status: "present" as const, avatar: "AR" },
  { id: 7, name: "Karthik Nair", roll: "CS2024007", email: "karthik@university.edu", phone: "+91 98765 43216", attendance: 45, status: "absent" as const, avatar: "KN" },
  { id: 8, name: "Meera Iyer", roll: "CS2024008", email: "meera@university.edu", phone: "+91 98765 43217", attendance: 87, status: "present" as const, avatar: "MI" },
  { id: 9, name: "Arjun Das", roll: "CS2024009", email: "arjun@university.edu", phone: "+91 98765 43218", attendance: 78, status: "late" as const, avatar: "AD" },
  { id: 10, name: "Divya Menon", roll: "CS2024010", email: "divya@university.edu", phone: "+91 98765 43219", attendance: 92, status: "present" as const, avatar: "DM" },
]

export const dailyAttendanceData = [
  { day: "Mon", present: 42, absent: 3, late: 5 },
  { day: "Tue", present: 44, absent: 2, late: 4 },
  { day: "Wed", present: 38, absent: 7, late: 5 },
  { day: "Thu", present: 45, absent: 1, late: 4 },
  { day: "Fri", present: 40, absent: 5, late: 5 },
]

export const weeklyAttendanceData = [
  { week: "Week 1", rate: 88 },
  { week: "Week 2", rate: 92 },
  { week: "Week 3", rate: 85 },
  { week: "Week 4", rate: 90 },
  { week: "Week 5", rate: 94 },
  { week: "Week 6", rate: 87 },
  { week: "Week 7", rate: 91 },
  { week: "Week 8", rate: 93 },
]

export const attendanceDistribution = [
  { name: "Present", value: 42, fill: "#219EBC" },
  { name: "Late", value: 5, fill: "#1E3A5F" },
  { name: "Absent", value: 3, fill: "#0D1B2A" },
]

export const alerts = [
  { id: 1, type: "warning" as const, message: "Vikram Singh has not been detected in class", time: "2 min ago" },
  { id: 2, type: "alert" as const, message: "Karthik Nair attendance dropped below 50%", time: "5 min ago" },
  { id: 3, type: "info" as const, message: "3 students have not been detected yet", time: "8 min ago" },
  { id: 4, type: "warning" as const, message: "Camera 2 connection unstable", time: "12 min ago" },
]

export const classInsights = [
  { label: "Average Class Attendance", value: "87.4%", trend: "up" as const },
  { label: "Students Below 75%", value: "3", trend: "down" as const },
  { label: "Most Absent Day", value: "Wednesday", trend: "neutral" as const },
  { label: "Top Attending Student", value: "Aarav Sharma", trend: "up" as const },
]
