"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConnectionResult {
  connected: boolean
  message:   string
}

interface CameraStatus {
  adb_configured: boolean
  adb_connected:  boolean
  raptor_ip:      string
  current_zoom:   number
}

// ── IP validation ─────────────────────────────────────────────────────────────

function isValidIp(ip: string) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
    ip.split(".").every((p) => parseInt(p) <= 255)
}

// ── Animated dot ─────────────────────────────────────────────────────────────

function PulseDot({ color }: { color: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 12, height: 12 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: color, opacity: 0.4,
        animation: "ping 1.4s cubic-bezier(0,0,0.2,1) infinite",
      }} />
      <span style={{ position: "relative", borderRadius: "50%", width: 12, height: 12, background: color }} />
    </span>
  )
}

// ── Terminal log line ─────────────────────────────────────────────────────────

function LogLine({ text, ok, ts }: { text: string; ok?: boolean; ts?: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <span style={{ color: "#5B7FA6", fontSize: 11, fontFamily: "monospace", flexShrink: 0, marginTop: 1 }}>{ts}</span>
      <span style={{ color: ok === undefined ? "#8B9EC0" : ok ? "#27E8A7" : "#FB8500", fontSize: 12, fontFamily: "monospace", lineHeight: 1.5 }}>
        {ok === undefined ? "›" : ok ? "✓" : "✗"} {text}
      </span>
    </div>
  )
}

// ── Preset card ───────────────────────────────────────────────────────────────

function PresetCard({ label, ip, selected, onClick }: {
  label: string; ip: string; selected: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? "rgba(39,232,167,0.12)" : "rgba(255,255,255,0.04)",
        border: `1px solid ${selected ? "#27E8A7" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 10,
        padding: "10px 14px",
        cursor: "pointer",
        textAlign: "left",
        transition: "all 0.2s",
        width: "100%",
      }}
    >
      <div style={{ color: selected ? "#27E8A7" : "#8B9EC0", fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#fff", fontSize: 13, fontFamily: "monospace" }}>{ip}</div>
    </button>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CameraConfigPage() {
  const [token,        setToken]        = useState<string | null>(null)
  const [ipInput,      setIpInput]      = useState("")
  const [savedIp,      setSavedIp]      = useState("")
  const [status,       setStatus]       = useState<CameraStatus | null>(null)
  const [phase,        setPhase]        = useState<"idle" | "pinging" | "connecting" | "done">("idle")
  const [result,       setResult]       = useState<ConnectionResult | null>(null)
  const [logs,         setLogs]         = useState<{ text: string; ok?: boolean; ts: string }[]>([])
  const [presets,      setPresets]      = useState<{ label: string; ip: string }[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = localStorage.getItem("hawk_token")
    setToken(t)
    loadStatus(t)

    // Load saved presets from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem("hawk_cam_presets") || "[]")
      setPresets(saved)
    } catch {}
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" })
  }, [logs])

  const addLog = (text: string, ok?: boolean) => {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false })
    setLogs(prev => [...prev.slice(-50), { text, ok, ts }])
  }

  const loadStatus = async (t: string | null) => {
    if (!t) return
    try {
      const res = await fetch("/api/camera/status", {
        headers: { Authorization: `Bearer ${t}` }
      })
      if (res.ok) {
        const data: CameraStatus = await res.json()
        setStatus(data)
        setIpInput(data.raptor_ip || "")
        setSavedIp(data.raptor_ip || "")
      }
    } catch {}
  }

  const savePreset = () => {
    if (!ipInput || !isValidIp(ipInput)) return
    const label = `Device ${presets.length + 1}`
    const next = [...presets.filter(p => p.ip !== ipInput), { label, ip: ipInput }].slice(-5)
    setPresets(next)
    localStorage.setItem("hawk_cam_presets", JSON.stringify(next))
    addLog(`Saved ${ipInput} as preset "${label}"`)
  }

  const connect = async () => {
    if (!token || !ipInput) return

    setPhase("pinging")
    setResult(null)
    setLogs([])

    addLog(`Resolving ${ipInput}…`)
    await sleep(300)
    addLog(`Sending ADB connect to ${ipInput}:5555…`)

    setPhase("connecting")
    await sleep(200)

    try {
      const res = await fetch("/api/camera/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ raptor_ip: ipInput }),
      })
      const data: ConnectionResult = await res.json()
      setResult(data)
      setPhase("done")

      if (data.connected) {
        addLog("ADB handshake complete", true)
        addLog("Camera control: HARDWARE mode", true)
        addLog(data.message, true)
        setSavedIp(ipInput)
        setStatus(prev => prev ? { ...prev, adb_connected: true, raptor_ip: ipInput } : null)
      } else {
        addLog("ADB connect failed", false)
        addLog(data.message, false)
        addLog("Fallback: software pan-zoom active", undefined)
      }
    } catch (e) {
      addLog("Network error — backend unreachable", false)
      setPhase("done")
      setResult({ connected: false, message: "Network error" })
    }
  }

  const clearIp = async () => {
    if (!token) return
    await fetch("/api/camera/config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ raptor_ip: "" }),
    })
    setIpInput("")
    setSavedIp("")
    setResult(null)
    setPhase("idle")
    setLogs([])
    setStatus(prev => prev ? { ...prev, adb_connected: false, raptor_ip: "" } : null)
    addLog("RAPTOR_IP cleared — using software zoom", undefined)
  }

  const isConnected = status?.adb_connected && savedIp === ipInput
  const inputValid  = isValidIp(ipInput)
  const isPending   = phase === "pinging" || phase === "connecting"

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #010D18 0%, #020E1A 40%, #011828 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      padding: "32px 16px 60px",
      gap: 24,
    }}>

      {/* ── Back nav ─────────────────────────────────────────────────── */}
      <div style={{ width: "100%", maxWidth: 760, display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/smartboard" style={{ color: "#5B7FA6", textDecoration: "none", fontSize: 13, display: "flex", alignItems: "center", gap: 5, transition: "color 0.15s" }}>
          ← Back to Smartboard
        </Link>
      </div>

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", maxWidth: 560 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 20,
          background: "linear-gradient(135deg, #027A4B 0%, #04C97B 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 30, margin: "0 auto 20px",
          boxShadow: "0 0 40px rgba(4,201,123,0.3)",
        }}>
          📡
        </div>
        <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 800, margin: "0 0 8px", letterSpacing: "-0.5px" }}>
          Camera Configuration
        </h1>
        <p style={{ color: "#5B7FA6", fontSize: 14, margin: 0, lineHeight: 1.7 }}>
          Connect Hawk.ai to your <strong style={{ color: "#8B9EC0" }}>Raptor 65 smartboard</strong> via ADB
          for hardware-level zoom and focus control.
        </p>
      </div>

      {/* ── Current status badge ──────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 12, alignItems: "center",
        background: isConnected ? "rgba(39,232,167,0.08)" : "rgba(251,133,0,0.08)",
        border: `1px solid ${isConnected ? "rgba(39,232,167,0.3)" : "rgba(251,133,0,0.25)"}`,
        borderRadius: 999,
        padding: "8px 20px",
        fontSize: 13, fontWeight: 700,
      }}>
        <PulseDot color={isConnected ? "#27E8A7" : "#FB8500"} />
        <span style={{ color: isConnected ? "#27E8A7" : "#FB8500" }}>
          {isConnected ? `Hardware Camera Active — ${savedIp}` : "Software Pan-Zoom (No Hardware Connected)"}
        </span>
      </div>

      {/* ── Main card ─────────────────────────────────────────────────── */}
      <div style={{
        width: "100%", maxWidth: 760,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 24,
        overflow: "hidden",
      }}>

        {/* Card header */}
        <div style={{
          padding: "20px 28px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "rgba(39,232,167,0.12)",
            border: "1px solid rgba(39,232,167,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>🔌</div>
          <div>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>Smartboard IP Address</div>
            <div style={{ color: "#5B7FA6", fontSize: 12 }}>Find it in the smartboard's Network Settings → Wi-Fi → IPv4 address</div>
          </div>
        </div>

        {/* IP input area */}
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Input + button row */}
          <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
              <input
                ref={inputRef}
                type="text"
                placeholder="e.g. 10.94.223.110"
                value={ipInput}
                onChange={e => { setIpInput(e.target.value); setPhase("idle"); setResult(null) }}
                onKeyDown={e => e.key === "Enter" && inputValid && !isPending && connect()}
                style={{
                  width: "100%",
                  background: "rgba(0,0,0,0.25)",
                  border: `2px solid ${
                    ipInput === ""
                      ? "rgba(255,255,255,0.1)"
                      : inputValid
                        ? result?.connected ? "#27E8A7" : "rgba(39,232,167,0.4)"
                        : "rgba(251,133,0,0.5)"
                  }`,
                  borderRadius: 12,
                  padding: "13px 48px 13px 18px",
                  color: "#fff",
                  fontSize: 20,
                  fontFamily: "monospace",
                  fontWeight: 700,
                  outline: "none",
                  letterSpacing: 1,
                  transition: "border-color 0.2s",
                  boxSizing: "border-box",
                }}
              />
              {ipInput && (
                <button
                  onClick={() => { setIpInput(""); inputRef.current?.focus() }}
                  style={{
                    position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                    background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 6,
                    color: "#8B9EC0", fontSize: 12, cursor: "pointer", padding: "2px 6px",
                  }}
                >✕</button>
              )}
            </div>

            <button
              id="btn-connect-camera"
              onClick={connect}
              disabled={!inputValid || isPending}
              style={{
                background: inputValid && !isPending
                  ? "linear-gradient(135deg, #04C97B 0%, #27E8A7 100%)"
                  : "rgba(255,255,255,0.07)",
                color: inputValid && !isPending ? "#010D18" : "#5B7FA6",
                border: "none",
                borderRadius: 12,
                padding: "13px 32px",
                fontWeight: 800,
                fontSize: 15,
                cursor: inputValid && !isPending ? "pointer" : "not-allowed",
                transition: "all 0.2s",
                minWidth: 160,
                letterSpacing: 0.3,
              }}
            >
              {isPending
                ? phase === "pinging" ? "Pinging..." : "Connecting..."
                : result?.connected ? "✓ Reconnect" : "Connect"}
            </button>
          </div>

          {/* Validation hint */}
          {ipInput && !inputValid && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ color: "#FB8500", fontSize: 12 }}>⚠ Enter a valid IPv4 address (e.g. 192.168.1.100)</span>
            </div>
          )}

          {/* Quick presets */}
          {presets.length > 0 && (
            <div>
              <p style={{ color: "#5B7FA6", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}>
                Recent Devices
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {presets.map(p => (
                  <PresetCard
                    key={p.ip}
                    label={p.label}
                    ip={p.ip}
                    selected={ipInput === p.ip}
                    onClick={() => setIpInput(p.ip)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Save preset button */}
          {inputValid && (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={savePreset}
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: "6px 14px",
                  color: "#8B9EC0",
                  fontSize: 12,
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
              >
                + Save as Preset
              </button>
              {savedIp && (
                <button
                  onClick={clearIp}
                  style={{
                    background: "rgba(251,133,0,0.07)",
                    border: "1px solid rgba(251,133,0,0.2)",
                    borderRadius: 8,
                    padding: "6px 14px",
                    color: "#FB8500",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Clear & Disconnect
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── ADB Terminal output ──────────────────────────────────────── */}
        <div style={{
          margin: "0 28px 24px",
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "8px 14px",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <div style={{ display: "flex", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F57", display: "inline-block" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FFBD2E", display: "inline-block" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28CA41", display: "inline-block" }} />
            </div>
            <span style={{ color: "#5B7FA6", fontSize: 11, fontFamily: "monospace", marginLeft: 4 }}>adb connect log</span>
            {isPending && (
              <span style={{ marginLeft: "auto", fontSize: 10, color: "#27E8A7", fontFamily: "monospace", animation: "pulse 1s infinite" }}>
                ● LIVE
              </span>
            )}
          </div>
          <div
            ref={logRef}
            style={{
              padding: "12px 16px",
              minHeight: 120,
              maxHeight: 200,
              overflowY: "auto",
              fontFamily: "monospace",
              scrollbarWidth: "thin",
              scrollbarColor: "#27E8A7 transparent",
            }}
          >
            {logs.length === 0 ? (
              <span style={{ color: "#2a3a4a", fontSize: 12 }}>
                › Enter an IP address and click Connect to begin…
              </span>
            ) : (
              logs.map((l, i) => <LogLine key={i} text={l.text} ok={l.ok} ts={l.ts} />)
            )}
          </div>
        </div>
      </div>

      {/* ── How to find the IP ───────────────────────────────────────── */}
      <div style={{
        width: "100%", maxWidth: 760,
        background: "rgba(33,158,188,0.05)",
        border: "1px solid rgba(33,158,188,0.15)",
        borderRadius: 20,
        padding: "22px 28px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
        gap: 20,
      }}>
        <div>
          <div style={{ color: "#219EBC", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📺 On Raptor 65</div>
          <ol style={{ color: "#8B9EC0", fontSize: 13, margin: 0, paddingLeft: 18, lineHeight: 2 }}>
            <li>Settings → Network</li>
            <li>Wi-Fi → Your Network</li>
            <li>Copy <strong style={{ color: "#fff" }}>IPv4 Address</strong></li>
          </ol>
        </div>
        <div>
          <div style={{ color: "#219EBC", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>💻 On This Laptop</div>
          <ol style={{ color: "#8B9EC0", fontSize: 13, margin: 0, paddingLeft: 18, lineHeight: 2 }}>
            <li>Settings → Network</li>
            <li>Wi-Fi → Properties</li>
            <li><strong style={{ color: "#fff" }}>IPv4 address</strong> row</li>
          </ol>
        </div>
        <div>
          <div style={{ color: "#219EBC", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🔧 ADB Setup</div>
          <ol style={{ color: "#8B9EC0", fontSize: 13, margin: 0, paddingLeft: 18, lineHeight: 2 }}>
            <li>Enable Developer Options</li>
            <li>Turn on USB Debugging</li>
            <li>Same Wi-Fi network</li>
          </ol>
        </div>
      </div>

      <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        input::placeholder { color: rgba(255,255,255,0.2); }
        button:active:not(:disabled) { transform: scale(0.97); }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(39,232,167,0.4); border-radius: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
