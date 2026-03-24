"use client"

import { useState, useEffect } from "react"
import { BurstCapture } from "@/components/BurstCapture"

interface ConfirmedStudent {
  student_id: number
  name: string
  votes: number
  out_of: number
}

interface AttendanceResult {
  confirmed:    ConfirmedStudent[]
  total_marked: number
}

export default function SmartBoardPage() {
  const [backendOk,  setBackendOk]  = useState<boolean | null>(null)
  const [lastResult, setLastResult] = useState<AttendanceResult | null>(null)
  const [resultTime, setResultTime] = useState<string>("")
  const [token,      setToken]      = useState<string | null>(null)

  // Load JWT token from localStorage (set by teacher dashboard on login)
  useEffect(() => {
    setToken(localStorage.getItem("hawk_token"))
  }, [])

  // Health check on mount
  useEffect(() => {
    fetch("/api/camera/health")
      .then((r) => (r.ok ? setBackendOk(true) : setBackendOk(false)))
      .catch(() => setBackendOk(false))
  }, [])

  function handleResult(data: AttendanceResult) {
    setLastResult(data)
    setResultTime(new Date().toLocaleTimeString())
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #010D18 0%, #023047 60%, #011520 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        padding: "24px",
        gap: 24,
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 36 }}>🦅</span>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#FFFFFF", margin: 0, letterSpacing: "-0.5px" }}>
            Hawk.ai
          </h1>
        </div>
        <p style={{ color: "#8B9EC0", fontSize: 14, margin: 0 }}>
          Smart Board — Burst Attendance Capture
        </p>
      </div>

      {/* Backend status pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background:
            backendOk === null
              ? "rgba(139,158,192,0.1)"
              : backendOk
              ? "rgba(39,232,167,0.1)"
              : "rgba(251,133,0,0.1)",
          border: `1px solid ${
            backendOk === null ? "#8B9EC0" : backendOk ? "#27E8A7" : "#FB8500"
          }`,
          borderRadius: 999,
          padding: "6px 14px",
          fontSize: 13,
          color: backendOk === null ? "#8B9EC0" : backendOk ? "#27E8A7" : "#FB8500",
          fontWeight: 600,
        }}
      >
        <span
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "currentColor", display: "inline-block",
          }}
        />
        {backendOk === null
          ? "Checking backend…"
          : backendOk
          ? "Backend connected"
          : "Backend unreachable — start the backend server"}
      </div>

      {/* BurstCapture component */}
      {backendOk !== false && (
        <BurstCapture onResult={handleResult} token={token} />
      )}

      {/* Results panel */}
      {lastResult && (
        <div
          style={{
            width: "100%",
            maxWidth: 860,
            background: "rgba(39,232,167,0.06)",
            border: "1px solid rgba(39,232,167,0.25)",
            borderRadius: 16,
            padding: "20px 24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, color: "#27E8A7", fontSize: 16, fontWeight: 800 }}>
              ✅ Attendance Recorded — {resultTime}
            </h2>
            <span
              style={{
                background: "rgba(39,232,167,0.15)",
                border: "1px solid rgba(39,232,167,0.4)",
                borderRadius: 999, padding: "4px 12px",
                fontSize: 13, fontWeight: 700, color: "#27E8A7",
              }}
            >
              {lastResult.total_marked} student{lastResult.total_marked !== 1 ? "s" : ""} marked present
            </span>
          </div>

          {lastResult.confirmed.length === 0 ? (
            <p style={{ color: "#8B9EC0", fontSize: 14, margin: 0 }}>
              No enrolled students detected. Ensure students are enrolled and looking at the camera.
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {lastResult.confirmed.map((s) => (
                <div
                  key={s.student_id}
                  style={{
                    background: "rgba(39,232,167,0.12)",
                    border: "1px solid rgba(39,232,167,0.35)",
                    borderRadius: 10,
                    padding: "8px 16px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 2,
                  }}
                >
                  <span style={{ color: "#27E8A7", fontWeight: 700, fontSize: 14 }}>
                    ✓ {s.name}
                  </span>
                  <span style={{ color: "#5B7FA6", fontSize: 11 }}>
                    {s.votes}/{s.out_of} frames
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Instructions */}
      <div
        style={{
          background: "rgba(33,158,188,0.06)",
          border: "1px solid rgba(33,158,188,0.2)",
          borderRadius: 12,
          padding: "16px 20px",
          maxWidth: 860,
          width: "100%",
          fontSize: 13,
          color: "#8B9EC0",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "#219EBC" }}>How to take attendance:</strong>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>Make sure all enrolled students are seated and facing forward.</li>
          <li>Announce <strong style={{ color: "#fff" }}>&quot;Look up&quot;</strong> — students looking down will be missed.</li>
          <li>Click <strong style={{ color: "#fff" }}>Take Attendance</strong> — 5 frames are captured over 2 seconds.</li>
          <li>Wait for processing (10–40 seconds on CPU). Results appear below.</li>
          <li>Check the teacher dashboard to review and correct attendance if needed.</li>
        </ol>
        <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: "#5B7FA6" }}>
          💡 Tip: A 3-second countdown in your head before clicking gives students time to look up.
          Students must appear in at least 3 of 5 frames to be confirmed.
        </p>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.1); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
