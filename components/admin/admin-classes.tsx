"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2, X, Loader2, School, KeyRound, Eye, EyeOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { getClasses, createClass, updateClass, deleteClass, getTeachers, AdminClass, Teacher } from "@/lib/admin-api"

const STATUS_COLORS: Record<string, string> = {
    "Active": "bg-[#219EBC] text-white",
    "Pending": "bg-[#0D1B2A] text-white",
    "Inactive": "bg-slate-600 text-white",
}

function TeacherPasswordSection({ isEdit, teacherId, teachers, onChange }: {
    isEdit: boolean
    teacherId?: number
    teachers: Teacher[]
    onChange: (pw: string) => void
}) {
    const [password, setPassword] = useState("")
    const [showPw, setShowPw] = useState(false)
    const teacher = teachers.find(t => t.id === teacherId)

    const handleChange = (v: string) => {
        setPassword(v)
        onChange(v)
    }

    return (
        <div className="rounded-xl border border-[#219EBC]/30 bg-[#219EBC]/5 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
                <KeyRound className="size-3.5 text-[#219EBC]" />
                <span className="text-xs font-bold text-[#219EBC] uppercase tracking-wider">Teacher Login Credentials</span>
            </div>
            {teacher ? (
                <>
                    <p className="text-xs text-slate-400">
                        <span className="text-white font-medium">{teacher.name}</span> will log in with{" "}
                        <span className="text-[#219EBC] font-mono">{teacher.email}</span> and the password below.
                    </p>
                    <div className="relative">
                        <input
                            type={showPw ? "text" : "password"}
                            value={password}
                            onChange={e => handleChange(e.target.value)}
                            placeholder={isEdit ? "Leave blank to keep existing password" : "Set dashboard login password *"}
                            className="w-full px-3 py-2 pr-10 rounded-lg bg-slate-800/80 border border-[#219EBC]/30 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/40 transition-all"
                        />
                        <button type="button" onClick={() => setShowPw(!showPw)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors">
                            {showPw ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-500">The teacher will use their email + this password to access the User Dashboard.</p>
                </>
            ) : (
                <p className="text-xs text-slate-500 italic">Assign a teacher above to set login credentials.</p>
            )}
        </div>
    )
}

function ClassModal({ cls, teachers, onSave, onClose }: {
    cls?: AdminClass | null
    teachers: Teacher[]
    onSave: (c: AdminClass) => void
    onClose: () => void
}) {
    const [form, setForm] = useState<{
        class_name: string
        teacher_id?: number
        room_number: string
        section: string
        enrollment: number
        max_enrollment: number
        attendance_percentage: number
        status: string
        teacher_password?: string
    }>({
        class_name: cls?.class_name ?? "",
        teacher_id: cls?.teacher_id ?? undefined,
        room_number: cls?.room_number ?? "",
        section: cls?.section ?? "",
        enrollment: cls?.enrollment ?? 0,
        max_enrollment: cls?.max_enrollment ?? 50,
        attendance_percentage: cls?.attendance_percentage ?? 0,
        status: cls?.status ?? "Active",
        teacher_password: "",
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true); setError("")
        try {
            const payload = { ...form }
            if (!payload.teacher_password) delete payload.teacher_password
            const result = cls ? await updateClass(cls.id, payload) : await createClass(payload)
            onSave(result)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save")
        } finally { setSaving(false) }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="bg-[#023047] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl my-4">
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                    <h3 className="text-base font-bold text-white">{cls ? "Edit Class" : "Create New Class"}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="size-4" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Class Name *</label>
                            <input required value={form.class_name} onChange={e => setForm({ ...form, class_name: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="e.g. Advanced Physics A" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Section</label>
                            <input value={form.section} onChange={e => setForm({ ...form, section: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="e.g. Section 102" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Assign Teacher</label>
                        <select value={form.teacher_id ?? ""} onChange={e => setForm({ ...form, teacher_id: e.target.value ? Number(e.target.value) : undefined })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50">
                            <option value="">— Unassigned —</option>
                            {teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.email})</option>)}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Room Number</label>
                            <input value={form.room_number} onChange={e => setForm({ ...form, room_number: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="e.g. Room 404" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Max Enrollment</label>
                            <input type="number" min="1" value={form.max_enrollment} onChange={e => setForm({ ...form, max_enrollment: Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Current Enrollment</label>
                            <input type="number" min="0" value={form.enrollment} onChange={e => setForm({ ...form, enrollment: Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Status</label>
                            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50">
                                <option>Active</option><option>Pending</option><option>Inactive</option>
                            </select>
                        </div>
                    </div>

                    {/* ── Teacher Login Credentials ── */}
                    <TeacherPasswordSection
                        isEdit={!!cls}
                        teacherId={form.teacher_id}
                        teachers={teachers}
                        onChange={(pw) => setForm(f => ({ ...f, teacher_password: pw }))}
                    />

                    {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                        <button type="submit" disabled={saving}
                            className="flex-1 py-2 rounded-lg bg-[#219EBC] text-sm font-semibold text-white hover:bg-[#1A8BA8] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                            {saving ? <><Loader2 className="size-3.5 animate-spin" /> Saving...</> : "Save Class"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export function AdminClasses() {
    const [classes, setClasses] = useState<AdminClass[]>([])
    const [teachers, setTeachers] = useState<Teacher[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editClass, setEditClass] = useState<AdminClass | null>(null)

    const load = async () => {
        try {
            const [c, t] = await Promise.all([getClasses(), getTeachers()])
            setClasses(c); setTeachers(t)
        } catch { } finally { setLoading(false) }
    }
    useEffect(() => { load() }, [])

    const handleSave = (c: AdminClass) => {
        setClasses(prev => {
            const idx = prev.findIndex(x => x.id === c.id)
            return idx >= 0 ? prev.map(x => x.id === c.id ? c : x) : [c, ...prev]
        })
        setShowModal(false); setEditClass(null)
    }

    const handleDelete = async (id: number, name: string) => {
        if (!confirm(`Remove class "${name}"?`)) return
        try { await deleteClass(id); setClasses(prev => prev.filter(c => c.id !== id)) }
        catch { alert("Failed to delete class.") }
    }

    return (
        <div className="space-y-6">
            {(showModal || editClass) && (
                <ClassModal cls={editClass} teachers={teachers} onSave={handleSave}
                    onClose={() => { setShowModal(false); setEditClass(null) }} />
            )}

            <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-bold text-white">Class Orchestration</h3>
                        <p className="text-sm text-slate-400">Manage academic cohorts and instructor assignments.</p>
                    </div>
                    <button onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#219EBC] text-sm font-semibold text-white hover:bg-[#1A8BA8] transition-colors">
                        <Plus className="size-4" /> Create Class
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                            <Loader2 className="size-5 animate-spin mr-2" /> Loading classes...
                        </div>
                    ) : classes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                            <School className="size-10 mb-2 opacity-30" />
                            <p className="text-sm">No classes created yet.</p>
                            <button onClick={() => setShowModal(true)} className="mt-3 text-[#219EBC] text-sm hover:underline">Create your first class →</button>
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-slate-800/30">
                                    {["Class Name", "Instructor", "Enrollment", "Attendance", "Status", "Actions"].map(h => (
                                        <th key={h} className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-400 ${h === "Actions" ? "text-right" : ""}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {classes.map(c => (
                                    <tr key={c.id} className="hover:bg-slate-800/20 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="font-bold text-[#219EBC]">{c.class_name}</div>
                                            <span className="text-xs text-slate-400">{c.section && `${c.section} • `}{c.room_number || "No room assigned"}</span>
                                        </td>
                                        <td className="px-5 py-4">
                                            {c.teacher_name ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="size-6 rounded-full bg-[#219EBC]/20 flex items-center justify-center text-[#219EBC] text-[10px] font-bold">
                                                        {c.teacher_name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                                                    </div>
                                                    <span className="text-sm text-slate-300">{c.teacher_name}</span>
                                                </div>
                                            ) : (
                                                <span className="text-sm text-slate-500 italic">Unassigned</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-4 font-medium text-white">{c.enrollment} / {c.max_enrollment}</td>
                                        <td className="px-5 py-4 text-slate-300 text-sm">{c.attendance_percentage > 0 ? `${c.attendance_percentage}%` : "—"}</td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-slate-600 text-white"}`}>
                                                <span className={`size-1.5 rounded-full inline-block ${c.status === "Active" ? "bg-emerald-500" : "bg-amber-500"}`} />
                                                {c.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => setEditClass(c)}
                                                    className="px-2.5 py-1 text-[#219EBC] text-xs font-semibold hover:underline transition-colors">Assign</button>
                                                <button onClick={() => setEditClass(c)}
                                                    className="p-1.5 rounded hover:bg-slate-700 hover:text-[#219EBC] text-slate-400 transition-colors">
                                                    <Pencil className="size-4" />
                                                </button>
                                                <button onClick={() => handleDelete(c.id, c.class_name)}
                                                    className="p-1.5 rounded hover:bg-red-500/10 hover:text-red-400 text-slate-400 transition-colors">
                                                    <Trash2 className="size-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    )
}
