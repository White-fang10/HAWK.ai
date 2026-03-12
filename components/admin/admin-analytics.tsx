"use client"

import { useState, useEffect } from "react"
import { getDailyAnalytics, getWeeklyAnalytics, getAttendanceDistribution } from "@/lib/api"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts"

export function AdminAnalytics() {
    const [daily, setDaily] = useState<{ day: string; present: number; absent: number; late: number }[]>([])
    const [weekly, setWeekly] = useState<{ week: string; rate: number }[]>([])
    const [distribution, setDistribution] = useState<{ name: string; value: number; fill: string }[]>([])

    useEffect(() => {
        const load = async () => {
            try {
                const [d, w, dist] = await Promise.allSettled([
                    getDailyAnalytics(), getWeeklyAnalytics(), getAttendanceDistribution()
                ])
                if (d.status === "fulfilled") setDaily(d.value)
                if (w.status === "fulfilled") setWeekly(w.value)
                if (dist.status === "fulfilled") setDistribution(dist.value)
            } catch { }
        }
        load()
        const interval = setInterval(load, 15000)
        return () => clearInterval(interval)
    }, [])

    const noData = daily.length === 0 && weekly.length === 0

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold text-white">Attendance Analytics</h2>
                <p className="text-slate-400 text-sm mt-1">Institutional attendance metrics and trends</p>
            </div>

            {noData && (
                <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 p-12 text-center">
                    <div className="text-5xl mb-4">📊</div>
                    <h3 className="text-lg font-bold text-white mb-2">No attendance data yet</h3>
                    <p className="text-slate-400 text-sm">Once students are registered and attendance is recorded, analytics will appear here.</p>
                </div>
            )}

            {/* Daily Bar Chart */}
            {daily.length > 0 && (
                <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 p-6">
                    <h3 className="text-lg font-bold text-white mb-4">Daily Attendance Breakdown</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={daily} barGap={4}>
                            <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                            <CartesianGrid stroke="#1e293b" vertical={false} />
                            <Tooltip contentStyle={{ backgroundColor: "#0B2E3A", border: "1px solid #334155", borderRadius: 8, color: "#EAF6F9", fontSize: 12 }} />
                            <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                            <Bar dataKey="present" fill="#219EBC" radius={[4, 4, 0, 0]} name="Present" />
                            <Bar dataKey="late" fill="#1E3A5F" radius={[4, 4, 0, 0]} name="Late" />
                            <Bar dataKey="absent" fill="#0D1B2A" radius={[4, 4, 0, 0]} name="Absent" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Weekly Trend */}
                {weekly.length > 0 && (
                    <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Weekly Attendance Trend</h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={weekly}>
                                <XAxis dataKey="week" tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
                                <CartesianGrid stroke="#1e293b" vertical={false} />
                                <Tooltip contentStyle={{ backgroundColor: "#0B2E3A", border: "1px solid #334155", borderRadius: 8, color: "#EAF6F9", fontSize: 12 }}
                                    formatter={(v: number) => [`${v}%`, "Attendance Rate"]} />
                                <Line type="monotone" dataKey="rate" stroke="#219EBC" strokeWidth={2.5} dot={{ fill: "#219EBC", r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Distribution Pie */}
                {distribution.length > 0 && (
                    <div className="bg-[#0B2E3A] rounded-xl border border-slate-800 p-6">
                        <h3 className="text-lg font-bold text-white mb-4">Status Distribution</h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                                <Pie data={distribution} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" paddingAngle={3}>
                                    {distribution.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                                </Pie>
                                <Tooltip contentStyle={{ backgroundColor: "#0B2E3A", border: "1px solid #334155", borderRadius: 8, color: "#EAF6F9", fontSize: 12 }} />
                                <Legend wrapperStyle={{ color: "#94a3b8", fontSize: 12 }} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    )
}
