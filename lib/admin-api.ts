const API_URL = "/api"

export interface Teacher {
    id: number
    name: string
    subject: string
    email: string
    phone?: string
    attendance_percentage: number
    performance_score: number
    performance_label: string
    created_at?: string
}

export interface AdminClass {
    id: number
    class_name: string
    teacher_id?: number
    room_number?: string
    section?: string
    enrollment: number
    max_enrollment: number
    attendance_percentage: number
    status: string
    teacher_name?: string
    created_at?: string
}

export interface AdminUser {
    id: number
    name: string
    email: string
    role: string
    is_active: boolean
    created_at?: string
}

export interface AdminStats {
    students: number
    teachers: number
    classes: number
    attendance: number
    student_trend: string
    class_trend: string
    attendance_trend: string
}

export async function getAdminStats(): Promise<AdminStats> {
    const res = await fetch(`${API_URL}/admin/stats`)
    if (!res.ok) throw new Error("Failed to fetch admin stats")
    return res.json()
}

// Teacher CRUD
export async function getTeachers(): Promise<Teacher[]> {
    const res = await fetch(`${API_URL}/admin/teachers`)
    if (!res.ok) throw new Error("Failed to fetch teachers")
    return res.json()
}

export async function createTeacher(data: Omit<Teacher, "id" | "created_at">): Promise<Teacher> {
    const res = await fetch(`${API_URL}/admin/teachers`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Failed to create teacher") }
    return res.json()
}

export async function updateTeacher(id: number, data: Partial<Teacher>): Promise<Teacher> {
    const res = await fetch(`${API_URL}/admin/teachers/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    })
    if (!res.ok) throw new Error("Failed to update teacher")
    return res.json()
}

export async function deleteTeacher(id: number): Promise<void> {
    const res = await fetch(`${API_URL}/admin/teachers/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error("Failed to delete teacher")
}

// Class CRUD
export async function getClasses(): Promise<AdminClass[]> {
    const res = await fetch(`${API_URL}/admin/classes`)
    if (!res.ok) throw new Error("Failed to fetch classes")
    return res.json()
}

export async function createClass(data: Omit<AdminClass, "id" | "created_at" | "teacher_name">): Promise<AdminClass> {
    const res = await fetch(`${API_URL}/admin/classes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Failed to create class") }
    return res.json()
}

export async function updateClass(id: number, data: Partial<AdminClass>): Promise<AdminClass> {
    const res = await fetch(`${API_URL}/admin/classes/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    })
    if (!res.ok) throw new Error("Failed to update class")
    return res.json()
}

export async function deleteClass(id: number): Promise<void> {
    const res = await fetch(`${API_URL}/admin/classes/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error("Failed to delete class")
}

// Admin Users
export async function getAdminUsers(): Promise<AdminUser[]> {
    const res = await fetch(`${API_URL}/admin/users`)
    if (!res.ok) throw new Error("Failed to fetch users")
    return res.json()
}

export async function createAdminUser(data: { name: string; email: string; role: string; password: string }): Promise<AdminUser> {
    const res = await fetch(`${API_URL}/admin/users`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    })
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Failed to create user") }
    return res.json()
}

export async function deleteAdminUser(id: number): Promise<void> {
    const res = await fetch(`${API_URL}/admin/users/${id}`, { method: "DELETE" })
    if (!res.ok) throw new Error("Failed to delete user")
}

export async function resetUserPassword(id: number): Promise<{ message: string }> {
    const res = await fetch(`${API_URL}/admin/users/${id}/reset-password`, { method: "PUT" })
    if (!res.ok) throw new Error("Failed to reset password")
    return res.json()
}

// Search
export async function adminSearch(q: string) {
    const res = await fetch(`${API_URL}/admin/search?q=${encodeURIComponent(q)}`)
    if (!res.ok) throw new Error("Search failed")
    return res.json()
}
