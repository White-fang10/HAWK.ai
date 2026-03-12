"use client"

import { useState, useEffect } from "react"
import { Search, Filter, Eye, Trash2, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { getStudents, Student } from "@/lib/api"

const STATUS_FILTERS = ["All", "Present", "Absent", "Late"] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export function AdminStudents() {
    const [students, setStudents] = useState<Student[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")
    const [filterOpen, setFilterOpen] = useState(false)

    const load = async () => {
        try { setStudents(await getStudents()) }
        catch { } finally { setLoading(false) }
    }
    useEffect(() => { load() }, [])

    const filtered = students.filter(s => {
        const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.roll.toLowerCase().includes(search.toLowerCase())
        const matchStatus = statusFilter === "All" || s.status === statusFilter.toLowerCase()
        return matchSearch && matchStatus
    })

    const present = students.filter(s => s.status === "present").length
    const absent = students.filter(s => s.status === "absent").length
    const late = students.filter(s => s.status === "late").length

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: "Total Students", value: students.length, color: "#219EBC" },
                    { label: "Present Today", value: present, color: "#8ECAE6" },
                    { label: "Absent Today", value: absent, color: "#0D1B2A" },
                    { label: "Late Today", value: late, color: "#1E3A5F" },
                ].map(s => (
                    <div key={s.label} className="bg-[#0B2E3A] rounded-xl p-5 border border-slate-800">
                        <p className="text-xs text-slate-400 font-medium">{s.label}</p>
                        <h3 className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</h3>
                    </div>
                ))}
            </div>

            {/* Table */}
            <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 overflow-hidden">
                <div className="p-5 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="text-lg font-bold text-white">Student Management</h3>
                        <p className="text-sm text-slate-400">Overview of all enrolled students and their attendance.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students..."
                                className="pl-9 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-400 w-56 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50" />
                        </div>
                        <div className="relative">
                            <button onClick={() => setFilterOpen(!filterOpen)}
                                className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors">
                                <Filter className="size-3.5" /> {statusFilter} <ChevronDown className="size-3" />
                            </button>
                            {filterOpen && (
                                <div className="absolute right-0 top-full mt-1 bg-[#023047] border border-slate-700 rounded-xl shadow-xl z-50 w-32 overflow-hidden">
                                    {STATUS_FILTERS.map(f => (
                                        <button key={f} onClick={() => { setStatusFilter(f); setFilterOpen(false) }}
                                            className={cn("flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-slate-800",
                                                statusFilter === f ? "text-[#219EBC] font-semibold" : "text-slate-300"
                                            )}>
                                            {f !== "All" && <span className="size-2 rounded-full" style={{ backgroundColor: f === "Present" ? "#8ECAE6" : f === "Late" ? "#1E3A5F" : "#0D1B2A" }} />}
                                            {f}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto" onClick={() => setFilterOpen(false)}>
                    {loading ? (
                        <div className="py-16 text-center text-slate-400 text-sm">Loading students...</div>
                    ) : filtered.length === 0 ? (
                        <div className="py-16 text-center text-slate-400 text-sm">No students found.</div>
                    ) : (
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-slate-800/30">
                                    {["Student", "Roll No.", "Email", "Attendance", "Status", "Actions"].map(h => (
                                        <th key={h} className={`px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-400 ${h === "Actions" ? "text-right" : ""}`}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800">
                                {filtered.map(s => (
                                    <tr key={s.id} className="hover:bg-slate-800/20 transition-colors">
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`size-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${s.status === "present" ? "bg-[#219EBC]" : s.status === "late" ? "bg-[#1E3A5F]" : "bg-[#0D1B2A]/60"}`}>
                                                    {s.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <span className="font-medium text-white text-sm">{s.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4 font-mono text-sm text-slate-400">{s.roll}</td>
                                        <td className="px-5 py-4 text-sm text-slate-400">{s.email}</td>
                                        <td className="px-5 py-4">
                                            <div className="flex items-center gap-2">
                                                <div className="h-1.5 w-16 bg-slate-700 rounded-full overflow-hidden">
                                                    <div className="h-full rounded-full" style={{ width: `${s.attendance}%`, backgroundColor: s.attendance >= 85 ? "#219EBC" : s.attendance >= 75 ? "#1E3A5F" : "#0D1B2A" }} />
                                                </div>
                                                <span className="text-sm font-semibold text-white">{s.attendance}%</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-4">
                                            <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium capitalize",
                                                s.status === "present" ? "bg-[#219EBC]/20 text-[#219EBC]" :
                                                    s.status === "late" ? "bg-[#1E3A5F]/20 text-[#1E3A5F]" :
                                                        "bg-[#0D1B2A]/20 text-[#0D1B2A]"
                                            )}>
                                                {s.status}
                                            </span>
                                        </td>
                                        <td className="px-5 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <a href={`mailto:${s.email}`} className="p-1.5 rounded hover:bg-slate-700 hover:text-[#219EBC] text-slate-400 transition-colors" title="Email Student">
                                                    <Eye className="size-4" />
                                                </a>
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
