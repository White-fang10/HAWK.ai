"use client"

import { useState, useEffect } from "react"
import { Plus, Pencil, Trash2, X, Loader2, GraduationCap } from "lucide-react"
import { cn } from "@/lib/utils"
import { getTeachers, createTeacher, updateTeacher, deleteTeacher, Teacher } from "@/lib/admin-api"

const PERFORMANCE_COLORS: Record<string, string> = {
    "Excellent": "bg-[#219EBC] text-white",
    "Good": "bg-[#219EBC]/40 text-[#EAF6F9]",
    "Average": "bg-slate-600/40 text-slate-200",
    "Review Required": "bg-[#0D1B2A] text-white",
}

const INITIALS_COLORS = ["bg-[#219EBC]", "bg-indigo-500", "bg-amber-500", "bg-emerald-500", "bg-purple-500", "bg-pink-500"]

function TeacherModal({ teacher, teachers, onSave, onClose }: {
    teacher?: Teacher | null
    teachers: Teacher[]
    onSave: (t: Teacher) => void
    onClose: () => void
}) {
    const [form, setForm] = useState({
        name: teacher?.name ?? "",
        subject: teacher?.subject ?? "",
        email: teacher?.email ?? "",
        phone: teacher?.phone ?? "",
        attendance_percentage: teacher?.attendance_percentage ?? 0,
        performance_score: teacher?.performance_score ?? 0,
        performance_label: teacher?.performance_label ?? "Good",
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        setError("")
        try {
            const result = teacher
                ? await updateTeacher(teacher.id, form)
                : await createTeacher(form)
            onSave(result)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save teacher")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#023047] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                    <h3 className="text-base font-bold text-white">{teacher ? "Edit Teacher" : "Add New Teacher"}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="size-4" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Full Name *</label>
                            <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="Dr. John Smith" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Subject *</label>
                            <input required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="Advanced Physics" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Email *</label>
                        <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="teacher@hawkai.edu" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Phone</label>
                        <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="+91 98765 43210" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Attendance %</label>
                            <input type="number" min="0" max="100" value={form.attendance_percentage}
                                onChange={e => setForm({ ...form, attendance_percentage: Number(e.target.value) })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-slate-400 mb-1 block">Performance</label>
                            <select value={form.performance_label} onChange={e => setForm({ ...form, performance_label: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50">
                                <option>Excellent</option>
                                <option>Good</option>
                                <option>Average</option>
                                <option>Review Required</option>
                            </select>
                        </div>
                    </div>
                    {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                        <button type="submit" disabled={saving}
                            className="flex-1 py-2 rounded-lg bg-[#219EBC] text-sm font-semibold text-white hover:bg-[#1A8BA8] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                            {saving ? <><Loader2 className="size-3.5 animate-spin" /> Saving...</> : "Save Teacher"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export function AdminTeachers() {
    const [teachers, setTeachers] = useState<Teacher[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [editTeacher, setEditTeacher] = useState<Teacher | null>(null)

    const load = async () => {
        try { setTeachers(await getTeachers()) } catch { }
        finally { setLoading(false) }
    }
    useEffect(() => { load() }, [])

    const handleSave = (t: Teacher) => {
        setTeachers(prev => {
            const idx = prev.findIndex(x => x.id === t.id)
            return idx >= 0 ? prev.map(x => x.id === t.id ? t : x) : [t, ...prev]
        })
        setShowModal(false)
        setEditTeacher(null)
    }

    const handleDelete = async (id: number, name: string) => {
        if (!confirm(`Remove ${name} from the system?`)) return
        try { await deleteTeacher(id); setTeachers(prev => prev.filter(t => t.id !== id)) }
        catch { alert("Failed to delete teacher.") }
    }

    return (
        <div className="space-y-6">
            {(showModal || editTeacher) && (
                <TeacherModal teacher={editTeacher} teachers={teachers} onSave={handleSave}
                    onClose={() => { setShowModal(false); setEditTeacher(null) }} />
            )}

            {/* Management Hub Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
                <div className="bg-[#0B2E3A] p-6 rounded-xl border border-slate-800 hover:shadow-md transition-shadow">
                    <div className="size-12 rounded-lg bg-[#219EBC]/10 flex items-center justify-center text-[#219EBC] mb-4">
                        <Plus className="size-6" />
                    </div>
                    <h3 className="text-lg font-bold text-white">Faculty Onboarding</h3>
                    <p className="text-sm text-slate-400 mt-1">Add new teachers or department administrators to the Hawk AI system.</p>
                    <button onClick={() => setShowModal(true)}
                        className="mt-4 w-full py-2 rounded-lg bg-[#219EBC] text-sm font-semibold text-white hover:bg-[#1A8BA8] transition-colors">
                        Add New Member
                    </button>
                </div>
                <div className="bg-[#0B2E3A] p-6 rounded-xl border border-slate-800 hover:shadow-md transition-shadow">
                    <div className="size-12 rounded-lg bg-[#0D1B2A]/20 flex items-center justify-center text-[#0D1B2A] mb-4">
                        🔐
                    </div>
                    <h3 className="text-lg font-bold text-white">Security Reset</h3>
                    <p className="text-sm text-slate-400 mt-1">Force password resets or unlock faculty accounts after failed login attempts.</p>
                    <button className="mt-4 w-full py-2 rounded-lg border border-slate-700 text-sm font-semibold text-slate-300 hover:bg-slate-800 transition-colors">
                        Reset Tools
                    </button>
                </div>
            </div>

            {/* Teacher Table */}
            <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">Teacher Management</h3>
                        <p className="text-sm text-slate-400">Overview of active faculty members and their performance metrics.</p>
                    </div>
                    <button onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#219EBC] text-sm font-semibold text-white hover:bg-[#1A8BA8] transition-colors">
                        <Plus className="size-4" /> Add Teacher
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                            <Loader2 className="size-5 animate-spin mr-2" /> Loading teachers...
                        </div>
                    ) : teachers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                            <GraduationCap className="size-10 mb-2 opacity-30" />
                            <p className="text-sm">No teachers added yet.</p>
                            <button onClick={() => setShowModal(true)} className="mt-3 text-[#219EBC] text-sm hover:underline">Add your first teacher →</button>
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-slate-800/30">
                                    {["Name", "Class / Subject", "Contact", "Attendance", "Performance", "Actions"].map(h => (
                                        <th key={h} className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-400 ${h === "Actions" ? "text-right" : ""}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {teachers.map((t, i) => (
                                    <tr key={t.id} className="hover:bg-slate-800/20 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`size-9 rounded-full ${INITIALS_COLORS[i % INITIALS_COLORS.length]} flex items-center justify-center font-bold text-white text-xs`}>
                                                    {t.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                                                </div>
                                                <span className="font-medium text-white text-sm">{t.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 text-sm text-slate-300">{t.subject}</td>
                                        <td className="px-5 py-4">
                                            <p className="text-sm font-medium text-slate-200">{t.email}</p>
                                            {t.phone && <p className="text-xs text-slate-400">{t.phone}</p>}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 h-1.5 w-16 bg-slate-700 rounded-full overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${t.attendance_percentage}%`, backgroundColor: t.attendance_percentage >= 85 ? "#219EBC" : t.attendance_percentage >= 70 ? "#1E3A5F" : "#0D1B2A" }} />
                                                </div>
                                                <span className="text-sm font-semibold text-white">{t.attendance_percentage}%</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PERFORMANCE_COLORS[t.performance_label] ?? "bg-slate-600 text-white"}`}>
                                                {t.performance_label}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <button onClick={() => setEditTeacher(t)}
                                                    className="p-1.5 rounded hover:bg-slate-700 hover:text-[#219EBC] text-slate-400 transition-colors">
                                                    <Pencil className="size-4" />
                                                </button>
                                                <button onClick={() => handleDelete(t.id, t.name)}
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

