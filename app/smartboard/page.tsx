"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { BurstCapture } from "@/components/BurstCapture"

// ── Types ─────────────────────────────────────────────────────────────────────

interface FaceResult {
  bbox:          [number, number, number, number]
  conf:          number
  face_size:     number
  name:          string
  student_id:    number | null
  score:         number
  face_enhanced: boolean
}

interface FrameDetail {
  frame_index:    number
  faces_detected: number
  faces:          FaceResult[]
  enhanced:       boolean
  preview_b64:    string
}

interface ConfirmedStudent {
  student_id: number
  name:       string
  votes:      number
  out_of:     number
}

interface AttendanceResult {
  confirmed:     ConfirmedStudent[]
  total_marked:  number
  frame_details: FrameDetail[]
  vote_counts:   Record<string, number>
}

interface CameraStatus {
  adb_configured: boolean
  adb_connected:  boolean
  raptor_ip:      string
  current_zoom:   number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64Src(b64: string) {
  return `data:image/jpeg;base64,${b64}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FrameStrip({
  frames,
  selected,
  onSelect,
}: {
  frames: FrameDetail[]
  selected: number
  onSelect: (i: number) => void
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        overflowX: "auto",
        padding: "6px 2px 10px",
        scrollbarWidth: "thin",
        scrollbarColor: "#27E8A7 #0a1a2e",
      }}
    >
      {frames.map((f) => (
        <button
          key={f.frame_index}
          id={`thumb-frame-${f.frame_index}`}
          onClick={() => onSelect(f.frame_index)}
          style={{
            flexShrink: 0,
            position: "relative",
            width: 130,
            border: selected === f.frame_index
              ? "2px solid #27E8A7"
              : "2px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            overflow: "hidden",
            cursor: "pointer",
            background: "#0a1a2e",
            padding: 0,
            transition: "border-color 0.2s, box-shadow 0.2s",
            boxShadow: selected === f.frame_index
              ? "0 0 14px rgba(39,232,167,0.35)"
              : "none",
          }}
        >
          {f.preview_b64 ? (
            <img
              src={b64Src(f.preview_b64)}
              alt={`Frame ${f.frame_index + 1}`}
              style={{ width: "100%", height: 80, objectFit: "cover", display: "block" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: 80,
                background: "rgba(255,255,255,0.04)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#5B7FA6",
                fontSize: 11,
              }}
            >
              No preview
            </div>
          )}

          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
              padding: "4px 6px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>
              F{f.frame_index + 1}
            </span>
            <span style={{ color: "#27E8A7", fontSize: 10, fontWeight: 600 }}>
              {f.faces_detected} face{f.faces_detected !== 1 ? "s" : ""}
            </span>
          </div>

          {f.enhanced && (
            <div
              style={{
                position: "absolute",
                top: 5,
                right: 5,
                background: "rgba(39,232,167,0.9)",
                color: "#001f14",
                fontSize: 9,
                fontWeight: 800,
                borderRadius: 4,
                padding: "2px 5px",
                letterSpacing: 0.5,
              }}
            >
              SR×2
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

function FrameViewer({ frame }: { frame: FrameDetail }) {
  return (
    <div
      style={{
        borderRadius: 14,
        overflow: "hidden",
        border: "1px solid rgba(39,232,167,0.25)",
        background: "#000",
        position: "relative",
      }}
    >
      {frame.preview_b64 ? (
        <img
          src={b64Src(frame.preview_b64)}
          alt={`Enhanced frame ${frame.frame_index + 1}`}
          style={{ width: "100%", display: "block", maxHeight: 480, objectFit: "contain" }}
        />
      ) : (
        <div
          style={{
            height: 280,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#5B7FA6",
            fontSize: 14,
          }}
        >
          No preview available
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            background: "rgba(0,0,0,0.72)",
            border: "1px solid rgba(39,232,167,0.5)",
            color: "#27E8A7",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            padding: "3px 9px",
            backdropFilter: "blur(6px)",
          }}
        >
          Frame {frame.frame_index + 1}
        </span>

        {frame.enhanced && (
          <span
            style={{
              background: "rgba(39,232,167,0.85)",
              color: "#001f14",
              fontSize: 11,
              fontWeight: 800,
              borderRadius: 6,
              padding: "3px 9px",
              letterSpacing: 0.5,
            }}
          >
            ⬆ REAL-ESRGAN ×2
          </span>
        )}
      </div>
    </div>
  )
}

function FaceList({ faces }: { faces: FaceResult[] }) {
  if (!faces.length) {
    return <p style={{ color: "#5B7FA6", fontSize: 13, margin: 0, padding: "8px 0" }}>No faces detected.</p>
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {faces.map((f, i) => {
        const identified = f.student_id !== null
        return (
          <div
            key={i}
            style={{
              background: identified ? "rgba(39,232,167,0.10)" : "rgba(251,133,0,0.08)",
              border: `1px solid ${identified ? "rgba(39,232,167,0.3)" : "rgba(251,133,0,0.25)"}`,
              borderRadius: 10,
              padding: "8px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 120,
            }}
          >
            <span style={{ color: identified ? "#27E8A7" : "#FB8500", fontWeight: 700, fontSize: 13 }}>
              {identified ? `✓ ${f.name}` : "✗ Unknown"}
            </span>
            <span style={{ color: "#5B7FA6", fontSize: 11 }}>
              {f.face_size}px · conf {f.conf.toFixed(2)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SmartBoardPage() {
  const [backendOk,      setBackendOk]      = useState<boolean | null>(null)
  const [cameraStatus,   setCameraStatus]   = useState<CameraStatus | null>(null)
  const [lastResult,     setLastResult]     = useState<AttendanceResult | null>(null)
  const [resultTime,     setResultTime]     = useState<string>("")
  const [token,          setToken]          = useState<string | null>(null)
  const [selectedFrame,  setSelectedFrame]  = useState<number>(0)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setToken(localStorage.getItem("hawk_token"))
    fetchStatus()
  }, [])

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/camera/status", {
        headers: { "Authorization": `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setCameraStatus(data)
        setBackendOk(true)
      } else {
        setBackendOk(false)
      }
    } catch (e) {
      setBackendOk(false)
    }
  }

  function handleResult(data: AttendanceResult) {
    setLastResult(data)
    setResultTime(new Date().toLocaleTimeString())
    setSelectedFrame(0)
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 120)
  }

  const frames       = lastResult?.frame_details ?? []
  const activeFrame  = frames.find((f) => f.frame_index === selectedFrame) ?? frames[0]

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #010D18 0%, #023047 60%, #011520 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        padding: "24px 16px",
        gap: 24,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 6 }}>
          <span style={{ fontSize: 36 }}>🦅</span>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#FFFFFF", margin: 0, letterSpacing: "-0.5px" }}>
            Hawk.ai
          </h1>
        </div>
        <p style={{ color: "#8B9EC0", fontSize: 14, margin: 0 }}>
          Smart Board — Real-ESRGAN Enhanced Burst Attendance
        </p>
      </div>

      {/* ── Camera status bar ─────────────────────────────────────────────── */}
      <div
        style={{
          width: "100%",
          maxWidth: 920,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: "14px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
            background: cameraStatus?.adb_connected ? "#27E8A7" : "#FB8500",
            boxShadow: cameraStatus?.adb_connected ? "0 0 8px #27E8A7" : "none",
          }} />
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {cameraStatus?.adb_connected
              ? `Hardware Camera — ${cameraStatus.raptor_ip}`
              : "Software Pan-Zoom (No Smartboard Connected)"}
          </span>
          {cameraStatus?.raptor_ip && !cameraStatus.adb_connected && (
            <span style={{ color: "#5B7FA6", fontSize: 12 }}>· last IP: {cameraStatus.raptor_ip}</span>
          )}
        </div>

        <Link
          href="/smartboard/camera-config"
          id="btn-configure-camera"
          style={{
            background: "linear-gradient(135deg, #04C97B 0%, #27E8A7 100%)",
            color: "#010D18",
            textDecoration: "none",
            borderRadius: 10,
            padding: "8px 20px",
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 0.2,
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "opacity 0.2s",
          }}
        >
          📡 Configure Camera
        </Link>
      </div>

      {/* ── BurstCapture ───────────────────────────────────────────────── */}
      {backendOk !== false && (
        <BurstCapture onResult={handleResult} token={token} />
      )}

      {/* ── Results ────────────────────────────────────────────────────── */}
      {lastResult && (
        <div
          ref={resultsRef}
          id="attendance-results"
          style={{ width: "100%", maxWidth: 920, display: "flex", flexDirection: "column", gap: 20 }}
        >
          <div
            style={{
              background: "rgba(39,232,167,0.06)",
              border: "1px solid rgba(39,232,167,0.25)",
              borderRadius: 16,
              padding: "18px 22px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0, color: "#27E8A7", fontSize: 16, fontWeight: 800 }}>
              ✅ Attendance Recorded — {resultTime}
            </h2>
            <span style={{
              background: "rgba(39,232,167,0.15)",
              border: "1px solid rgba(39,232,167,0.4)",
              borderRadius: 999, padding: "4px 14px",
              fontSize: 14, fontWeight: 700, color: "#27E8A7"
            }}>
              {lastResult.total_marked} student{lastResult.total_marked !== 1 ? "s" : ""} marked present
            </span>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "16px 20px" }}>
            <h3 style={{ margin: "0 0 12px", color: "#8B9EC0", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
              Confirmed Present
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {lastResult.confirmed.map((s) => (
                <div
                  key={s.student_id}
                  style={{ background: "rgba(39,232,167,0.12)", border: "1px solid rgba(39,232,167,0.35)", borderRadius: 10, padding: "8px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}
                >
                  <span style={{ color: "#27E8A7", fontWeight: 700, fontSize: 14 }}>✓ {s.name}</span>
                  <span style={{ color: "#5B7FA6", fontSize: 11 }}>{s.votes}/{s.out_of} frames</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <FrameStrip frames={frames} selected={selectedFrame} onSelect={setSelectedFrame} />
            {activeFrame && (
              <>
                <FrameViewer frame={activeFrame} />
                <div>
                  <p style={{ color: "#8B9EC0", fontSize: 12, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Detected Faces</p>
                  <FaceList faces={activeFrame.faces} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Instructions ───────────────────────────────────────────────── */}
      <div style={{ background: "rgba(33,158,188,0.06)", border: "1px solid rgba(33,158,188,0.2)", borderRadius: 12, padding: "16px 20px", maxWidth: 920, width: "100%", fontSize: 13, color: "#8B9EC0", lineHeight: 1.7 }}>
        <strong style={{ color: "#219EBC" }}>Raptor 65 Setup:</strong>
        <p style={{ margin: "4px 0" }}>Enter the IP shown in your Smartboard network settings above. Ensure ADB is enabled in Developer Options. Once connected, Hawk.ai will control the physical camera hardware for maximum detail.</p>
      </div>

      <style>{`
        input:focus { border-color: #27E8A7 !important; box-shadow: 0 0 10px rgba(39,232,167,0.1); }
        button:active { transform: scale(0.96); }
        ::-webkit-scrollbar { height: 5px; }
        ::-webkit-scrollbar-track { background: #0a1a2e; }
        ::-webkit-scrollbar-thumb { background: #27E8A7; border-radius: 3px; }
      `}</style>
    </div>
  )
}
