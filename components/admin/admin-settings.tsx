"use client"

import { useState, useEffect } from "react"
import { Plus, Trash2, RotateCcw, X, Loader2, Shield, UserCog, Bell, Puzzle } from "lucide-react"
import { getAdminUsers, createAdminUser, deleteAdminUser, resetUserPassword, AdminUser } from "@/lib/admin-api"

const ROLE_LABELS: Record<string, string> = {
    super_admin: "Super Admin",
    admin: "Admin",
    teacher: "Teacher",
}

const ROLE_COLORS: Record<string, string> = {
    super_admin: "bg-[#219EBC]/20 text-[#219EBC]",
    admin: "bg-purple-500/20 text-purple-400",
    teacher: "bg-green-500/20 text-green-400",
}

function AddUserModal({ onSave, onClose }: { onSave: (u: AdminUser) => void; onClose: () => void }) {
    const [form, setForm] = useState({ name: "", email: "", role: "admin", password: "" })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState("")

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true); setError("")
        try { onSave(await createAdminUser(form)) }
        catch (err) { setError(err instanceof Error ? err.message : "Failed to create user") }
        finally { setSaving(false) }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#023047] border border-slate-700 rounded-2xl w-full max-w-sm shadow-2xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-800">
                    <h3 className="text-base font-bold text-white">Add Admin User</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="size-4" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-3">
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Full Name *</label>
                        <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Email *</label>
                        <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Role</label>
                        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50">
                            <option value="super_admin">Super Admin</option>
                            <option value="admin">Admin</option>
                            <option value="teacher">Teacher</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-slate-400 mb-1 block">Password *</label>
                        <input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" placeholder="Minimum 6 characters" minLength={6} />
                    </div>
                    {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
                    <div className="flex gap-2 pt-1">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                        <button type="submit" disabled={saving}
                            className="flex-1 py-2 rounded-lg bg-[#219EBC] text-sm font-semibold text-white hover:bg-[#1A8BA8] transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                            {saving ? <><Loader2 className="size-3.5 animate-spin" /> Creating...</> : "Create User"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

const SETTING_SECTIONS = [
    {
        icon: Shield, label: "Security Settings",
        items: ["Enable two-factor authentication", "Force password rotation every 90 days", "Audit log all admin actions"],
    },
    {
        icon: Bell, label: "Alert Configuration",
        items: ["Camera disconnection alerts", "Low attendance threshold alerts (< 75%)", "New unknown face detection alerts"],
    },
    {
        icon: Puzzle, label: "Integration Settings",
        items: ["API access for external systems", "Sync with institution's LMS", "Export to student information system"],
    },
]

export function AdminSettings() {
    const [users, setUsers] = useState<AdminUser[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [toggles, setToggles] = useState<Record<string, boolean>>({})
    const [resetting, setResetting] = useState<number | null>(null)
    const [resetMsg, setResetMsg] = useState("")

    const load = async () => {
        try { setUsers(await getAdminUsers()) } catch { } finally { setLoading(false) }
    }
    useEffect(() => { load() }, [])

    const handleDelete = async (id: number, name: string) => {
        if (!confirm(`Remove user "${name}"?`)) return
        try { await deleteAdminUser(id); setUsers(prev => prev.filter(u => u.id !== id)) }
        catch { alert("Failed to delete user.") }
    }

    const handleReset = async (id: number) => {
        setResetting(id); setResetMsg("")
        try {
            const res = await resetUserPassword(id)
            setResetMsg(res.message)
            setTimeout(() => setResetMsg(""), 5000)
        } catch { setResetMsg("Failed to reset password.") }
        finally { setResetting(null) }
    }

    const toggle = (key: string) => setToggles(prev => ({ ...prev, [key]: !prev[key] }))

    return (
        <div className="space-y-8">
            {showModal && <AddUserModal onSave={u => { setUsers(prev => [u, ...prev]); setShowModal(false) }} onClose={() => setShowModal(false)} />}

            {/* Admin User Management */}
            <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-5 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[#219EBC]/10 rounded-lg"><UserCog className="size-5 text-[#219EBC]" /></div>
                        <div>
                            <h3 className="text-base font-bold text-white">Admin Members</h3>
                            <p className="text-xs text-slate-400">Manage system administrators and roles</p>
                        </div>
                    </div>
                    <button onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#219EBC] text-sm font-semibold text-white hover:bg-[#1A8BA8] transition-colors">
                        <Plus className="size-4" /> Add Member
                    </button>
                </div>
                {resetMsg && <div className="px-5 py-2 bg-[#219EBC]/10 border-b border-[#219EBC]/20 text-xs text-[#219EBC]">{resetMsg}</div>}
                <div className="divide-y divide-slate-800">
                    {loading ? (
                        <div className="py-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
                            <Loader2 className="size-4 animate-spin" /> Loading users...
                        </div>
                    ) : users.map(u => (
                        <div key={u.id} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-800/20 transition-colors">
                            <div className="size-10 rounded-full bg-[#219EBC] flex items-center justify-center font-bold text-white text-xs flex-shrink-0">
                                {u.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-white">{u.name}</p>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? "bg-slate-600 text-white"}`}>
                                        {ROLE_LABELS[u.role] ?? u.role}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-400">{u.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => handleReset(u.id)} disabled={resetting === u.id}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-60">
                                    {resetting === u.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3.5" />}
                                    Reset
                                </button>
                                <button onClick={() => handleDelete(u.id, u.name)}
                                    className="p-1.5 rounded hover:bg-red-500/10 hover:text-red-400 text-slate-400 transition-colors">
                                    <Trash2 className="size-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Settings Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {SETTING_SECTIONS.map(section => (
                    <div key={section.label} className="bg-[#0B2E3A] rounded-xl border border-slate-800 p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <section.icon className="size-5 text-[#219EBC]" />
                            <h3 className="text-sm font-bold text-white">{section.label}</h3>
                        </div>
                        <div className="space-y-3">
                            {section.items.map(item => {
                                const key = `${section.label}:${item}`
                                return (
                                    <label key={item} className="flex items-center gap-3 cursor-pointer group">
                                        <div onClick={() => toggle(key)}
                                            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${toggles[key] ? "bg-[#219EBC]" : "bg-slate-700"}`}>
                                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${toggles[key] ? "translate-x-4" : "translate-x-0"}`} />
                                        </div>
                                        <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors leading-tight">{item}</span>
                                    </label>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
