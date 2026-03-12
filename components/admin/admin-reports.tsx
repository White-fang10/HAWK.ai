"use client"

import { useState } from "react"
import { FileText, Download, Loader2 } from "lucide-react"
import { downloadReport } from "@/lib/api"

const REPORTS = [
    { id: "student-attendance", label: "Student Attendance Report", desc: "Individual student attendance records and percentages", icon: "👤" },
    { id: "class-statistics", label: "Class Statistics Report", desc: "Class-wise attendance and performance metrics", icon: "🏫" },
]
const PERIODS = ["daily", "weekly", "monthly"] as const
const FORMATS = [
    { id: "excel", label: "Excel (.xlsx)", icon: "📊" },
    { id: "pdf", label: "PDF Report", icon: "📄" },
] as const

export function AdminReports() {
    const [period, setPeriod] = useState<typeof PERIODS[number]>("daily")
    const [format, setFormat] = useState<"excel" | "pdf">("excel")
    const [downloading, setDownloading] = useState(false)
    const [success, setSuccess] = useState(false)
    const [error, setError] = useState("")

    const handleDownload = async () => {
        setDownloading(true); setSuccess(false); setError("")
        try {
            await downloadReport(period, format)
            setSuccess(true)
            setTimeout(() => setSuccess(false), 3000)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to download report")
        } finally {
            setDownloading(false)
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white">Reports System</h2>
                <p className="text-slate-400 text-sm mt-1">Generate and export institutional reports</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Report Config Panel */}
                <div className="lg:col-span-2 bg-[#0B2E3A] rounded-xl border border-slate-800 p-6 space-y-5">
                    {/* Report Type Cards */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Report Type</h3>
                        <div className="space-y-2">
                            {REPORTS.map(r => (
                                <div key={r.id} className="flex items-center gap-4 p-4 bg-[#219EBC]/05 border border-[#219EBC]/20 rounded-xl">
                                    <span className="text-2xl">{r.icon}</span>
                                    <div>
                                        <h4 className="font-semibold text-white text-sm">{r.label}</h4>
                                        <p className="text-xs text-slate-400 mt-0.5">{r.desc}</p>
                                    </div>
                                    <div className="ml-auto size-4 rounded-full border-2 border-[#219EBC] bg-[#219EBC] flex items-center justify-center">
                                        <span className="size-2 rounded-full bg-white" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Period */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Report Period</h3>
                        <div className="flex gap-2">
                            {PERIODS.map(p => (
                                <button key={p} onClick={() => setPeriod(p)}
                                    className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${period === p ? "bg-[#219EBC] text-white shadow-lg shadow-[#219EBC]/20" : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
                                        }`}>
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Format */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Export Format</h3>
                        <div className="flex gap-3">
                            {FORMATS.map(f => (
                                <button key={f.id} onClick={() => setFormat(f.id as "excel" | "pdf")}
                                    className={`flex items-center gap-2 flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition-colors ${format === f.id
                                            ? "border-[#219EBC] bg-[#219EBC]/10 text-[#219EBC]"
                                            : "border-slate-700 bg-slate-800/30 text-slate-400 hover:border-slate-600 hover:text-white"
                                        }`}>
                                    <span className="text-lg">{f.icon}</span>
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>}
                    {success && <p className="text-xs text-green-400 bg-green-500/10 rounded-lg px-3 py-2">✓ Report downloaded successfully!</p>}

                    <button onClick={handleDownload} disabled={downloading}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#219EBC] text-white font-bold hover:bg-[#1A8BA8] transition-colors disabled:opacity-60 shadow-lg shadow-[#219EBC]/20">
                        {downloading ? <><Loader2 className="size-4 animate-spin" /> Generating Report...</> : <><Download className="size-4" /> Generate & Download {format.toUpperCase()}</>}
                    </button>
                </div>

                {/* Quick Reports sidebar */}
                <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 p-6 space-y-4">
                    <h3 className="text-base font-bold text-white">Quick Reports</h3>
                    <p className="text-xs text-slate-400">One-click reports with pre-defined settings</p>
                    <div className="space-y-3">
                        {[
                            { label: "Today's Attendance", period: "daily" as const, format: "excel" as const },
                            { label: "This Week Summary", period: "weekly" as const, format: "pdf" as const },
                            { label: "Monthly Overview", period: "monthly" as const, format: "excel" as const },
                        ].map(r => (
                            <button key={r.label}
                                onClick={async () => {
                                    setDownloading(true)
                                    try { await downloadReport(r.period, r.format); setSuccess(true) }
                                    catch { setError("Download failed") }
                                    finally { setDownloading(false) }
                                }}
                                className="w-full flex items-center gap-3 p-3 bg-slate-800/40 hover:bg-slate-800 border border-slate-700 rounded-xl text-left transition-colors group">
                                <FileText className="size-4 text-[#219EBC] shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-white">{r.label}</p>
                                    <p className="text-[10px] text-slate-400 capitalize">{r.period} · {r.format.toUpperCase()}</p>
                                </div>
                                <Download className="size-3.5 text-slate-400 group-hover:text-[#219EBC] transition-colors" />
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
