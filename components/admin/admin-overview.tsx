"use client"

import { useState, useEffect } from "react"
import { Users, GraduationCap, School, TrendingUp, RefreshCw } from "lucide-react"
import { getAdminStats, getTeachers, getClasses, AdminStats, Teacher, AdminClass } from "@/lib/admin-api"
import { getDailyAnalytics, getWeeklyAnalytics } from "@/lib/api"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from "recharts"

interface DayData { day: string; present: number; absent: number; late: number }
interface WeekData { week: string; rate: number }

export function AdminOverview() {
    const [stats, setStats] = useState<AdminStats | null>(null)
    const [dailyData, setDailyData] = useState<DayData[]>([])
    const [weeklyData, setWeeklyData] = useState<WeekData[]>([])
    const [teachers, setTeachers] = useState<Teacher[]>([])
    const [classes, setClasses] = useState<AdminClass[]>([])
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
    const [loading, setLoading] = useState(true)

    const load = async () => {
        try {
            const [s, d, w, t, c] = await Promise.allSettled([
                getAdminStats(),
                getDailyAnalytics(),
                getWeeklyAnalytics(),
                getTeachers(),
                getClasses(),
            ])
            if (s.status === "fulfilled") setStats(s.value)
            if (d.status === "fulfilled") setDailyData(d.value)
            if (w.status === "fulfilled") setWeeklyData(w.value)
            if (t.status === "fulfilled") setTeachers(t.value)
            if (c.status === "fulfilled") setClasses(c.value)
            setLastUpdated(new Date())
        } catch { }
        finally { setLoading(false) }
    }

    useEffect(() => {
        load()
        const interval = setInterval(load, 15000)
        return () => clearInterval(interval)
    }, [])

    // Check if daily data has any real attendance (non-zero)
    const hasRealDailyData = dailyData.some(d => d.present > 0 || d.late > 0)
    const hasRealWeeklyData = weeklyData.some(w => w.rate > 0)

    const avgAtt = stats?.attendance ?? 0
    const performance = Math.min(99, avgAtt)
    const performanceLabel = performance >= 85 ? "Excellent" : performance >= 70 ? "Good" : performance >= 50 ? "Average" : "Low"

    const statCards = [
        { label: "Total Students", value: stats?.students ?? 0, icon: Users, color: "#219EBC", trend: stats?.student_trend ?? "" },
        { label: "Teachers", value: stats?.teachers ?? teachers.length, icon: GraduationCap, color: "#8ECAE6", trend: "" },
        { label: "Classes", value: stats?.classes ?? classes.length, icon: School, color: "#1E3A5F", trend: stats?.class_trend ?? "" },
        { label: "Avg Attendance", value: stats ? `${avgAtt.toFixed(1)}%` : "0%", icon: TrendingUp, color: "#219EBC", trend: stats?.attendance_trend ?? "" },
    ]

    const weeklyDomain = hasRealWeeklyData
        ? [0, 100]
        : [0, 100]

    return (
        <div className="space-y-8">

            {/* Last updated bar */}
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">System Overview</h2>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                    <RefreshCw className="size-3" />
                    {lastUpdated
                        ? `Updated ${lastUpdated.toLocaleTimeString()}`
                        : "Loading..."}
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {statCards.map((card) => (
                    <div key={card.label} className="bg-[#0B2E3A] p-6 rounded-xl border border-slate-800 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-4">
                            <div className="p-2 rounded-lg" style={{ backgroundColor: `${card.color}20` }}>
                                <card.icon className="size-5" style={{ color: card.color }} />
                            </div>
                            {card.trend && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-green-500 bg-green-500/10">
                                    {card.trend}
                                </span>
                            )}
                        </div>
                        <p className="text-slate-400 text-sm font-medium">{card.label}</p>
                        <h3 className="text-2xl font-bold text-white mt-1">{card.value}</h3>
                    </div>
                ))}
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Daily Attendance Bar Chart */}
                <div className="lg:col-span-2 bg-[#0B2E3A] p-6 rounded-xl border border-slate-800">
                    <div className="flex items-center justify-between mb-5">
                        <div>
                            <h4 className="text-lg font-bold text-white">Daily Attendance</h4>
                            <p className="text-sm text-slate-400">Present / Absent / Late — current week</p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-400">
                            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#219EBC] inline-block" />Present</span>
                            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#0D1B2A] inline-block" />Absent</span>
                            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#1E3A5F] inline-block" />Late</span>
                        </div>
                    </div>

                    {dailyData.length > 0 ? (
                        <>
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={dailyData} barGap={3}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e3a4a" vertical={false} />
                                    <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: "#0B2E3A", border: "1px solid #334155", borderRadius: 8, color: "#EAF6F9", fontSize: 12 }}
                                    />
                                    <Bar dataKey="present" fill="#219EBC" radius={[4, 4, 0, 0]} name="Present" />
                                    <Bar dataKey="absent" fill="#0D1B2A" radius={[4, 4, 0, 0]} fillOpacity={0.7} name="Absent" />
                                    <Bar dataKey="late" fill="#1E3A5F" radius={[4, 4, 0, 0]} fillOpacity={0.7} name="Late" />
                                </BarChart>
                            </ResponsiveContainer>
                            {!hasRealDailyData && (
                                <p className="text-center text-xs text-slate-500 mt-2">
                                    📷 No face-scan attendance recorded yet this week. Start the camera to log attendance.
                                </p>
                            )}
                        </>
                    ) : (
                        <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
                            Loading attendance data...
                        </div>
                    )}
                </div>

                {/* Right column: Performance Gauge + Weekly Trend */}
                <div className="flex flex-col gap-6">

                    {/* Circular Performance Gauge */}
                    <div className="bg-[#0B2E3A] p-6 rounded-xl border border-slate-800 flex-1">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Overall Performance</h4>
                        <div className="flex flex-col items-center justify-center py-2">
                            <div className="relative w-28 h-28 flex items-center justify-center">
                                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
                                    <circle cx="60" cy="60" r="48" fill="transparent" stroke="#1e3a4a" strokeWidth="8" />
                                    <circle
                                        cx="60" cy="60" r="48" fill="transparent"
                                        stroke={performance >= 75 ? "#219EBC" : performance >= 50 ? "#1E3A5F" : "#0D1B2A"}
                                        strokeWidth="8"
                                        strokeDasharray={`${2 * Math.PI * 48}`}
                                        strokeDashoffset={`${2 * Math.PI * 48 * (1 - performance / 100)}`}
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <span className="absolute text-xl font-bold text-white">{performance.toFixed(0)}%</span>
                            </div>
                            <div className="mt-3 text-center">
                                <p className="text-lg font-bold text-white">{performanceLabel}</p>
                                <p className="text-xs text-slate-400">Avg Attendance Rate</p>
                            </div>
                        </div>
                    </div>

                    {/* Weekly Trend */}
                    <div className="bg-[#0B2E3A] p-6 rounded-xl border border-slate-800">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Weekly Trend</h4>
                        {weeklyData.length > 0 ? (
                            <>
                                <ResponsiveContainer width="100%" height={90}>
                                    <LineChart data={weeklyData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1e3a4a" vertical={false} />
                                        <XAxis dataKey="week" tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} />
                                        <YAxis domain={weeklyDomain} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={28} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: "#0B2E3A", border: "1px solid #334155", borderRadius: 8, color: "#EAF6F9", fontSize: 11 }}
                                            formatter={(val: number) => [`${val}%`, "Rate"]}
                                        />
                                        <Line type="monotone" dataKey="rate" stroke="#219EBC" strokeWidth={2.5} dot={{ fill: "#219EBC", r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                                {!hasRealWeeklyData && (
                                    <p className="text-center text-[10px] text-slate-600 mt-1">No scan data yet</p>
                                )}
                            </>
                        ) : (
                            <div className="h-20 flex items-center justify-center text-slate-500 text-xs">Loading...</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Classes Quick View */}
            {classes.length > 0 && (
                <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 overflow-hidden">
                    <div className="p-5 border-b border-slate-800">
                        <h4 className="text-base font-bold text-white">Active Classes</h4>
                        <p className="text-xs text-slate-400">Attendance performance by class</p>
                    </div>
                    <div className="divide-y divide-slate-800">
                        {classes.slice(0, 5).map(c => (
                            <div key={c.id} className="flex items-center justify-between px-5 py-3">
                                <div>
                                    <p className="text-sm font-semibold text-white">{c.class_name}</p>
                                    <p className="text-xs text-slate-400">{c.teacher_name || "Unassigned"} · {c.enrollment} students</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold" style={{ color: c.attendance_percentage >= 75 ? "#219EBC" : c.attendance_percentage > 0 ? "#1E3A5F" : "#64748b" }}>
                                        {c.attendance_percentage > 0 ? `${c.attendance_percentage.toFixed(1)}%` : "—"}
                                    </p>
                                    <p className="text-[10px] text-slate-500">Attendance</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
