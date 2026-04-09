"use client"
import { useRef, useState, useEffect, useCallback } from "react"

// ── Tuneable constants ─────────────────────────────────────────────────────
const N_COLUMNS       = 4     // seating columns
const N_ROWS          = 3     // depth rows: front / mid / back
const FRAMES_PER_ZONE = 2     // burst frames per col×row zone
const ZOOM_LEVEL      = 3.0   // optical/digital zoom for zone shots
const FOCUS_DELAY_MS  = 1200  // ms after zoom command before capturing
const INTER_FRAME_MS  = 350   // ms between frames in a zone burst
const WIDE_JPEG_Q     = 0.92  // quality for wide shot
const ZONE_JPEG_Q     = 0.90  // quality for zone shots

// Row Y centre positions (0=top, 1=bottom of frame)
// front = near camera / low seats, back = far / high seats
const ROW_Y_PCTS: Record<string, number> = { front: 0.30, mid: 0.55, back: 0.78 }
const ROW_LABELS = ["front", "mid", "back"] as const
type RowLabel = typeof ROW_LABELS[number]

const TOTAL_ZONES       = N_COLUMNS * N_ROWS          // 12
const TOTAL_ZONE_FRAMES = TOTAL_ZONES * FRAMES_PER_ZONE // 24

// ── Types ──────────────────────────────────────────────────────────────────
interface RawFace     { bbox: [number,number,number,number]; conf: number; face_size: number }
interface WideResult  { faces: RawFace[]; image_width: number; image_height: number }
interface ColumnZone  { col: number; centerXPct: number; faceCount: number }
interface CaptureZone {
  col:         number
  row:         number
  rowLabel:    RowLabel
  centerXPct:  number
  centerYPct:  number
  faceCount:   number
}
interface CameraStatus {
  adb_configured:  boolean
  adb_connected:   boolean
  onvif_available: boolean
  onvif_url:       string
  zoom_method:     "adb" | "onvif" | "software"
  raptor_ip:       string
  current_zoom:    number
}
interface ZoneMeta {
  col:          number
  row:          number
  row_label:    string
  center_x_pct: number
  center_y_pct: number
  zoom_factor:  number
  zoom_method:  string
  is_wide:      boolean
}

interface FaceBox         { bbox: [number,number,number,number]; conf: number; name: string; student_id: number|null; score: number }
interface FrameDetail     { frame_index: number; faces_detected: number; faces: FaceBox[]; zone_col?: number; zone_row?: number; zone_row_label?: string; is_wide?: boolean; zoom_method?: string }
interface ConfirmedStudent { student_id: number; name: string; votes: number; out_of: number }
interface AttendanceResult { confirmed: ConfirmedStudent[]; total_marked: number; frame_details: FrameDetail[]; frames_selected?: number; sharpness_filtered?: number }

// ── 1-D k-means column clustering (X axis) ────────────────────────────────
function clusterColumns(faces: RawFace[], imgW: number, nCols: number): ColumnZone[] {
  if (faces.length === 0)
    return Array.from({ length: nCols }, (_, i) => ({ col: i+1, centerXPct: (i+0.5)/nCols, faceCount: 0 }))
  const xs = faces.map(f => (f.bbox[0] + f.bbox[2]) / 2)
  let centroids = Array.from({ length: nCols }, (_, i) => ((i+0.5)/nCols) * imgW)
  for (let iter = 0; iter < 12; iter++) {
    const buckets: number[][] = Array.from({ length: nCols }, () => [])
    for (const x of xs) {
      let best = 0, bestD = Math.abs(x - centroids[0])
      for (let k = 1; k < nCols; k++) { const d = Math.abs(x - centroids[k]); if (d < bestD) { bestD = d; best = k } }
      buckets[best].push(x)
    }
    centroids = centroids.map((c, k) => buckets[k].length > 0 ? buckets[k].reduce((a,b)=>a+b,0)/buckets[k].length : c)
  }
  const buckets: number[][] = Array.from({ length: nCols }, () => [])
  for (const x of xs) {
    let best = 0, bestD = Math.abs(x - centroids[0])
    for (let k = 1; k < nCols; k++) { const d = Math.abs(x - centroids[k]); if (d < bestD) { bestD = d; best = k } }
    buckets[best].push(x)
  }
  return centroids
    .map((cx, k) => ({ col: k+1, centerXPct: cx/imgW, faceCount: buckets[k].length }))
    .sort((a,b) => a.centerXPct - b.centerXPct)
    .map((z, i) => ({ ...z, col: i+1 }))
}

// ── Derive row Y centres from detected face Y positions ────────────────────
function deriveRowYPcts(faces: RawFace[], imgH: number): Record<RowLabel, number> {
  if (faces.length < N_ROWS) return ROW_Y_PCTS as Record<RowLabel, number>
  const yCentres = faces.map(f => (f.bbox[1] + f.bbox[3]) / 2 / imgH).sort((a,b)=>a-b)
  // Simple thirds split
  const front = yCentres.slice(0, Math.ceil(yCentres.length / 3))
  const mid   = yCentres.slice(Math.ceil(yCentres.length / 3), Math.ceil(2 * yCentres.length / 3))
  const back  = yCentres.slice(Math.ceil(2 * yCentres.length / 3))
  const avg   = (arr: number[]) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0
  return {
    front: avg(front) || ROW_Y_PCTS.front,
    mid:   avg(mid)   || ROW_Y_PCTS.mid,
    back:  avg(back)  || ROW_Y_PCTS.back,
  }
}

// ── Build capture zone grid from wide result ───────────────────────────────
function buildZoneGrid(faces: RawFace[], imgW: number, imgH: number): CaptureZone[] {
  const colZones = clusterColumns(faces, imgW, N_COLUMNS)
  const rowYPcts = deriveRowYPcts(faces, imgH)
  const zones: CaptureZone[] = []
  for (let ri = 0; ri < N_ROWS; ri++) {
    const rowLabel = ROW_LABELS[ri]
    const centerYPct = rowYPcts[rowLabel]
    for (const col of colZones) {
      // Count faces roughly in this zone area
      const xSlice = 1 / N_COLUMNS
      const ySlice = 1 / N_ROWS
      const faceCount = faces.filter(f => {
        const fx = (f.bbox[0] + f.bbox[2]) / 2 / imgW
        const fy = (f.bbox[1] + f.bbox[3]) / 2 / imgH
        return Math.abs(fx - col.centerXPct) < xSlice * 0.6 && Math.abs(fy - centerYPct) < ySlice * 0.6
      }).length
      zones.push({
        col:        col.col,
        row:        ri + 1,
        rowLabel,
        centerXPct: col.centerXPct,
        centerYPct,
        faceCount,
      })
    }
  }
  return zones
}

// ── Software pan+zoom on both X and Y ─────────────────────────────────────
function applySoftwarePanZoom(
  src: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  centerXPct: number,
  centerYPct: number,
  zoom: number,
) {
  const ctx = canvas.getContext("2d")!
  const vw = src.videoWidth || canvas.width
  const vh = src.videoHeight || canvas.height
  if (zoom <= 1.0) { ctx.drawImage(src, 0, 0, canvas.width, canvas.height); return }
  const cw = vw / zoom
  const ch = vh / zoom
  const cx = Math.max(0, Math.min(vw - cw, vw * centerXPct - cw / 2))
  const cy = Math.max(0, Math.min(vh - ch, vh * centerYPct - ch / 2))
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height)
}

// ── Simple browser-side sharpness score (Laplacian approx) ────────────────
function browserSharpness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  try {
    const d = ctx.getImageData(0, 0, w, h).data
    let sum = 0, n = 0
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const i = (y * w + x) * 4
        const center = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]
        const top    = 0.299 * d[((y-1)*w+x)*4] + 0.587 * d[((y-1)*w+x)*4+1] + 0.114 * d[((y-1)*w+x)*4+2]
        const bot    = 0.299 * d[((y+1)*w+x)*4] + 0.587 * d[((y+1)*w+x)*4+1] + 0.114 * d[((y+1)*w+x)*4+2]
        const diff   = Math.abs(2 * center - top - bot)
        sum += diff * diff; n++
      }
    }
    return n > 0 ? sum / n : 0
  } catch { return 0 }
}

// ── Annotation ─────────────────────────────────────────────────────────────
function annotateFrame(src: string, faces: FaceBox[], vw: number, vh: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.width; c.height = img.height
      const ctx = c.getContext("2d")!
      ctx.drawImage(img, 0, 0)
      const sx = img.width/vw, sy = img.height/vh
      for (const face of faces) {
        const [x1,y1,x2,y2] = face.bbox
        const bx = x1*sx, by = y1*sy, bw = (x2-x1)*sx, bh = (y2-y1)*sy
        const known = face.student_id !== null, color = known ? "#27E8A7" : "#FB8500"
        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh)
        const fs = Math.max(14, img.width*0.018)
        ctx.font = `bold ${fs}px Inter, sans-serif`
        const label = known ? face.name : "Unknown"
        const tw = ctx.measureText(label).width
        ctx.fillStyle = known ? "rgba(39,232,167,0.85)" : "rgba(251,133,0,0.85)"
        ctx.fillRect(bx-1, by-fs-8, tw+16, fs+8)
        ctx.fillStyle = "#000"; ctx.fillText(label, bx+7, by-5)
        if (known) {
          const sc = `${(face.score*100).toFixed(0)}%`
          ctx.font = `${fs*0.75}px Inter, sans-serif`
          ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(bx-1, by+bh, ctx.measureText(sc).width+16, fs)
          ctx.fillStyle = "#27E8A7"; ctx.fillText(sc, bx+7, by+bh+fs-4)
        }
      }
      resolve(c.toDataURL("image/jpeg", 0.88))
    }
    img.src = src
  })
}

// ── Badge colours ──────────────────────────────────────────────────────────
const METHOD_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  adb:      { label: "🔭 ADB Optical",   color: "#27E8A7", bg: "rgba(39,232,167,0.12)" },
  onvif:    { label: "📡 ONVIF PTZ",     color: "#60D8FF", bg: "rgba(96,216,255,0.12)" },
  software: { label: "🖥 Software SR",   color: "#FB8500", bg: "rgba(251,133,0,0.12)"  },
}

// ── Component ──────────────────────────────────────────────────────────────
export function BurstCapture({ onResult, token }: { onResult: (d: AttendanceResult) => void; token?: string|null }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  type Status = "idle" | "wide" | "zooming" | "processing"
  const [status,        setStatus]        = useState<Status>("idle")
  const [captureMsg,    setCaptureMsg]    = useState("")
  const [zonesDone,     setZonesDone]     = useState(0)        // zones completed
  const [framesDone,    setFramesDone]    = useState(0)        // individual frames uploaded
  const [error,         setError]         = useState<string|null>(null)
  const [cameraReady,   setCameraReady]   = useState(false)
  const [camStatus,     setCamStatus]     = useState<CameraStatus|null>(null)

  const [wideURL,       setWideURL]       = useState<string|null>(null)
  const [wideResult,    setWideResult]    = useState<WideResult|null>(null)
  const [zones,         setZones]         = useState<CaptureZone[]>([])
  const [activeZone,    setActiveZone]    = useState<CaptureZone|null>(null)

  const [annotatedFrames, setAnnotatedFrames] = useState<string[]>([])
  const [frameMetas,       setFrameMetas]      = useState<ZoneMeta[]>([])
  const [activeFrame,      setActiveFrame]     = useState(0)
  const [lastResult,       setLastResult]      = useState<AttendanceResult|null>(null)

  // IP / connection UI
  const [showIpInput,  setShowIpInput]  = useState(false)
  const [ipInput,      setIpInput]      = useState("")
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectMsg,   setConnectMsg]   = useState<{text:string;ok:boolean}|null>(null)
  const [showProbe,    setShowProbe]    = useState(false)

  const dimsRef = useRef({ w: 1280, h: 720 })

  const authHeaders = (t?: string|null): Record<string,string> => {
    const tok = t || localStorage.getItem("hawk_token")
    return tok ? { Authorization: `Bearer ${tok}` } : {}
  }

  // ── Camera + status on mount ─────────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "environment" } })
      .then(stream => { if (videoRef.current) { videoRef.current.srcObject = stream; setCameraReady(true) } })
      .catch(e => setError(`Camera error: ${e.message}`))

    const tok = token || localStorage.getItem("hawk_token")
    fetch("/api/camera/status", { headers: authHeaders(tok) })
      .then(r => r.ok ? r.json() : null)
      .then((s: CameraStatus | null) => { if (s) { setCamStatus(s); console.log("[HAWK] Camera status:", s) } })
      .catch(() => {})

    return () => {
      if (videoRef.current?.srcObject)
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Hardware zoom helper ─────────────────────────────────────────────────
  async function hwZoom(zoom: number, xPct: number, yPct: number): Promise<string> {
    try {
      const r = await fetch("/api/camera/zoom", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ zoom, center_x_pct: xPct, center_y_pct: yPct }),
      })
      if (!r.ok) return "software"
      const res = await r.json()
      return res.ok ? (res.method ?? "software") : "software"
    } catch { return "software" }
  }
  async function hwReset() {
    try { await fetch("/api/camera/reset-zoom", { method: "POST", headers: authHeaders(token) }) } catch {}
  }

  // ── IP connect ───────────────────────────────────────────────────────────
  async function connectIp(ip: string) {
    const trimmed = ip.trim(); if (!trimmed) return
    setIsConnecting(true); setConnectMsg(null)
    try {
      const res  = await fetch("/api/camera/config", {
        method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ raptor_ip: trimmed }),
      })
      const data = await res.json()
      const ok   = data.connected || data.onvif_available
      setConnectMsg({ text: ok ? `✓ Connected (${data.onvif_available ? "ONVIF" : "ADB"}) — ${trimmed}` : `✗ ${data.message}`, ok })
      if (ok) {
        setCamStatus(prev => prev ? {
          ...prev,
          adb_connected:   data.connected,
          onvif_available: data.onvif_available ?? false,
          zoom_method:     data.connected ? "adb" : data.onvif_available ? "onvif" : "software",
          raptor_ip:       trimmed,
        } : null)
        setTimeout(() => setShowIpInput(false), 1800)
      }
    } catch { setConnectMsg({ text: "✗ Could not reach backend", ok: false }) }
    finally { setIsConnecting(false) }
  }

  // ── ONVIF probe only ─────────────────────────────────────────────────────
  async function probeOnvif(ip: string) {
    setIsConnecting(true); setConnectMsg(null)
    try {
      const res  = await fetch("/api/camera/probe", {
        method: "POST", headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      })
      const data = await res.json()
      setConnectMsg({ text: data.available ? `✓ ONVIF found: ${data.url}` : "✗ ONVIF not found on this IP", ok: data.available })
      if (data.available) {
        setCamStatus(prev => prev ? { ...prev, onvif_available: true, onvif_url: data.url, zoom_method: prev.adb_connected ? "adb" : "onvif" } : null)
      }
    } catch { setConnectMsg({ text: "✗ Probe failed", ok: false }) }
    finally { setIsConnecting(false) }
  }

  // ── Main capture flow ─────────────────────────────────────────────────────
  const takeAttendance = useCallback(async () => {
    if (!videoRef.current || status !== "idle") return
    setError(null); setAnnotatedFrames([]); setFrameMetas([]); setLastResult(null)
    setWideURL(null); setWideResult(null); setZones([]); setZonesDone(0); setFramesDone(0); setActiveZone(null)

    const video  = videoRef.current
    const canvas = document.createElement("canvas")
    canvas.width  = video.videoWidth  || 1280
    canvas.height = video.videoHeight || 720
    dimsRef.current = { w: canvas.width, h: canvas.height }
    const ctx = canvas.getContext("2d")!

    const zoomMethod = camStatus?.zoom_method ?? "software"

    // ── Step 1: Wide shot — analyse face positions ──────────────────────
    setStatus("wide"); setCaptureMsg("📡 Wide shot — analysing classroom…")
    ctx.drawImage(video, 0, 0)
    const wideDataURL = canvas.toDataURL("image/jpeg", WIDE_JPEG_Q)
    setWideURL(wideDataURL)
    const wideBlob = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), "image/jpeg", WIDE_JPEG_Q))

    let captureZones: CaptureZone[] = []
    let wide: WideResult | null = null
    try {
      const fd = new FormData(); fd.append("file", wideBlob, "wide.jpg")
      const wr = await fetch("/api/attendance/detect-wide", { method: "POST", headers: authHeaders(token), body: fd })
      if (!wr.ok) throw new Error()
      wide = await wr.json() as WideResult
      setWideResult(wide)
      captureZones = buildZoneGrid(wide.faces, wide.image_width, wide.image_height)
    } catch {
      captureZones = buildZoneGrid([], canvas.width, canvas.height)
    }
    setZones(captureZones)
    await new Promise(r => setTimeout(r, 600))

    // ── Step 2: Col × Row grid sweep ────────────────────────────────────
    setStatus("zooming")
    const blobs: Blob[]    = []
    const rawURLs: string[]= []
    const metaArr: ZoneMeta[] = []

    // Add wide shot as first entry (for pipeline to process)
    blobs.push(wideBlob)
    rawURLs.push(wideDataURL)
    metaArr.push({
      col: 1, row: 1, row_label: "wide",
      center_x_pct: 0.5, center_y_pct: 0.5,
      zoom_factor: 1.0, zoom_method: zoomMethod, is_wide: true,
    })

    let totalFrameCount = 1  // counting wide shot

    // Sweep: row-major order (front→mid→back, all columns per row)
    for (let ri = 0; ri < N_ROWS; ri++) {
      const rowLabel = ROW_LABELS[ri]
      const rowZones = captureZones.filter(z => z.rowLabel === rowLabel)

      for (const zone of rowZones) {
        setActiveZone(zone)
        const zoomToApply = zone.faceCount === 0 ? 1.5 : ZOOM_LEVEL

        // Request hardware zoom (ADB or ONVIF); returns effective method
        const effectiveMethod = (camStatus?.adb_connected || camStatus?.onvif_available)
          ? await hwZoom(zoomToApply, zone.centerXPct, zone.centerYPct)
          : "software"

        setCaptureMsg(`🎯 [${rowLabel.toUpperCase()} · Col ${zone.col}] — focusing…`)
        await new Promise(r => setTimeout(r, FOCUS_DELAY_MS))

        // Capture FRAMES_PER_ZONE frames for this zone
        const zoneBlobs: { blob: Blob; url: string; sharpness: number }[] = []
        for (let f = 0; f < FRAMES_PER_ZONE + 1; f++) {   // +1 extra for sharpness selection
          setCaptureMsg(`📸 ${rowLabel} · Col ${zone.col} — frame ${Math.min(f+1, FRAMES_PER_ZONE)}/${FRAMES_PER_ZONE}`)

          if (effectiveMethod === "software") {
            applySoftwarePanZoom(video, canvas, zone.centerXPct, zone.centerYPct, zoomToApply)
          } else {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          }

          // Browser sharpness pre-filter
          const sharp = browserSharpness(ctx, canvas.width, canvas.height)
          const url   = canvas.toDataURL("image/jpeg", ZONE_JPEG_Q)
          const blob  = await new Promise<Blob>(res => canvas.toBlob(b => res(b!), "image/jpeg", ZONE_JPEG_Q))
          zoneBlobs.push({ blob, url, sharpness: sharp })
          if (f < FRAMES_PER_ZONE) await new Promise(r => setTimeout(r, INTER_FRAME_MS))
        }

        // Keep top-N sharpest frames from this zone capture
        zoneBlobs.sort((a, b) => b.sharpness - a.sharpness)
        const selected = zoneBlobs.slice(0, FRAMES_PER_ZONE)

        for (const s of selected) {
          blobs.push(s.blob)
          rawURLs.push(s.url)
          metaArr.push({
            col:          zone.col,
            row:          zone.row,
            row_label:    zone.rowLabel,
            center_x_pct: zone.centerXPct,
            center_y_pct: zone.centerYPct,
            zoom_factor:  zoomToApply,
            zoom_method:  effectiveMethod,
            is_wide:      false,
          })
          totalFrameCount++
          setFramesDone(totalFrameCount)
        }

        setZonesDone(prev => prev + 1)
      }
    }

    await hwReset()
    setActiveZone(null)

    // ── Step 3: Recognition burst ────────────────────────────────────────
    setStatus("processing"); setCaptureMsg("")
    const formData = new FormData()
    blobs.forEach(b => formData.append("files", b, "frame.jpg"))
    formData.append("zone_metadata", JSON.stringify(metaArr))

    try {
      const res  = await fetch("/api/attendance/burst", { method: "POST", headers: authHeaders(token), body: formData })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || `Server error ${res.status}`) }
      const data = await res.json() as AttendanceResult
      setLastResult(data); onResult(data)
      const dims     = dimsRef.current
      const annotated = await Promise.all(
        rawURLs.map((url, idx) => annotateFrame(url, data.frame_details?.[idx]?.faces ?? [], dims.w, dims.h))
      )
      setAnnotatedFrames(annotated); setFrameMetas(metaArr); setActiveFrame(0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setStatus("idle"); setZonesDone(0); setFramesDone(0); setCaptureMsg("")
    }
  }, [status, camStatus, token, onResult])

  // ── Derived UI values ─────────────────────────────────────────────────────
  const zm          = camStatus?.zoom_method ?? "software"
  const zmStyle     = METHOD_STYLE[zm] ?? METHOD_STYLE.software
  const isCapturing = status === "wide" || status === "zooming"
  const zoneProgress = zonesDone / TOTAL_ZONES  // 0–1

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, width: "100%" }}>

      {/* ── Camera preview ──────────────────────────────────────────────────── */}
      <div style={{
        position: "relative", width: "100%", maxWidth: 860, aspectRatio: "16/9",
        borderRadius: 18, overflow: "hidden", border: "1px solid rgba(33,158,188,0.3)",
        background: "#011520", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />

        {/* Zone grid lines — idle state */}
        {status === "idle" && zones.length > 0 && (() => {
          // Unique column X positions
          const cols = [...new Map(zones.map(z => [z.col, z.centerXPct])).entries()]
          const rows = [...new Map(zones.map(z => [z.row, z.centerYPct])).entries()]
          return <>
            {cols.map(([col, xPct]) => (
              <div key={`c${col}`} style={{
                position: "absolute", top: 0, bottom: 0,
                left: `${xPct * 100}%`, width: 1,
                background: "rgba(33,158,188,0.25)", transform: "translateX(-50%)", pointerEvents: "none",
              }} />
            ))}
            {rows.map(([row, yPct]) => (
              <div key={`r${row}`} style={{
                position: "absolute", left: 0, right: 0,
                top: `${yPct * 100}%`, height: 1,
                background: "rgba(33,158,188,0.18)", transform: "translateY(-50%)", pointerEvents: "none",
              }} />
            ))}
          </>
        })()}

        {/* Active zone highlight while capturing */}
        {isCapturing && activeZone && (
          <div style={{
            position: "absolute",
            left:   `${Math.max(0, activeZone.centerXPct - 0.5/N_COLUMNS) * 100}%`,
            top:    `${Math.max(0, activeZone.centerYPct - 0.5/N_ROWS) * 100}%`,
            width:  `${(1/N_COLUMNS) * 100}%`,
            height: `${(1/N_ROWS) * 100}%`,
            border: "2px solid rgba(39,232,167,0.7)",
            borderRadius: 6,
            boxShadow: "0 0 20px rgba(39,232,167,0.3)",
            pointerEvents: "none",
            transition: "all 0.3s ease",
          }} />
        )}

        {/* CAMERA READY badge */}
        {cameraReady && status === "idle" && (
          <div style={{
            position: "absolute", top: 12, left: 12, background: "rgba(39,232,167,0.15)",
            border: "1px solid #27E8A7", borderRadius: 999, padding: "4px 12px",
            fontSize: 12, fontWeight: 700, color: "#27E8A7",
            backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#27E8A7", display: "inline-block" }} />
            CAMERA READY · {N_COLUMNS}×{N_ROWS} GRID
          </div>
        )}

        {/* Zoom method badge + IP config */}
        {camStatus && status === "idle" && (
          <div style={{ position: "absolute", top: 44, left: 12, maxWidth: "calc(100% - 24px)" }}>
            {!showIpInput ? (
              <button
                onClick={() => { setShowIpInput(true); setConnectMsg(null) }}
                title="Click to configure smartboard IP"
                style={{
                  background: zmStyle.bg, border: `1px solid ${zmStyle.color}60`,
                  borderRadius: 999, padding: "4px 12px",
                  fontSize: 11, fontWeight: 600, color: zmStyle.color,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                  backdropFilter: "blur(8px)", transition: "all 0.2s",
                }}
              >
                {zmStyle.label}{camStatus.raptor_ip ? ` (${camStatus.raptor_ip})` : " — no IP set"}
                <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 2 }}>✏️</span>
              </button>
            ) : (
              <div style={{
                background: "rgba(1,13,24,0.92)", border: "1px solid rgba(39,232,167,0.35)",
                borderRadius: 14, padding: "12px 14px", backdropFilter: "blur(12px)",
                display: "flex", flexDirection: "column", gap: 8,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)", minWidth: 300,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#8B9EC0", fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>📡 SMARTBOARD IP</span>
                  <button onClick={() => { setShowIpInput(false); setConnectMsg(null) }}
                    style={{ background: "none", border: "none", color: "#5B7FA6", fontSize: 14, cursor: "pointer" }}>✕</button>
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    autoFocus type="text" placeholder="e.g. 10.94.223.110"
                    value={ipInput} onChange={e => setIpInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !isConnecting && connectIp(ipInput)}
                    style={{
                      flex: 1, background: "rgba(255,255,255,0.07)",
                      border: "1px solid rgba(39,232,167,0.3)", borderRadius: 8,
                      padding: "7px 10px", color: "#fff", fontSize: 14,
                      fontFamily: "monospace", fontWeight: 700, outline: "none",
                    }}
                  />
                  <button onClick={() => connectIp(ipInput)} disabled={isConnecting || !ipInput.trim()}
                    style={{
                      background: isConnecting || !ipInput.trim() ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg, #04C97B, #27E8A7)",
                      color: isConnecting || !ipInput.trim() ? "#5B7FA6" : "#010D18",
                      border: "none", borderRadius: 8, padding: "7px 14px",
                      fontWeight: 800, fontSize: 13, cursor: isConnecting || !ipInput.trim() ? "not-allowed" : "pointer",
                    }}>
                    {isConnecting ? "…" : "Connect"}
                  </button>
                </div>

                {/* ONVIF probe button */}
                <button
                  onClick={() => ipInput.trim() && probeOnvif(ipInput.trim())}
                  disabled={isConnecting || !ipInput.trim()}
                  style={{
                    background: "rgba(96,216,255,0.08)", border: "1px solid rgba(96,216,255,0.3)",
                    borderRadius: 8, padding: "5px 10px", color: "#60D8FF",
                    fontSize: 11, fontWeight: 700, cursor: isConnecting || !ipInput.trim() ? "not-allowed" : "pointer",
                    opacity: isConnecting || !ipInput.trim() ? 0.5 : 1,
                  }}>
                  📡 Probe ONVIF only
                </button>

                {connectMsg && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: connectMsg.ok ? "#27E8A7" : "#FB8500" }}>
                    {connectMsg.text}
                  </div>
                )}

                {camStatus.raptor_ip && (
                  <div style={{ fontSize: 10, color: "#5B7FA6", fontFamily: "monospace" }}>
                    current: {camStatus.raptor_ip} · ADB: {camStatus.adb_connected ? "✓" : "✗"} · ONVIF: {camStatus.onvif_available ? "✓" : "✗"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Capturing overlay */}
        {isCapturing && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.55)", gap: 12,
          }}>
            <div style={{ fontSize: 40, animation: "pulse 0.8s ease-in-out infinite" }}>
              {status === "wide" ? "📡" : "📸"}
            </div>
            <p style={{ color: "#fff", fontSize: 16, fontWeight: 700, margin: 0, textAlign: "center", padding: "0 24px" }}>
              {captureMsg}
            </p>

            {/* Col×Row grid progress matrix */}
            {status === "zooming" && zones.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center" }}>
                {ROW_LABELS.map(rl => (
                  <div key={rl} style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "#5B7FA6", width: 36, textAlign: "right", fontWeight: 700 }}>{rl}</span>
                    {zones.filter(z => z.rowLabel === rl).map(z => {
                      const zIdx = zones.indexOf(z)
                      const isDone = zonesDone > zIdx
                      const isActive = activeZone?.col === z.col && activeZone?.rowLabel === z.rowLabel
                      return (
                        <div key={`${z.col}-${z.rowLabel}`} style={{
                          width: 52, height: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                          border: `1px solid ${isActive ? "#27E8A7" : isDone ? "#219EBC" : "rgba(33,158,188,0.3)"}`,
                          background: isActive ? "rgba(39,232,167,0.2)" : isDone ? "#219EBC" : "rgba(255,255,255,0.04)",
                          fontSize: 10, fontWeight: 700,
                          color: isActive ? "#27E8A7" : isDone ? "#fff" : "#5B7FA6",
                          transition: "all 0.25s",
                          boxShadow: isActive ? "0 0 12px rgba(39,232,167,0.4)" : "none",
                        }}>
                          C{z.col}{z.faceCount > 0 && <span style={{ opacity: 0.7, fontSize: 8 }}> {z.faceCount}👤</span>}
                        </div>
                      )
                    })}
                  </div>
                ))}
                {/* Frame dots */}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", maxWidth: 280, marginTop: 4 }}>
                  {Array.from({ length: TOTAL_ZONE_FRAMES }).map((_, n) => (
                    <div key={n} style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: n < framesDone - 1 ? "#27E8A7" : "rgba(255,255,255,0.2)",
                      transition: "background 0.3s",
                    }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Processing overlay */}
        {status === "processing" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.65)", gap: 16,
          }}>
            <div style={{ fontSize: 52, animation: "spin 1.2s linear infinite" }}>🧠</div>
            <p style={{ color: "#FFB703", fontSize: 18, fontWeight: 700, margin: 0 }}>
              Processing {N_COLUMNS}×{N_ROWS} grid…
            </p>
            <p style={{ color: "#8B9EC0", fontSize: 13, margin: 0 }}>SCRFD · GhostFaceNet · Sharpness filter</p>
            <p style={{ color: "#5B7FA6", fontSize: 12, margin: 0 }}>
              {N_COLUMNS} cols · {N_ROWS} rows · {TOTAL_ZONE_FRAMES} zone frames
            </p>
          </div>
        )}

        {/* Model+mode badge */}
        <div style={{
          position: "absolute", top: 12, right: 12, background: "rgba(1,21,32,0.75)",
          backdropFilter: "blur(8px)", border: "1px solid rgba(33,158,188,0.35)",
          borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#8B9EC0",
        }}>
          🧠 SCRFD + GhostFaceNet · {zmStyle.label}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: "rgba(251,133,0,0.1)", border: "1px solid rgba(251,133,0,0.4)",
          borderRadius: 10, padding: "12px 20px", maxWidth: 860, width: "100%",
          color: "#FB8500", fontSize: 13, fontWeight: 600,
        }}>⚠ {error}</div>
      )}

      {/* Wide-shot analysis panel */}
      {wideURL && zones.length > 0 && (
        <div style={{
          width: "100%", maxWidth: 860, background: "rgba(1,21,32,0.75)",
          border: "1px solid rgba(33,158,188,0.2)", borderRadius: 16, padding: "16px 20px",
          display: "flex", gap: 16, alignItems: "flex-start", boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}>
          <div style={{ position: "relative", flex: "0 0 auto" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={wideURL} alt="Wide shot" style={{ width: 160, aspectRatio: "16/9", objectFit: "cover", borderRadius: 10, display: "block" }} />
            {wideResult && (
              <div style={{
                position: "absolute", bottom: 4, left: 4,
                background: "rgba(39,232,167,0.9)", borderRadius: 4, padding: "1px 7px",
                fontSize: 10, fontWeight: 800, color: "#000",
              }}>{wideResult.faces.length} face{wideResult.faces.length !== 1 ? "s" : ""}</div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#8B9EC0", marginBottom: 10 }}>
              📊 WIDE-SHOT ANALYSIS — {N_COLUMNS}×{N_ROWS} capture grid
            </div>
            {/* Row-grouped zone cards */}
            {ROW_LABELS.map(rl => (
              <div key={rl} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#5B7FA6", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {rl === "front" ? "🪑 Front" : rl === "mid" ? "🪑 Mid" : "🪑 Back"} row
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {zones.filter(z => z.rowLabel === rl).map(z => (
                    <div key={`${z.col}-${rl}`} style={{
                      flex: "1 1 0",
                      background: z.faceCount > 0 ? "rgba(33,158,188,0.1)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${z.faceCount > 0 ? "rgba(33,158,188,0.4)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 8, padding: "7px 10px",
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "#E0F0FF" }}>C{z.col}</div>
                      <div style={{ fontSize: 10, color: z.faceCount > 0 ? "#27E8A7" : "#5B7FA6", fontWeight: 600 }}>
                        {z.faceCount > 0 ? `${z.faceCount}👤` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Take Attendance button */}
      {status === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <button onClick={takeAttendance} disabled={!cameraReady} style={{
            padding: "16px 48px", borderRadius: 14, border: "none",
            cursor: cameraReady ? "pointer" : "not-allowed", fontWeight: 800, fontSize: 18,
            background: cameraReady ? "linear-gradient(135deg, #219EBC, #0A7EA4)" : "rgba(255,255,255,0.1)",
            color: "#fff", boxShadow: cameraReady ? "0 8px 32px rgba(33,158,188,0.4)" : "none",
            transition: "all 0.2s", opacity: cameraReady ? 1 : 0.5,
          }}>📸 Take Attendance</button>
          <p style={{ margin: 0, fontSize: 12, color: "#5B7FA6" }}>
            Wide + {N_COLUMNS}×{N_ROWS} grid → {TOTAL_ZONE_FRAMES} zone frames · {zmStyle.label}
          </p>
        </div>
      )}

      {/* Annotated results */}
      {annotatedFrames.length > 0 && (
        <div style={{
          width: "100%", maxWidth: 860, background: "rgba(1,21,32,0.8)",
          border: "1px solid rgba(33,158,188,0.25)", borderRadius: 18, padding: "20px 24px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔍</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: "#E0F0FF" }}>Detection Results</span>
              <span style={{
                fontSize: 11, color: "#5B7FA6", fontWeight: 600,
                background: "rgba(33,158,188,0.1)", border: "1px solid rgba(33,158,188,0.2)",
                borderRadius: 6, padding: "2px 8px",
              }}>
                {N_COLUMNS}×{N_ROWS} · {annotatedFrames.length} frames
                {lastResult?.sharpness_filtered ? ` · ✂ ${lastResult.sharpness_filtered} low-sharp filtered` : ""}
              </span>
            </div>
            {lastResult && (
              <div style={{
                background: lastResult.total_marked > 0 ? "rgba(39,232,167,0.15)" : "rgba(251,133,0,0.12)",
                border: `1px solid ${lastResult.total_marked > 0 ? "#27E8A7" : "#FB8500"}`,
                borderRadius: 999, padding: "3px 12px", fontSize: 12, fontWeight: 700,
                color: lastResult.total_marked > 0 ? "#27E8A7" : "#FB8500",
              }}>
                {lastResult.total_marked > 0 ? `✓ ${lastResult.total_marked} student${lastResult.total_marked > 1 ? "s" : ""} marked` : "No students confirmed"}
              </div>
            )}
          </div>

          {/* Main frame viewer */}
          <div style={{
            position: "relative", width: "100%", aspectRatio: "16/9",
            borderRadius: 12, overflow: "hidden", background: "#000",
            border: "1px solid rgba(33,158,188,0.25)",
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={annotatedFrames[activeFrame]} alt={`Frame ${activeFrame+1}`}
              style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            {/* Zone label overlay */}
            {frameMetas[activeFrame] && (
              <div style={{
                position: "absolute", top: 10, left: 10,
                background: frameMetas[activeFrame].is_wide ? "rgba(33,158,188,0.85)" : "rgba(39,232,167,0.85)",
                borderRadius: 6, padding: "3px 10px", fontSize: 12, color: "#000", fontWeight: 800,
              }}>
                {frameMetas[activeFrame].is_wide
                  ? "🌐 Wide Shot"
                  : `${frameMetas[activeFrame].row_label.toUpperCase()} · Col ${frameMetas[activeFrame].col} · ${frameMetas[activeFrame].zoom_factor.toFixed(1)}×`
                }
              </div>
            )}
            <div style={{
              position: "absolute", bottom: 10, right: 12,
              background: "rgba(0,0,0,0.7)", borderRadius: 6, padding: "3px 10px",
              fontSize: 12, color: "#8B9EC0", fontWeight: 600,
            }}>Frame {activeFrame+1} / {annotatedFrames.length}</div>
          </div>

          {/* Thumbnail strip */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, overflowX: "auto", paddingBottom: 4 }}>
            {annotatedFrames.map((url, idx) => {
              const fd   = lastResult?.frame_details?.[idx]
              const fc   = fd?.faces_detected ?? 0
              const hk   = fd?.faces?.some(f => f.student_id !== null) ?? false
              const meta = frameMetas[idx]
              return (
                <button key={idx} onClick={() => setActiveFrame(idx)} style={{
                  flex: "0 0 auto", width: 110, borderRadius: 10, padding: 0,
                  border: `2px solid ${activeFrame === idx ? "#219EBC" : "rgba(33,158,188,0.2)"}`,
                  overflow: "hidden", cursor: "pointer", background: "transparent",
                  position: "relative", transition: "border-color 0.2s",
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`F${idx+1}`} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
                  {/* Zone chip */}
                  <div style={{
                    position: "absolute", top: 3, left: 3,
                    background: meta?.is_wide ? "rgba(33,158,188,0.9)" : "rgba(39,232,167,0.9)",
                    borderRadius: 3, padding: "1px 5px", fontSize: 8, color: "#000", fontWeight: 800,
                  }}>
                    {meta?.is_wide ? "WIDE" : `${meta?.row_label?.[0]?.toUpperCase()}·C${meta?.col}`}
                  </div>
                  {/* Face count chip */}
                  <div style={{
                    position: "absolute", bottom: 3, left: 3,
                    background: fc > 0 ? (hk ? "rgba(39,232,167,0.9)" : "rgba(251,133,0,0.9)") : "rgba(0,0,0,0.7)",
                    borderRadius: 3, padding: "1px 5px", fontSize: 9, fontWeight: 700,
                    color: fc > 0 ? "#000" : "#8B9EC0",
                  }}>{fc > 0 ? `${fc}😊` : "—"}</div>
                </button>
              )
            })}
          </div>

          {/* Per-face chips for active frame */}
          {(() => {
            const fd = lastResult?.frame_details?.[activeFrame]
            if (!fd || fd.faces.length === 0) return (
              <div style={{ marginTop: 14, textAlign: "center", color: "#5B7FA6", fontSize: 13 }}>No faces detected in this frame</div>
            )
            return (
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {fd.faces.map((face, fi) => (
                  <div key={fi} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: face.student_id !== null ? "rgba(39,232,167,0.08)" : "rgba(251,133,0,0.07)",
                    border: `1px solid ${face.student_id !== null ? "rgba(39,232,167,0.3)" : "rgba(251,133,0,0.3)"}`,
                    borderRadius: 10, padding: "8px 14px",
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: face.student_id !== null ? "rgba(39,232,167,0.2)" : "rgba(251,133,0,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
                    }}>{face.student_id !== null ? "✅" : "❓"}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#E0F0FF" }}>{face.name}</div>
                      <div style={{ fontSize: 11, color: "#5B7FA6" }}>
                        {face.student_id !== null
                          ? `Score: ${(face.score*100).toFixed(1)}% · conf: ${(face.conf*100).toFixed(0)}%`
                          : `Det conf: ${(face.conf*100).toFixed(0)}%`}
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
