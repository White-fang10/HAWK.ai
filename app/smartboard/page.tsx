"use client"

import { useEffect, useRef, useState, useCallback } from "react"

const UPLOAD_INTERVAL_MS = 500 // Send a frame every 500ms

// ── Face box type returned by the backend ────────────────────────────────────
interface FaceBox {
    x1: number
    y1: number
    x2: number
    y2: number
    name: string
    known: boolean
}

interface Stats {
    detected: number
    recognized: string[]
    unknown: number
    timestamp: string
    faces: FaceBox[]
    frame_width: number
    frame_height: number
}

// ── Smooth interpolation helper ──────────────────────────────────────────────
// Linearly interpolates face box positions between 500ms server updates so
// the boxes don't jump abruptly when students move slightly.
function lerpBox(from: FaceBox, to: FaceBox, t: number): FaceBox {
    return {
        ...to,
        x1: from.x1 + (to.x1 - from.x1) * t,
        y1: from.y1 + (to.y1 - from.y1) * t,
        x2: from.x2 + (to.x2 - from.x2) * t,
        y2: from.y2 + (to.y2 - from.y2) * t,
    }
}

export default function SmartBoardPage() {
    const videoRef = useRef<HTMLVideoElement>(null)
    const captureCanvasRef = useRef<HTMLCanvasElement>(null)   // hidden – frame capture
    const overlayCanvasRef = useRef<HTMLCanvasElement>(null)   // visible – face box overlay

    const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle")
    const [errorMsg, setErrorMsg] = useState("")
    const [stats, setStats] = useState<Stats>({
        detected: 0,
        recognized: [],
        unknown: 0,
        timestamp: "--",
        faces: [],
        frame_width: 640,
        frame_height: 360,
    })
    const [backendOk, setBackendOk] = useState<boolean | null>(null)
    const [framesSent, setFramesSent] = useState(0)

    // Refs for smooth interpolation between server responses
    const prevBoxesRef = useRef<FaceBox[]>([])
    const targetBoxesRef = useRef<FaceBox[]>([])
    const interpStartRef = useRef<number>(0)
    const animFrameRef = useRef<number>(0)
    const latestStatsRef = useRef<Stats | null>(null)
    const intervalRef = useRef<NodeJS.Timeout | null>(null)

    const UPLOAD_URL = "/api/camera/upload"
    const HEALTH_URL = "/api/camera/health"

    // ─── Check backend health on mount ───────────────────────────────────────
    useEffect(() => {
        fetch(HEALTH_URL)
            .then((r) => r.ok ? setBackendOk(true) : setBackendOk(false))
            .catch(() => setBackendOk(false))
    }, [])

    // ─── Overlay drawing loop (requestAnimationFrame) ──────────────────────
    // Runs at display FPS. Interpolates box positions between server updates.
    // This is completely separate from the <video> element so it never blocks playback.
    const drawOverlay = useCallback(() => {
        const canvas = overlayCanvasRef.current
        const video = videoRef.current
        if (!canvas || !video) {
            animFrameRef.current = requestAnimationFrame(drawOverlay)
            return
        }

        // Keep overlay canvas exactly the same size as the rendered video
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
            canvas.width = video.clientWidth
            canvas.height = video.clientHeight
        }

        const ctx = canvas.getContext("2d")
        if (!ctx) {
            animFrameRef.current = requestAnimationFrame(drawOverlay)
            return
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height)

        const st = latestStatsRef.current
        const faces = targetBoxesRef.current
        if (!st || faces.length === 0) {
            animFrameRef.current = requestAnimationFrame(drawOverlay)
            return
        }

        const scaleX = canvas.width / st.frame_width
        const scaleY = canvas.height / st.frame_height

        // Interpolation progress (0 → 1 over UPLOAD_INTERVAL_MS)
        const elapsed = Date.now() - interpStartRef.current
        const t = Math.min(elapsed / UPLOAD_INTERVAL_MS, 1)

        const prevFaces = prevBoxesRef.current
        // Match prev → target by index (simplest strategy; avoids flickering)
        faces.forEach((box, i) => {
            const prev = prevFaces[i] ?? box
            const interp = lerpBox(prev, box, t)

            const x1 = interp.x1 * scaleX
            const y1 = interp.y1 * scaleY
            const x2 = interp.x2 * scaleX
            const y2 = interp.y2 * scaleY
            const w = x2 - x1
            const h = y2 - y1

            const green = box.known
            const strokeColor = green ? "#27E8A7" : "#FF4C4C"
            const fillColor = green ? "rgba(39,232,167,0.12)" : "rgba(255,76,76,0.10)"
            const labelBg = green ? "rgba(33,188,130,0.88)" : "rgba(220,50,50,0.88)"

            // ── Box ─────────────────────────────────────────────────────────
            const r = 6
            ctx.beginPath()
            ctx.moveTo(x1 + r, y1)
            ctx.lineTo(x2 - r, y1)
            ctx.quadraticCurveTo(x2, y1, x2, y1 + r)
            ctx.lineTo(x2, y2 - r)
            ctx.quadraticCurveTo(x2, y2, x2 - r, y2)
            ctx.lineTo(x1 + r, y2)
            ctx.quadraticCurveTo(x1, y2, x1, y2 - r)
            ctx.lineTo(x1, y1 + r)
            ctx.quadraticCurveTo(x1, y1, x1 + r, y1)
            ctx.closePath()
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = 2
            ctx.fillStyle = fillColor
            ctx.fill()
            ctx.stroke()

            // ── Corner accent lines (gives a HUD / camera-targeting feel) ───
            const accentLen = Math.min(w, h) * 0.18
            ctx.strokeStyle = strokeColor
            ctx.lineWidth = 3
            ;[
                // top-left
                [[x1, y1 + accentLen], [x1, y1], [x1 + accentLen, y1]],
                // top-right
                [[x2 - accentLen, y1], [x2, y1], [x2, y1 + accentLen]],
                // bottom-left
                [[x1, y2 - accentLen], [x1, y2], [x1 + accentLen, y2]],
                // bottom-right
                [[x2 - accentLen, y2], [x2, y2], [x2, y2 - accentLen]],
            ].forEach(([[ax, ay], [bx, by], [cx, cy]]) => {
                ctx.beginPath()
                ctx.moveTo(ax, ay)
                ctx.lineTo(bx, by)
                ctx.lineTo(cx, cy)
                ctx.stroke()
            })

            // ── Name label ──────────────────────────────────────────────────
            const label = box.name
            const fontSize = Math.max(11, Math.min(14, h * 0.14))
            ctx.font = `700 ${fontSize}px Inter, Segoe UI, sans-serif`
            const tw = ctx.measureText(label).width
            const labelH = fontSize + 8
            const labelY = Math.max(0, y1 - labelH - 2)

            ctx.fillStyle = labelBg
            // Manual rounded rect (cross-browser — no ctx.roundRect required)
            const lx = x1, ly = labelY, lw = tw + 14, lh = labelH, lr = 4
            ctx.beginPath()
            ctx.moveTo(lx + lr, ly)
            ctx.lineTo(lx + lw - lr, ly)
            ctx.arc(lx + lw - lr, ly + lr, lr, -Math.PI / 2, 0)
            ctx.lineTo(lx + lw, ly + lh - lr)
            ctx.arc(lx + lw - lr, ly + lh - lr, lr, 0, Math.PI / 2)
            ctx.lineTo(lx + lr, ly + lh)
            ctx.arc(lx + lr, ly + lh - lr, lr, Math.PI / 2, Math.PI)
            ctx.lineTo(lx, ly + lr)
            ctx.arc(lx + lr, ly + lr, lr, Math.PI, -Math.PI / 2)
            ctx.closePath()
            ctx.fill()

            ctx.fillStyle = "#FFFFFF"
            ctx.fillText(label, x1 + 7, labelY + labelH - 5)
        })

        animFrameRef.current = requestAnimationFrame(drawOverlay)
    }, [])

    // ─── Capture + upload loop ────────────────────────────────────────────────
    const startCapture = useCallback(async () => {
        setStatus("connecting")
        setErrorMsg("")

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: "environment" }, // prefer classroom-facing camera on the smartboard
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                },
                audio: false,
            })

            if (videoRef.current) {
                videoRef.current.srcObject = stream
                videoRef.current.play()
            }

            setStatus("live")

            // Start overlay animation loop
            animFrameRef.current = requestAnimationFrame(drawOverlay)

            intervalRef.current = setInterval(async () => {
                const video = videoRef.current
                const canvas = captureCanvasRef.current
                if (!video || !canvas || video.readyState < 2) return

                canvas.width = video.videoWidth || 640
                canvas.height = video.videoHeight || 360
                const ctx = canvas.getContext("2d")
                if (!ctx) return

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

                canvas.toBlob(async (blob) => {
                    if (!blob) return
                    const form = new FormData()
                    form.append("file", blob, "frame.jpg")

                    try {
                        const res = await fetch(UPLOAD_URL, { method: "POST", body: form })
                        if (res.ok) {
                            const data: Stats = await res.json()
                            // Save for animation loop
                            prevBoxesRef.current = targetBoxesRef.current
                            targetBoxesRef.current = data.faces ?? []
                            interpStartRef.current = Date.now()
                            latestStatsRef.current = data
                            setStats(data)
                            setFramesSent((n) => n + 1)
                        }
                    } catch {
                        // silently ignore single-frame failures
                    }
                }, "image/jpeg", 0.8)
            }, UPLOAD_INTERVAL_MS)
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Unknown error"
            setStatus("error")
            setErrorMsg(msg)
        }
    }, [drawOverlay])

    const stopCapture = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current)
        cancelAnimationFrame(animFrameRef.current)
        // Clear overlay
        const oc = overlayCanvasRef.current
        if (oc) {
            const ctx = oc.getContext("2d")
            ctx?.clearRect(0, 0, oc.width, oc.height)
        }
        const video = videoRef.current
        if (video?.srcObject) {
            const stream = video.srcObject as MediaStream
            stream.getTracks().forEach((t) => t.stop())
            video.srcObject = null
        }
        prevBoxesRef.current = []
        targetBoxesRef.current = []
        latestStatsRef.current = null
        setStatus("idle")
        setStats({ detected: 0, recognized: [], unknown: 0, timestamp: "--", faces: [], frame_width: 640, frame_height: 360 })
        setFramesSent(0)
    }, [])

    useEffect(() => () => stopCapture(), [stopCapture])

    // ─── UI helpers ───────────────────────────────────────────────────────────
    const statusColor = {
        idle: "#8B9EC0",
        connecting: "#FFB703",
        live: "#27E8A7",
        error: "#FB8500",
    }[status]

    const statusLabel = {
        idle: "● Idle",
        connecting: "◌ Connecting…",
        live: "● LIVE",
        error: "✕ Error",
    }[status]

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "linear-gradient(135deg, #010D18 0%, #023047 60%, #011520 100%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Inter', 'Segoe UI', sans-serif",
                padding: "24px",
                gap: "20px",
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
                <p style={{ color: "#8B9EC0", fontSize: 14, margin: 0 }}>Smart Board — Live Face Recognition Monitor</p>
            </div>

            {/* Backend status pill */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: backendOk === null ? "rgba(139,158,192,0.1)" : backendOk ? "rgba(39,232,167,0.1)" : "rgba(251,133,0,0.1)",
                    border: `1px solid ${backendOk === null ? "#8B9EC0" : backendOk ? "#27E8A7" : "#FB8500"}`,
                    borderRadius: 999,
                    padding: "6px 14px",
                    fontSize: 13,
                    color: backendOk === null ? "#8B9EC0" : backendOk ? "#27E8A7" : "#FB8500",
                    fontWeight: 600,
                }}
            >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                {backendOk === null ? "Checking backend…" : backendOk ? "Backend connected" : "Backend unreachable"}
            </div>

            {/* ── Video + Overlay ─────────────────────────────────────────────── */}
            <div
                style={{
                    position: "relative",
                    width: "100%",
                    maxWidth: 860,
                    borderRadius: 18,
                    overflow: "hidden",
                    border: "1px solid rgba(33,158,188,0.3)",
                    background: "#011520",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                    aspectRatio: "16/9",
                }}
            >
                {/* Raw webcam video — plays at native FPS, never touched by our overlay */}
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: status === "live" || status === "connecting" ? "block" : "none",
                    }}
                />

                {/* Face-box overlay canvas — sits on top, pointer-events:none so it's invisible to clicks */}
                <canvas
                    ref={overlayCanvasRef}
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        pointerEvents: "none",
                        display: status === "live" ? "block" : "none",
                    }}
                />

                {/* Placeholder when not live */}
                {(status === "idle" || status === "error") && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 12,
                        }}
                    >
                        <div
                            style={{
                                fontSize: 56,
                                background: "rgba(33,158,188,0.1)",
                                borderRadius: 16,
                                padding: "16px 24px",
                            }}
                        >
                            📷
                        </div>
                        <p style={{ color: "#8B9EC0", fontSize: 14, margin: 0 }}>
                            {status === "error" ? errorMsg : "Camera not started"}
                        </p>
                    </div>
                )}

                {/* LIVE badge */}
                {status === "live" && (
                    <div
                        style={{
                            position: "absolute",
                            top: 12,
                            left: 12,
                            background: "rgba(39,232,167,0.15)",
                            border: "1px solid #27E8A7",
                            borderRadius: 999,
                            padding: "4px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            color: "#27E8A7",
                            backdropFilter: "blur(8px)",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                        }}
                    >
                        <span
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius: "50%",
                                background: "#27E8A7",
                                animation: "pulse 1.5s ease-in-out infinite",
                                display: "inline-block",
                            }}
                        />
                        LIVE
                    </div>
                )}

                {/* AI model badge */}
                {status === "live" && (
                    <div
                        style={{
                            position: "absolute",
                            top: 12,
                            right: 12,
                            background: "rgba(1,21,32,0.75)",
                            backdropFilter: "blur(8px)",
                            border: "1px solid rgba(33,158,188,0.35)",
                            borderRadius: 8,
                            padding: "4px 10px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#8B9EC0",
                        }}
                    >
                        🧠 buffalo_l · InsightFace
                    </div>
                )}

                {/* Legend */}
                {status === "live" && (
                    <div
                        style={{
                            position: "absolute",
                            bottom: 12,
                            left: 12,
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                        }}
                    >
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#27E8A7", fontWeight: 700 }}>
                            <span style={{ width: 10, height: 10, border: "2px solid #27E8A7", borderRadius: 2, display: "inline-block" }} />
                            Recognised
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#FF4C4C", fontWeight: 700 }}>
                            <span style={{ width: 10, height: 10, border: "2px solid #FF4C4C", borderRadius: 2, display: "inline-block" }} />
                            Unknown
                        </span>
                    </div>
                )}

                {/* Timestamp + count */}
                {status === "live" && (
                    <div
                        style={{
                            position: "absolute",
                            bottom: 12,
                            right: 12,
                            background: "rgba(1,21,32,0.8)",
                            backdropFilter: "blur(8px)",
                            borderRadius: 8,
                            padding: "5px 12px",
                            fontSize: 12,
                            color: "#fff",
                            display: "flex",
                            gap: 12,
                        }}
                    >
                        <span>👁 {stats.detected} detected</span>
                        <span style={{ color: "#8B9EC0" }}>{stats.timestamp}</span>
                    </div>
                )}
            </div>

            {/* Hidden capture canvas */}
            <canvas ref={captureCanvasRef} style={{ display: "none" }} />

            {/* Controls */}
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                    onClick={status === "live" ? stopCapture : startCapture}
                    disabled={status === "connecting" || backendOk === false}
                    style={{
                        padding: "13px 32px",
                        borderRadius: 12,
                        border: "none",
                        cursor: status === "connecting" || backendOk === false ? "not-allowed" : "pointer",
                        fontWeight: 700,
                        fontSize: 15,
                        transition: "all 0.2s",
                        background:
                            status === "live"
                                ? "linear-gradient(135deg, #FB8500, #FF6B00)"
                                : "linear-gradient(135deg, #219EBC, #0A7EA4)",
                        color: "#fff",
                        boxShadow: status === "live"
                            ? "0 6px 24px rgba(251,133,0,0.35)"
                            : "0 6px 24px rgba(33,158,188,0.35)",
                        opacity: backendOk === false ? 0.5 : 1,
                    }}
                >
                    {status === "live" ? "⏹ Stop Monitoring" : "▶ Start Live Monitoring"}
                </button>

                <div
                    style={{
                        padding: "8px 16px",
                        borderRadius: 10,
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${statusColor}44`,
                        fontSize: 13,
                        fontWeight: 700,
                        color: statusColor,
                    }}
                >
                    {statusLabel}
                </div>
            </div>

            {/* Stats strip */}
            {status === "live" && (
                <div style={{ display: "flex", gap: 16, width: "100%", maxWidth: 860 }}>
                    {[
                        { label: "Faces Detected", value: stats.detected, color: "#219EBC" },
                        { label: "Recognised", value: stats.recognized.length, color: "#27E8A7" },
                        { label: "Unknown", value: stats.unknown, color: "#FF4C4C" },
                        { label: "Frames Sent", value: framesSent, color: "#8B9EC0" },
                    ].map(({ label, value, color }) => (
                        <div
                            key={label}
                            style={{
                                flex: 1,
                                background: "rgba(255,255,255,0.04)",
                                border: "1px solid rgba(255,255,255,0.07)",
                                borderRadius: 12,
                                padding: "14px 16px",
                                textAlign: "center",
                            }}
                        >
                            <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
                            <div style={{ fontSize: 11, color: "#8B9EC0", fontWeight: 600, marginTop: 2 }}>{label}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Recognised names */}
            {status === "live" && stats.recognized.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 860, width: "100%" }}>
                    <span style={{ fontSize: 12, color: "#8B9EC0", fontWeight: 600, alignSelf: "center" }}>Now recognised:</span>
                    {stats.recognized.map((name, i) => (
                        <span
                            key={i}
                            style={{
                                background: "rgba(39,232,167,0.15)",
                                border: "1px solid rgba(39,232,167,0.4)",
                                borderRadius: 20,
                                padding: "4px 14px",
                                fontSize: 13,
                                fontWeight: 700,
                                color: "#27E8A7",
                            }}
                        >
                            ✓ {name}
                        </span>
                    ))}
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
                <strong style={{ color: "#219EBC" }}>How to use on the Smart Board:</strong>
                <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                    <li>Make sure the backend server is running on the teacher&apos;s PC.</li>
                    <li>Open this page in the Smart Board&apos;s browser using the shared URL.</li>
                    <li>Click <strong style={{ color: "#fff" }}>Start Live Monitoring</strong> and allow camera access.</li>
                    <li>Face boxes will appear directly on the video — <span style={{ color: "#27E8A7" }}>green = recognised</span>, <span style={{ color: "#FF4C4C" }}>red = unknown</span>.</li>
                    <li>Check the teacher dashboard to see live attendance updates.</li>
                </ol>
                <p style={{ marginTop: 8, marginBottom: 0, fontSize: 12, color: "#5B7FA6" }}>
                    💡 Tip: For best recognition at &gt;5m, use a 4K or PTZ camera with optical zoom.
                </p>
            </div>

            <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
        </div>
    )
}
