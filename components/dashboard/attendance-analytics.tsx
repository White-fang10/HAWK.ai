"use client"

import { useState, useEffect } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts"
import { getDailyAnalytics, getWeeklyAnalytics, getAttendanceDistribution } from "@/lib/api"

export function AttendanceAnalytics() {
  const [dailyData, setDailyData] = useState<any[]>([])
  const [weeklyData, setWeeklyData] = useState<any[]>([])
  const [distribution, setDistribution] = useState<{ name: string; value: number; fill: string }[]>([])

  useEffect(() => {
    const load = () => {
      getDailyAnalytics().then(setDailyData).catch(console.error)
      getWeeklyAnalytics().then(setWeeklyData).catch(console.error)
      getAttendanceDistribution().then(setDistribution).catch(console.error)
    }
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [])

  const hasRealDailyData = dailyData.some(d => d.present > 0 || d.late > 0)
  const hasRealWeeklyData = weeklyData.some(w => w.rate > 0)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Daily Attendance Bar Chart */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">Daily Attendance</h3>
          <p className="text-xs text-muted-foreground">This week breakdown</p>
        </div>
        <div className="p-4">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dailyData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--card)",
                  color: "var(--foreground)",
                  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="present" fill="#219EBC" radius={[4, 4, 0, 0]} />
              <Bar dataKey="late" fill="#1E3A5F" radius={[4, 4, 0, 0]} />
              <Bar dataKey="absent" fill="#0D1B2A" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {!hasRealDailyData && (
            <p className="text-center text-[11px] text-muted-foreground mt-1 opacity-60">
              📷 Start the camera to begin logging attendance
            </p>
          )}
          <div className="mt-2 flex items-center justify-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[#219EBC]" />
              <span className="text-xs text-muted-foreground">Present</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[#1E3A5F]" />
              <span className="text-xs text-muted-foreground">Late</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-[#0D1B2A]" />
              <span className="text-xs text-muted-foreground">Absent</span>
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Trend Line Chart */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">Weekly Trend</h3>
          <p className="text-xs text-muted-foreground">Attendance rate over weeks</p>
        </div>
        <div className="p-4">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--card)",
                  color: "var(--foreground)",
                  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="#219EBC"
                strokeWidth={2.5}
                dot={{ fill: "#219EBC", strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, fill: "#219EBC" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Attendance Distribution Donut Chart */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">Distribution</h3>
          <p className="text-xs text-muted-foreground">Today{"'"}s attendance split</p>
        </div>
        <div className="flex flex-col items-center p-4">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={distribution}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                dataKey="value"
                strokeWidth={0}
              >
                {distribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--card)",
                  color: "var(--foreground)",
                  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4">
            {distribution.map((entry) => (
              <div key={entry.name} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                <span className="text-xs text-muted-foreground">
                  {entry.name} ({entry.value})
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
