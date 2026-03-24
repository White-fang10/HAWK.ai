"use client"
import { useRef, useState, useEffect } from "react"

// ── Types ──────────────────────────────────────────────────────────────────
interface FaceBox {
  bbox: [number, number, number, number]
  conf: number
  name: string
  student_id: number | null
  score: number
}
interface FrameDetail {
  frame_index:    number
  faces_detected: number
  faces:          FaceBox[]
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
}

// ── Helpers ────────────────────────────────────────────────────────────────
/** Draw face boxes + names onto a canvas and return it as a data-URL */
function annotateFrame(
  imageSrc: string,
  faces: FaceBox[],
  videoW: number,
  videoH: number,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas   = document.createElement("canvas")
      canvas.width   = img.width
      canvas.height  = img.height
      const ctx      = canvas.getContext("2d")!
      ctx.drawImage(img, 0, 0)

      const scaleX = img.width  / videoW
      const scaleY = img.height / videoH

      for (const face of faces) {
        const [x1, y1, x2, y2] = face.bbox
        const sx1 = x1 * scaleX, sy1 = y1 * scaleY
        const sw   = (x2 - x1) * scaleX, sh = (y2 - y1) * scaleY

        const known    = face.student_id !== null
        const boxColor = known ? "#27E8A7" : "#FB8500"
        const label    = known ? face.name : "Unknown"

        // box
        ctx.strokeStyle = boxColor
        ctx.lineWidth   = 3
        ctx.strokeRect(sx1, sy1, sw, sh)

        // label background
        const fontSize = Math.max(14, img.width * 0.018)
        ctx.font       = `bold ${fontSize}px Inter, sans-serif`
        const textW    = ctx.measureText(label).width
        ctx.fillStyle  = known ? "rgba(39,232,167,0.85)" : "rgba(251,133,0,0.85)"
        const padX = 8, padY = 4
        ctx.fillRect(sx1 - 1, sy1 - fontSize - padY * 2, textW + padX * 2, fontSize + padY * 2)

        // label text
        ctx.fillStyle = "#000"
        ctx.fillText(label, sx1 + padX - 1, sy1 - padY - 1)

        // confidence score
        if (known) {
          const scoreText = `${(face.score * 100).toFixed(0)}%`
          ctx.font        = `${fontSize * 0.75}px Inter, sans-serif`
          ctx.fillStyle   = "rgba(0,0,0,0.7)"
          ctx.fillRect(sx1 - 1, sy1 + sh, ctx.measureText(scoreText).width + padX * 2, fontSize)
          ctx.fillStyle = "#27E8A7"
          ctx.fillText(scoreText, sx1 + padX - 1, sy1 + sh + fontSize - 4)
        }
      }
      resolve(canvas.toDataURL("image/jpeg", 0.88))
    }
    img.src = imageSrc
  })
}

// ── Component ──────────────────────────────────────────────────────────────
export function BurstCapture({
  onResult,
  token,
}: {
  onResult: (data: AttendanceResult) => void
  token?: string | null
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status,   setStatus]   = useState<"idle" | "capturing" | "processing">("idle")
  const [progress, setProgress] = useState(0)
  const [error,    setError]    = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)

  // annotated frames shown after processing
  const [annotatedFrames, setAnnotatedFrames] = useState<string[]>([])
  const [activeFrame,     setActiveFrame]     = useState(0)
  const [lastResult,      setLastResult]      = useState<AttendanceResult | null>(null)

  // raw blobs captured (for sending to API) + raw data-URLs (for annotation)
  const capturedURLsRef = useRef<string[]>([])
  const capturedDimsRef = useRef<{ w: number; h: number }>({ w: 1280, h: 720 })

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "environment" },
      })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          setCameraReady(true)
        }
      })
      .catch((e) => setError(`Camera error: ${e.message}`))

    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream
        stream.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  async function takeAttendance() {
    if (!videoRef.current || status !== "idle") return
    setStatus("capturing")
    setError(null)
    setAnnotatedFrames([])
    setLastResult(null)
    capturedURLsRef.current = []

    const canvas  = document.createElement("canvas")
    const video   = videoRef.current
    canvas.width  = video.videoWidth  || 1280
    canvas.height = video.videoHeight || 720
    capturedDimsRef.current = { w: canvas.width, h: canvas.height }
    const ctx = canvas.getContext("2d")!

    const blobs: Blob[]  = []
    const rawURLs: string[] = []

    for (let i = 0; i < 5; i++) {
      setProgress(i + 1)
      ctx.drawImage(video, 0, 0)
      // keep raw URL for annotation later
      rawURLs.push(canvas.toDataURL("image/jpeg", 0.92))
      const blob = await new Promise<Blob>((res) =>
        canvas.toBlob((b) => res(b!), "image/jpeg", 0.92)
      )
      blobs.push(blob)
      if (i < 4) await new Promise((r) => setTimeout(r, 400))
    }
    capturedURLsRef.current = rawURLs

    setStatus("processing")
    const formData = new FormData()
    blobs.forEach((b) => formData.append("files", b, "frame.jpg"))

    const authToken = token || localStorage.getItem("hawk_token")
    try {
      const res = await fetch("/api/attendance/burst", {
        method:  "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        body:    formData,
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || `Server error ${res.status}`)
      }
      const data = (await res.json()) as AttendanceResult
      setLastResult(data)
      onResult(data)

      // Annotate each captured frame using the bbox data from the response
      const dims = capturedDimsRef.current
      const annotated = await Promise.all(
        rawURLs.map((url, idx) => {
          const frameDetail = data.frame_details?.[idx]
          return annotateFrame(url, frameDetail?.faces ?? [], dims.w, dims.h)
        })
      )
      setAnnotatedFrames(annotated)
      setActiveFrame(0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setStatus("idle")
      setProgress(0)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%" }}>

      {/* Camera preview */}
      <div style={{
        position: "relative", width: "100%", maxWidth: 860,
        aspectRatio: "16/9", borderRadius: 18, overflow: "hidden",
        border: "1px solid rgba(33,158,188,0.3)", background: "#011520",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <video ref={videoRef} autoPlay muted playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover" }} />

        {/* CAMERA READY badge */}
        {cameraReady && status === "idle" && (
          <div style={{
            position: "absolute", top: 12, left: 12,
            background: "rgba(39,232,167,0.15)", border: "1px solid #27E8A7",
            borderRadius: 999, padding: "4px 12px",
            fontSize: 12, fontWeight: 700, color: "#27E8A7",
            backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#27E8A7", display: "inline-block" }} />
            CAMERA READY
          </div>
        )}

        {/* Capturing overlay */}
        {status === "capturing" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.4)", gap: 12,
          }}>
            <div style={{ fontSize: 48, animation: "pulse 0.8s ease-in-out infinite" }}>📸</div>
            <p style={{ color: "#fff", fontSize: 20, fontWeight: 700, margin: 0 }}>
              Capturing frame {progress} of 5…
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {[1,2,3,4,5].map((n) => (
                <div key={n} style={{
                  width: 12, height: 12, borderRadius: "50%",
                  background: n <= progress ? "#27E8A7" : "rgba(255,255,255,0.3)",
                  transition: "background 0.3s",
                }} />
              ))}
            </div>
          </div>
        )}

        {/* Processing overlay */}
        {status === "processing" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.6)", gap: 16,
          }}>
            <div style={{ fontSize: 52, animation: "spin 1.2s linear infinite" }}>🧠</div>
            <p style={{ color: "#FFB703", fontSize: 18, fontWeight: 700, margin: 0 }}>Processing frames…</p>
            <p style={{ color: "#8B9EC0", fontSize: 13, margin: 0 }}>SCRFD detection + GhostFaceNet recognition</p>
            <p style={{ color: "#5B7FA6", fontSize: 12, margin: 0 }}>This may take 10–40 seconds on CPU</p>
          </div>
        )}

        {/* Model badge */}
        <div style={{
          position: "absolute", top: 12, right: 12,
          background: "rgba(1,21,32,0.75)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(33,158,188,0.35)",
          borderRadius: 8, padding: "4px 10px",
          fontSize: 11, fontWeight: 600, color: "#8B9EC0",
        }}>
          🧠 SCRFD + GhostFaceNet · ONNX
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: "rgba(251,133,0,0.1)", border: "1px solid rgba(251,133,0,0.4)",
          borderRadius: 10, padding: "12px 20px", maxWidth: 860, width: "100%",
          color: "#FB8500", fontSize: 13, fontWeight: 600,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Take Attendance button */}
      {status === "idle" && (
        <button onClick={takeAttendance} disabled={!cameraReady} style={{
          padding: "16px 48px", borderRadius: 14, border: "none",
          cursor: cameraReady ? "pointer" : "not-allowed",
          fontWeight: 800, fontSize: 18,
          background: cameraReady ? "linear-gradient(135deg, #219EBC, #0A7EA4)" : "rgba(255,255,255,0.1)",
          color: "#fff",
          boxShadow: cameraReady ? "0 8px 32px rgba(33,158,188,0.4)" : "none",
          transition: "all 0.2s", opacity: cameraReady ? 1 : 0.5,
        }}>
          📸 Take Attendance
        </button>
      )}

      {/* ── ANNOTATED OUTPUT SECTION ───────────────────────────────────── */}
      {annotatedFrames.length > 0 && (
        <div style={{
          width: "100%", maxWidth: 860,
          background: "rgba(1,21,32,0.8)", border: "1px solid rgba(33,158,188,0.25)",
          borderRadius: 18, padding: "20px 24px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔍</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#E0F0FF" }}>Detection Results</span>
            </div>
            {lastResult && (
              <div style={{
                background: lastResult.total_marked > 0 ? "rgba(39,232,167,0.15)" : "rgba(251,133,0,0.12)",
                border: `1px solid ${lastResult.total_marked > 0 ? "#27E8A7" : "#FB8500"}`,
                borderRadius: 999, padding: "3px 12px",
                fontSize: 12, fontWeight: 700,
                color: lastResult.total_marked > 0 ? "#27E8A7" : "#FB8500",
              }}>
                {lastResult.total_marked > 0
                  ? `✓ ${lastResult.total_marked} student${lastResult.total_marked > 1 ? "s" : ""} marked`
                  : "No students confirmed"}
              </div>
            )}
          </div>

          {/* Main annotated frame viewer */}
          <div style={{
            position: "relative", width: "100%", aspectRatio: "16/9",
            borderRadius: 12, overflow: "hidden", background: "#000",
            border: "1px solid rgba(33,158,188,0.2)",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={annotatedFrames[activeFrame]}
              alt={`Frame ${activeFrame + 1} annotated`}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
            {/* Frame number badge */}
            <div style={{
              position: "absolute", bottom: 10, right: 12,
              background: "rgba(0,0,0,0.7)", borderRadius: 6, padding: "3px 10px",
              fontSize: 12, color: "#8B9EC0", fontWeight: 600,
            }}>
              Frame {activeFrame + 1} / {annotatedFrames.length}
            </div>
          </div>

          {/* Thumbnail strip */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, overflowX: "auto", paddingBottom: 4 }}>
            {annotatedFrames.map((url, idx) => {
              const frameDetail = lastResult?.frame_details?.[idx]
              const faceCount   = frameDetail?.faces_detected ?? 0
              const hasKnown    = frameDetail?.faces?.some(f => f.student_id !== null) ?? false
              return (
                <button
                  key={idx}
                  onClick={() => setActiveFrame(idx)}
                  style={{
                    flex: "0 0 auto", width: 120, borderRadius: 10, padding: 0,
                    border: `2px solid ${activeFrame === idx ? "#219EBC" : "rgba(33,158,188,0.2)"}`,
                    overflow: "hidden", cursor: "pointer", background: "transparent",
                    position: "relative", transition: "border-color 0.2s",
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Frame ${idx + 1}`}
                    style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                  {/* face count badge overlay */}
                  <div style={{
                    position: "absolute", bottom: 4, left: 4,
                    background: faceCount > 0
                      ? (hasKnown ? "rgba(39,232,167,0.9)" : "rgba(251,133,0,0.9)")
                      : "rgba(0,0,0,0.7)",
                    borderRadius: 4, padding: "1px 6px",
                    fontSize: 10, fontWeight: 700,
                    color: faceCount > 0 ? "#000" : "#8B9EC0",
                  }}>
                    {faceCount > 0
                      ? `${faceCount} face${faceCount > 1 ? "s" : ""}`
                      : "no faces"}
                  </div>
                  <div style={{
                    position: "absolute", top: 4, left: 4,
                    background: "rgba(0,0,0,0.65)", borderRadius: 3, padding: "1px 5px",
                    fontSize: 9, color: "#8B9EC0", fontWeight: 600,
                  }}>F{idx + 1}</div>
                </button>
              )
            })}
          </div>

          {/* Per-face details for active frame */}
          {(() => {
            const frameDetail = lastResult?.frame_details?.[activeFrame]
            if (!frameDetail || frameDetail.faces.length === 0) return (
              <div style={{ marginTop: 14, textAlign: "center", color: "#5B7FA6", fontSize: 13 }}>
                No faces detected in this frame
              </div>
            )
            return (
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {frameDetail.faces.map((face, fi) => (
                  <div key={fi} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: face.student_id !== null
                      ? "rgba(39,232,167,0.08)" : "rgba(251,133,0,0.07)",
                    border: `1px solid ${face.student_id !== null ? "rgba(39,232,167,0.3)" : "rgba(251,133,0,0.3)"}`,
                    borderRadius: 10, padding: "8px 14px",
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: face.student_id !== null ? "rgba(39,232,167,0.2)" : "rgba(251,133,0,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18,
                    }}>
                      {face.student_id !== null ? "✅" : "❓"}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#E0F0FF" }}>{face.name}</div>
                      <div style={{ fontSize: 11, color: "#5B7FA6" }}>
                        {face.student_id !== null
                          ? `Score: ${(face.score * 100).toFixed(1)}% · conf: ${(face.conf * 100).toFixed(0)}%`
                          : `Det conf: ${(face.conf * 100).toFixed(0)}%`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
