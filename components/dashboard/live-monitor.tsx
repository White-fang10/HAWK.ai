"use client"

import { Video, Eye, UserX, Radio, Globe, Camera, Square } from "lucide-react"
import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"

const FRAME_INTERVAL_MS = 1000 // ms between frame uploads (sequential)
const CAPTURE_WIDTH = 960
const CAPTURE_HEIGHT = 540

// ── Face box type returned by backend ────────────────────────────────────────
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

// ── Manual rounded rect (cross-browser — no ctx.roundRect required) ───────────
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
  ctx.lineTo(x + w, y + h - r)
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
  ctx.lineTo(x + r, y + h)
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + r)
  ctx.arc(x + r, y + r, r, Math.PI, -Math.PI / 2)
  ctx.closePath()
}

export function LiveClassroomMonitor() {
  const [mode, setMode] = useState<"idle" | "streaming">("idle")
  const [stats, setStats] = useState<Stats>({
    detected: 0,
    recognized: [],
    unknown: 0,
    timestamp: "--",
    faces: [],
    frame_width: CAPTURE_WIDTH,
    frame_height: CAPTURE_HEIGHT,
  })
  const [framesSent, setFramesSent] = useState(0)
  const [camError, setCamError] = useState("")

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)      // hidden – frame capture
  const overlayRef = useRef<HTMLCanvasElement>(null)     // visible – face-box overlay
  const streamRef = useRef<MediaStream | null>(null)
  const activeRef = useRef(false)
  const latestStatsRef = useRef<Stats | null>(null)
  const animFrameRef = useRef<number>(0)

  const UPLOAD_URL = "/api/camera/upload"

  // ── Draw face boxes onto the overlay canvas ─────────────────────────────────
  const drawFaceBoxes = useCallback(() => {
    const canvas = overlayRef.current
    const video = videoRef.current
    if (!canvas || !video) {
      animFrameRef.current = requestAnimationFrame(drawFaceBoxes)
      return
    }

    // Keep canvas pixel size synced to rendered video element
    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth
      canvas.height = video.clientHeight
    }

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      animFrameRef.current = requestAnimationFrame(drawFaceBoxes)
      return
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const st = latestStatsRef.current
    if (!st || st.faces.length === 0) {
      animFrameRef.current = requestAnimationFrame(drawFaceBoxes)
      return
    }

    const scaleX = canvas.width / st.frame_width
    const scaleY = canvas.height / st.frame_height

    st.faces.forEach((box) => {
      const x1 = box.x1 * scaleX
      const y1 = box.y1 * scaleY
      const x2 = box.x2 * scaleX
      const y2 = box.y2 * scaleY
      const w = x2 - x1
      const h = y2 - y1

      const strokeColor = box.known ? "#27E8A7" : "#FF4C4C"
      const fillColor   = box.known ? "rgba(39,232,167,0.10)" : "rgba(255,76,76,0.09)"
      const labelBg     = box.known ? "rgba(33,188,130,0.88)"  : "rgba(220,50,50,0.88)"

      // ── Bounding box ─────────────────────────────────────────────────────
      const r = 5
      roundRect(ctx, x1, y1, w, h, r)
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 2
      ctx.fillStyle = fillColor
      ctx.fill()
      ctx.stroke()

      // ── Corner HUD accents ────────────────────────────────────────────────
      const al = Math.min(w, h) * 0.18
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 2.5
      ;[
        [[x1, y1 + al], [x1, y1], [x1 + al, y1]],
        [[x2 - al, y1], [x2, y1], [x2, y1 + al]],
        [[x1, y2 - al], [x1, y2], [x1 + al, y2]],
        [[x2 - al, y2], [x2, y2], [x2, y2 - al]],
      ].forEach(([[ax, ay], [bx, by], [cx, cy]]) => {
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.lineTo(cx, cy)
        ctx.stroke()
      })

      // ── Name label ────────────────────────────────────────────────────────
      const fontSize = Math.max(10, Math.min(14, h * 0.12))
      ctx.font = `700 ${fontSize}px Inter, Segoe UI, sans-serif`
      const tw = ctx.measureText(box.name).width
      const lh = fontSize + 8
      const ly = Math.max(0, y1 - lh - 2)

      ctx.fillStyle = labelBg
      roundRect(ctx, x1, ly, tw + 14, lh, 4)
      ctx.fill()

      ctx.fillStyle = "#FFFFFF"
      ctx.fillText(box.name, x1 + 7, ly + lh - 4)
    })

    animFrameRef.current = requestAnimationFrame(drawFaceBoxes)
  }, [])

  // ── Sequential upload loop ──────────────────────────────────────────────────
  const uploadLoop = useCallback(async () => {
    while (activeRef.current) {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) {
        await new Promise(r => setTimeout(r, 300))
        continue
      }

      canvas.width = CAPTURE_WIDTH
      canvas.height = CAPTURE_HEIGHT
      const ctx = canvas.getContext("2d")
      if (!ctx) { await new Promise(r => setTimeout(r, 300)); continue }
      ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT)

      try {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.6)
        )
        if (blob && activeRef.current) {
          const form = new FormData()
          form.append("file", blob, "frame.jpg")
          const res = await fetch(UPLOAD_URL, { method: "POST", body: form })
          if (res.ok) {
            const data: Stats = await res.json()
            latestStatsRef.current = data
            setStats(data)
            setFramesSent(n => n + 1)
          }
        }
      } catch { /* single-frame failures silently ignored */ }

      if (activeRef.current) {
        await new Promise(r => setTimeout(r, FRAME_INTERVAL_MS))
      }
    }
  }, [UPLOAD_URL])

  const startCapture = useCallback(async () => {
    setCamError("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // ✅ Do NOT call .play() here — autoPlay on the <video> tag handles it.
        // Calling play() manually causes an AbortError when autoPlay is also set.
      }
      setMode("streaming")
      setFramesSent(0)
      activeRef.current = true
      uploadLoop()
      // Start overlay animation loop
      animFrameRef.current = requestAnimationFrame(drawFaceBoxes)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Camera access denied"
      setCamError(msg)
    }
  }, [uploadLoop, drawFaceBoxes])

  const stopCapture = useCallback(() => {
    activeRef.current = false
    cancelAnimationFrame(animFrameRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    // Clear overlay
    const oc = overlayRef.current
    if (oc) {
      const ctx = oc.getContext("2d")
      ctx?.clearRect(0, 0, oc.width, oc.height)
    }
    latestStatsRef.current = null
    setMode("idle")
    setStats({ detected: 0, recognized: [], unknown: 0, timestamp: "--", faces: [], frame_width: CAPTURE_WIDTH, frame_height: CAPTURE_HEIGHT })
    setFramesSent(0)
  }, [])

  useEffect(() => () => stopCapture(), [stopCapture])

  const isStreaming = mode === "streaming"

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-[rgba(33,158,188,0.1)]">
            <Globe className="size-5 text-[#219EBC]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Live Classroom Monitor</h3>
            <p className="text-xs text-muted-foreground">
              {isStreaming ? "AI-powered face recognition active" : "Camera idle — click Start to begin attendance detection"}
            </p>
          </div>
        </div>
        {isStreaming && (
          <span className="flex items-center gap-1.5 rounded-full bg-[rgba(239,68,68,0.1)] px-3 py-1 text-xs font-medium text-[#EF4444]">
            <Radio className="size-3 animate-pulse" />
            LIVE · {framesSent} frames
          </span>
        )}
      </div>

      <div className="p-6">
        {/* ── Video + overlay area ── */}
        <div className="relative flex min-h-[380px] flex-col justify-center rounded-xl bg-muted/40 overflow-hidden">

          {/* Raw webcam — native FPS, never touched by overlay */}
          <video
            ref={videoRef}
            autoPlay playsInline muted
            className={cn("absolute inset-0 w-full h-full object-cover", !isStreaming && "hidden")}
          />

          {/* Face-box overlay canvas — pointer-events:none so clicks pass through */}
          <canvas
            ref={overlayRef}
            className={cn("absolute inset-0 w-full h-full", !isStreaming && "hidden")}
            style={{ pointerEvents: "none" }}
          />

          {/* Hidden capture canvas */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Idle placeholder */}
          {!isStreaming && !camError && (
            <div className="flex flex-col items-center gap-4 text-center py-16">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-[rgba(33,158,188,0.15)] shadow-inner">
                <Camera className="size-8 text-[#219EBC]" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Camera Inactive</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto">
                  Click <strong>Start Camera</strong> to open the local webcam and begin
                  real-time face recognition &amp; attendance tracking.
                </p>
              </div>
            </div>
          )}

          {/* Camera error */}
          {camError && (
            <div className="flex flex-col items-center gap-4 text-center py-16 px-6">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-[rgba(251,133,0,0.15)]">
                <Video className="size-8 text-[#0D1B2A]" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#0D1B2A]">Camera Access Failed</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[300px]">{camError}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Make sure you are on <strong>localhost:3000</strong> and allow camera permissions.
                </p>
              </div>
            </div>
          )}

          {/* Status overlays while streaming */}
          {isStreaming && (
            <>
              {/* Top-left: Live AI Feed label */}
              <div className="absolute top-2 left-2 rounded-md px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm flex items-center gap-1.5 bg-[#219EBC]/80" style={{ zIndex: 20 }}>
                <Globe className="size-3" />
                <span>Live AI Feed</span>
              </div>

              {/* Recognised name chips */}
              {stats.recognized.length > 0 && (
                <div className="absolute bottom-10 left-3 flex flex-wrap gap-1 max-w-xs" style={{ zIndex: 20 }}>
                  {stats.recognized.map((name, i) => (
                    <span key={i} className="rounded bg-[rgba(33,158,188,0.85)] px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      {name}
                    </span>
                  ))}
                </div>
              )}

              {/* Bottom-left: face count */}
              <div className="absolute bottom-3 left-3 flex items-center gap-2" style={{ zIndex: 20 }}>
                <span className="rounded bg-[rgba(0,0,0,0.6)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {stats.detected} face{stats.detected !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Bottom-right: LIVE + timestamp */}
              <div className="absolute bottom-3 right-3 rounded bg-[rgba(0,0,0,0.6)] px-1.5 py-0.5 text-[10px] tabular-nums text-white flex gap-2" style={{ zIndex: 20 }}>
                <span className="text-green-400 font-bold tracking-wider">● LIVE</span>
                {stats.timestamp}
              </div>
            </>
          )}
        </div>

        {/* ── Controls ── */}
        <div className="mt-5 flex items-center justify-between flex-wrap gap-4">
          <button
            onClick={isStreaming ? stopCapture : startCapture}
            className={cn(
              "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-200",
              isStreaming
                ? "bg-[rgba(13,27,42,0.1)] text-[#0D1B2A] hover:bg-[rgba(13,27,42,0.2)]"
                : "bg-[#219EBC] text-white shadow-lg shadow-[#219EBC]/25 hover:bg-[#1A8BA8]"
            )}
          >
            {isStreaming ? (
              <><Square className="size-4" /> Stop Camera</>
            ) : (
              <><Camera className="size-4" /> Start Camera</>
            )}
          </button>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[rgba(33,158,188,0.1)]">
                <Eye className="size-4 text-[#219EBC]" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Detected</p>
                <p className="text-lg font-bold text-foreground leading-none mt-0.5">
                  {isStreaming ? stats.detected : "--"}
                </p>
              </div>
            </div>

            <div className="h-8 w-px bg-border" />

            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[rgba(33,158,188,0.1)]">
                <Globe className="size-4 text-[#219EBC]" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Recognised</p>
                <p className="text-lg font-bold text-foreground leading-none mt-0.5">
                  {isStreaming ? stats.recognized.length : "--"}
                </p>
              </div>
            </div>

            <div className="h-8 w-px bg-border" />

            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[rgba(251,133,0,0.1)]">
                <UserX className="size-4 text-[#0D1B2A]" />
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Unknown</p>
                <p className="text-lg font-bold text-foreground leading-none mt-0.5">
                  {isStreaming ? stats.unknown : "--"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Flow info strip ── */}
        {!isStreaming && !camError && (
          <div className="mt-4 flex items-center justify-center gap-2 text-[10px] text-muted-foreground flex-wrap">
            {["Your Camera", "→", "YOLO Detection", "→", "Face Recognition", "→", "Attendance DB", "→", "Dashboard"].map((s, i) =>
              s === "→" ? (
                <span key={i} className="text-[#219EBC] font-bold">→</span>
              ) : (
                <span key={i} className="rounded bg-muted/60 px-2 py-0.5 font-semibold tracking-wide">{s}</span>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
