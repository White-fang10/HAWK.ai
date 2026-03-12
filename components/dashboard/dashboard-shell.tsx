"use client"

import { useState } from "react"
import Image from "next/image"
import { SidebarNav } from "@/components/dashboard/sidebar-nav"
import { TopNavbar } from "@/components/dashboard/top-navbar"
import { SummaryCards } from "@/components/dashboard/summary-cards"
import { LiveClassroomMonitor } from "@/components/dashboard/live-monitor"
import { AttendanceAnalytics } from "@/components/dashboard/attendance-analytics"
import { StudentDirectory } from "@/components/dashboard/student-directory"
import { RealtimeAlerts } from "@/components/dashboard/realtime-alerts"
import { ReportExport } from "@/components/dashboard/report-export"
import { ClassInsights } from "@/components/dashboard/class-insights"
import { AbsentStudents } from "@/components/dashboard/absent-students"
import { resetAttendance } from "@/lib/api"
import { RotateCcw } from "lucide-react"

export function DashboardShell() {
  const [activeTab, setActiveTab] = useState("dashboard")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [globalSearch, setGlobalSearch] = useState("")

  return (
    <div className="min-h-screen bg-background relative">
      {/* Watermark logo background */}
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0">
        <Image src="/newlogo.png" alt="" width={500} height={500} className="opacity-[0.03] select-none" priority />
      </div>
      <SidebarNav activeTab={activeTab} onTabChange={setActiveTab} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="relative z-10 transition-all duration-300" style={{ marginLeft: sidebarCollapsed ? 72 : 240 }}>
        <TopNavbar sidebarCollapsed={sidebarCollapsed} onSearch={setGlobalSearch} />
        <main className="p-6">
          {activeTab === "dashboard" && <DashboardView externalSearch={globalSearch} />}
          {activeTab === "monitor" && <MonitorView />}
          {activeTab === "students" && <StudentsView externalSearch={globalSearch} />}
          {activeTab === "analytics" && <AnalyticsView />}
          {activeTab === "reports" && <ReportsView />}
        </main>
      </div>
    </div>
  )
}

function ResetAttendanceButton() {
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleReset = async () => {
    if (!confirm("Reset today's attendance? All students will be marked absent until detected again.")) return
    setLoading(true)
    try {
      await resetAttendance()
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    } catch (e) {
      alert("Failed to reset attendance. Is the backend running?")
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleReset}
      disabled={loading}
      className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-2 text-sm font-semibold text-foreground transition-all hover:bg-muted disabled:opacity-50"
    >
      <RotateCcw className={`size-4 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Resetting..." : done ? "✓ Reset!" : "Reset Attendance"}
    </button>
  )
}

function DashboardView({ externalSearch }: { externalSearch?: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Welcome back. Here{"'"}s your classroom overview.
          </p>
        </div>
        <ResetAttendanceButton />
      </div>
      <SummaryCards />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <LiveClassroomMonitor />
        </div>
        <div className="flex flex-col gap-6">
          <RealtimeAlerts />
        </div>
      </div>
      <AbsentStudents />
      <AttendanceAnalytics />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ClassInsights />
        <ReportExport />
      </div>
      <StudentDirectory externalSearch={externalSearch} />
    </div>
  )
}

function MonitorView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Live Classroom Monitor</h1>
        <p className="text-sm text-muted-foreground">Real-time AI face detection tracking</p>
      </div>
      <LiveClassroomMonitor />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RealtimeAlerts />
        <ClassInsights />
      </div>
    </div>
  )
}

function StudentsView({ externalSearch }: { externalSearch?: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Student Directory</h1>
        <p className="text-sm text-muted-foreground">Manage students and view individual attendance records</p>
      </div>
      <StudentDirectory externalSearch={externalSearch} />
    </div>
  )
}

function AnalyticsView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Attendance Analytics</h1>
        <p className="text-sm text-muted-foreground">Detailed charts and trends for classroom attendance</p>
      </div>
      <AttendanceAnalytics />
      <ClassInsights />
    </div>
  )
}

function ReportsView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate and export attendance reports</p>
      </div>
      <ReportExport />
    </div>
  )
}
