"use client"

import { Eye, UserX, Globe, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { getAuthHeaders } from "@/lib/api"

interface Student {
  id: number
  name: string
  roll: string
  status: string
  attendance: number
  avatar?: string
}

interface Summary {
  total: number
  present: number
  absent: number
  late: number
  rate: number
}

export function LiveClassroomMonitor() {
  const [students, setStudents] = useState<Student[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, present: 0, absent: 0, late: 0, rate: 0 })
  const [loading, setLoading] = useState(true)
  const [lastSync, setLastSync] = useState<string>("--")
  const [filter, setFilter] = useState<"all" | "present" | "absent">("all")

  const fetchData = useCallback(async () => {
    try {
      const [studRes, sumRes] = await Promise.all([
        fetch("/api/students", { headers: getAuthHeaders() }),
        fetch("/api/analytics/summary", { headers: getAuthHeaders() }),
      ])
      if (studRes.ok) {
        const data: Student[] = await studRes.json()
        setStudents(data)
      }
      if (sumRes.ok) {
        const data: Summary = await sumRes.json()
        setSummary(data)
      }
      setLastSync(new Date().toLocaleTimeString())
    } catch {
      // silently ignore — user can manually refresh
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount, then poll every 10 seconds
  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 10_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const filtered = students.filter((s) => {
    if (filter === "present") return s.status === "present"
    if (filter === "absent") return s.status === "absent" || s.status === "late"
    return true
  })

  const presentCount = students.filter(s => s.status === "present").length
  const absentCount = students.filter(s => s.status === "absent").length

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">

      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-[rgba(33,158,188,0.1)]">
            <Globe className="size-5 text-[#219EBC]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Classroom Attendance Status</h3>
            <p className="text-xs text-muted-foreground">
              Use the Smartboard to capture attendance · Dashboard refreshes every 10s
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="size-3" /> Last sync: {lastSync}
          </span>
          <button
            onClick={fetchData}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/50
                       px-3 py-1.5 text-xs font-semibold text-foreground
                       hover:bg-muted transition-all"
          >
            <RefreshCw className="size-3" />
            Refresh
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5">

        {/* ── Summary stat cards ── */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total", value: summary.total, color: "#219EBC", bg: "rgba(33,158,188,0.08)" },
            { label: "Present", value: summary.present, color: "#27E8A7", bg: "rgba(39,232,167,0.08)" },
            { label: "Absent", value: summary.absent, color: "#FB8500", bg: "rgba(251,133,0,0.08)" },
            { label: "Rate", value: `${summary.rate}%`, color: "#C77DFF", bg: "rgba(199,125,255,0.08)" },
          ].map((s) => (
            <div
              key={s.label}
              style={{ background: s.bg, border: `1px solid ${s.color}30` }}
              className="rounded-xl px-4 py-3 text-center"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {s.label}
              </p>
              <p className="text-2xl font-black mt-1" style={{ color: s.color }}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        {/* ── Attendance rate bar ── */}
        <div>
          <div className="flex justify-between text-[10px] font-semibold text-muted-foreground mb-1.5">
            <span>Attendance Rate</span>
            <span className="text-foreground">{summary.rate}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${summary.rate}%`,
                background: summary.rate >= 75
                  ? "linear-gradient(90deg, #27E8A7, #219EBC)"
                  : summary.rate >= 50
                    ? "linear-gradient(90deg, #F59E0B, #FB8500)"
                    : "linear-gradient(90deg, #EF4444, #DC2626)",
              }}
            />
          </div>
        </div>

        {/* ── Filter tabs ── */}
        <div className="flex gap-2">
          {(["all", "present", "absent"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all capitalize ${filter === f
                  ? "bg-[#219EBC] text-white shadow"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
            >
              {f === "all"
                ? `All (${students.length})`
                : f === "present"
                  ? `Present (${presentCount})`
                  : `Absent (${absentCount})`}
            </button>
          ))}
        </div>

        {/* ── Student grid ── */}
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
            <RefreshCw className="size-4 animate-spin" />
            Loading students…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <div className="size-12 rounded-xl bg-muted/50 flex items-center justify-center">
              <UserX className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {students.length === 0
                ? "No students enrolled yet"
                : "No students match this filter"}
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              {students.length === 0
                ? "Add students in the Student Directory tab, then enrol their faces."
                : "Switch to 'All' to see every student."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 max-h-72 overflow-y-auto pr-1">
            {filtered.map((s) => {
              const isPresent = s.status === "present"
              const isLate = s.status === "late"
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all"
                  style={{
                    borderColor: isPresent ? "rgba(39,232,167,0.3)"
                      : isLate ? "rgba(251,191,36,0.3)"
                        : "rgba(255,255,255,0.06)",
                    background: isPresent ? "rgba(39,232,167,0.06)"
                      : isLate ? "rgba(251,191,36,0.06)"
                        : "rgba(255,255,255,0.02)",
                  }}
                >
                  {/* Avatar */}
                  <div
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black"
                    style={{
                      background: isPresent ? "rgba(39,232,167,0.2)"
                        : isLate ? "rgba(251,191,36,0.2)"
                          : "rgba(255,255,255,0.08)",
                      color: isPresent ? "#27E8A7"
                        : isLate ? "#FBD24F"
                          : "#8B9EC0",
                    }}
                  >
                    {s.avatar || s.name.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Name + roll */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-foreground leading-tight">
                      {s.name}
                    </p>
                    <p className="text-[9px] text-muted-foreground">{s.roll}</p>
                  </div>

                  {/* Status icon */}
                  {isPresent ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-[#27E8A7]" />
                  ) : isLate ? (
                    <Clock className="size-3.5 shrink-0 text-yellow-400" />
                  ) : (
                    <XCircle className="size-3.5 shrink-0 text-muted-foreground/40" />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── How-it-works strip ── */}
        <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground flex-wrap pt-1">
          {[
            "Smartboard Camera",
            "→",
            "5-Frame Burst",
            "→",
            "SCRFD Detection",
            "→",
            "GhostFaceNet",
            "→",
            "Attendance DB",
            "→",
            "This Dashboard",
          ].map((s, i) =>
            s === "→" ? (
              <span key={i} className="text-[#219EBC] font-bold">→</span>
            ) : (
              <span key={i} className="rounded bg-muted/60 px-2 py-0.5 font-semibold tracking-wide">
                {s}
              </span>
            )
          )}
        </div>

      </div>
    </div>
  )
}