"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Search, Filter, Plus, Eye, Pencil, Trash2, Camera, RotateCcw, Upload, CheckCircle, X, ChevronDown } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { getStudents, createStudent, trainStudentFace, deleteStudent, updateStudent, Student, getAuthHeaders } from "@/lib/api"

// ─────────────────────────────────────────────
// WebcamCapture — fixed version
// Key fixes:
//   1. Uses streamRef instead of useState for stream (fixes camera not restarting)
//   2. Forces 640x480 capture (matches what detector was tested on)
//   3. Waits for video loadeddata before enabling capture button
//   4. Checks frame brightness to reject black frames
// ─────────────────────────────────────────────
function WebcamCapture({ onCapture }: { onCapture: (files: File[]) => void }) {
  const [captureMode, setCaptureMode] = useState<"camera" | "upload">("camera")
  const [error, setError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [capturedFiles, setCapturedFiles] = useState<File[]>([])
  const [capturedPreviews, setCapturedPreviews] = useState<string[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)  // ref not state — avoids stale closures

  const MAX_PHOTOS = 8    // more photos = more template coverage
  // No fixed resolution — use whatever resolution the camera provides natively.
  // Full-res images are passed to the backend where SCRFD processes them at 1280×1280.
  const POSE_HINTS = [
    "Look straight at the camera",
    "Turn slightly to the LEFT",
    "Turn slightly to the RIGHT",
    "Tilt your head slightly UP",
    "Look straight again (different distance)",
    "Move a little closer to the camera",
    "Turn slightly to the LEFT again",
    "Look straight — final shot",
  ]

  // ── Start camera ──────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setError(null)
    setCameraReady(false)
    try {
      // Request the highest resolution the camera supports.
      // Do NOT cap width/height — let the browser and hardware negotiate the best.
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      streamRef.current = s
      if (videoRef.current) {
        videoRef.current.srcObject = s
      }
      // Wait for video to have actual frames before enabling capture
      await new Promise<void>((resolve) => {
        const v = videoRef.current
        if (!v) { resolve(); return }
        if (v.readyState >= 3) { resolve(); return }
        v.addEventListener("loadeddata", () => resolve(), { once: true })
        setTimeout(resolve, 3000)  // 3s fallback
      })
      setCameraReady(true)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Camera error"
      setError(`Cannot access camera: ${msg}. Allow permissions and retry.`)
    }
  }, [])

  // ── Stop camera ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraReady(false)
  }, [])

  // Auto-start when in camera mode, cleanup on unmount or mode switch
  useEffect(() => {
    if (captureMode === "camera") startCamera()
    return () => stopCamera()
  }, [captureMode, startCamera, stopCamera])

  // ── Capture one photo ─────────────────────────────────────────────────────
  const capturePhoto = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !streamRef.current) return
    if (capturedFiles.length >= MAX_PHOTOS) return
    if (!video.videoWidth || !video.videoHeight) {
      setError("Camera not ready. Wait a moment and try again.")
      return
    }

    setIsCapturing(true)

    // Use the native camera resolution — do NOT downscale.
    // The backend SCRFD detector processes images at 1280×1280 internally.
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) { setIsCapturing(false); return }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    // Reject very dark frames
    const sw = Math.floor(canvas.width / 2)
    const sh = Math.floor(canvas.height / 2)
    const sample = ctx.getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 4), sw, sh)
    let brightness = 0
    for (let i = 0; i < sample.data.length; i += 4) {
      brightness += (sample.data[i] + sample.data[i + 1] + sample.data[i + 2]) / 3
    }
    const avgBrightness = brightness / (sample.data.length / 4)
    if (avgBrightness < 15) {
      setIsCapturing(false)
      setError("Frame is too dark. Make sure you are well lit and try again.")
      return
    }

    canvas.toBlob((blob) => {
      if (!blob) { setIsCapturing(false); setError("Capture failed. Try again."); return }
      const n = capturedFiles.length + 1
      const file = new File([blob], `capture_${n}.jpg`, { type: "image/jpeg" })
      const url = URL.createObjectURL(blob)
      // Compute next array first, then setState and notify parent separately
      // (calling onCapture inside a setState updater is illegal — causes
      //  "setState during render" error in React strict mode)
      const nextFiles = [...capturedFiles, file]
      setCapturedFiles(nextFiles)
      setCapturedPreviews(prev => [...prev, url])
      onCapture(nextFiles)
      setIsCapturing(false)
    }, "image/jpeg", 0.95)  // high quality — backend quality filter will also check sharpness
  }, [capturedFiles, onCapture])

  // ── Remove one photo ──────────────────────────────────────────────────────
  const removePhoto = useCallback((idx: number) => {
    const nextFiles = capturedFiles.filter((_, i) => i !== idx)
    setCapturedFiles(nextFiles)
    onCapture(nextFiles)
    setCapturedPreviews(prev => {
      URL.revokeObjectURL(prev[idx])
      return prev.filter((_, i) => i !== idx)
    })
  }, [capturedFiles, onCapture])

  // ── Reset all ─────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    capturedPreviews.forEach(u => URL.revokeObjectURL(u))
    setCapturedFiles([])
    setCapturedPreviews([])
    onCapture([])
    if (captureMode === "camera" && !streamRef.current) startCamera()
  }, [capturedPreviews, captureMode, startCamera, onCapture])

  // ── Switch mode ───────────────────────────────────────────────────────────
  const switchMode = useCallback((mode: "camera" | "upload") => {
    if (mode === captureMode) return
    capturedPreviews.forEach(u => URL.revokeObjectURL(u))
    setCapturedFiles([])
    setCapturedPreviews([])
    onCapture([])
    setCaptureMode(mode)
    setError(null)
  }, [captureMode, capturedPreviews, onCapture])

  const photoCount = capturedFiles.length
  const canCapture = cameraReady && photoCount < MAX_PHOTOS

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
        <button type="button" onClick={() => switchMode("camera")}
          className={cn("flex flex-1 items-center justify-center gap-1.5 py-2 transition-colors",
            captureMode === "camera" ? "bg-[#219EBC] text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted")}>
          <Camera className="size-3.5" /> Live Capture
        </button>
        <button type="button" onClick={() => switchMode("upload")}
          className={cn("flex flex-1 items-center justify-center gap-1.5 py-2 transition-colors",
            captureMode === "upload" ? "bg-[#219EBC] text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted")}>
          <Upload className="size-3.5" /> Upload Photos
        </button>
      </div>

      {captureMode === "camera" ? (
        <div className="space-y-2">
          <canvas ref={canvasRef} className="hidden" />

          {/* Live viewfinder */}
          <div className="relative overflow-hidden rounded-xl bg-[#023047] aspect-video flex items-center justify-center">
            <video ref={videoRef} autoPlay playsInline muted
              className="w-full h-full object-cover rounded-xl" />

            {!cameraReady && !error && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#023047]/90 rounded-xl">
                <p className="text-xs text-[#8ECAE6] px-4 text-center">Opening camera…</p>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#023047]/90 rounded-xl px-4">
                <p className="text-xs text-red-400 text-center">{error}</p>
                <button type="button" onClick={startCamera}
                  className="rounded-lg bg-[#219EBC] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1A8BA8]">
                  Retry Camera
                </button>
              </div>
            )}

            {photoCount > 0 && (
              <div className={cn(
                "absolute top-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white",
                photoCount >= 3 ? "bg-green-500/90" : "bg-yellow-500/90"
              )}>
                <CheckCircle className="size-3" />
                {photoCount}/{MAX_PHOTOS} photos
              </div>
            )}

            {cameraReady && (
              <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-green-500/80 px-2 py-0.5 text-[10px] font-bold text-white">
                <span className="size-1.5 rounded-full bg-white inline-block" />
                LIVE
              </div>
            )}
          </div>

          {/* Thumbnails */}
          {capturedPreviews.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {capturedPreviews.map((url, i) => (
                <div key={i} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Shot ${i + 1}`}
                    className="h-14 w-14 rounded-lg object-cover border-2 border-[#219EBC]/60" />
                  <button type="button" onClick={() => removePhoto(i)}
                    className="absolute -top-1 -right-1 flex items-center justify-center size-4 rounded-full bg-red-500 text-white hover:bg-red-600">
                    <X className="size-2.5" />
                  </button>
                  <span className="absolute bottom-0.5 left-0 right-0 text-center text-[8px] font-bold text-white drop-shadow">
                    #{i + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Pose guidance — cycles through hints as photos are taken */}
          <div className={cn("rounded-lg px-3 py-2 text-[10px] text-center font-semibold border",
            photoCount === 0
              ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
              : photoCount < 3
              ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600"
              : "border-green-500/30 bg-green-500/10 text-green-600"
          )}>
            {photoCount === MAX_PHOTOS
              ? `✓ ${MAX_PHOTOS} photos captured — full training set ready!`
              : photoCount >= 3
              ? `✓ ${photoCount}/${MAX_PHOTOS} photos — more = better accuracy. Next: ${POSE_HINTS[photoCount] ?? "any angle"}`
              : photoCount === 0
              ? `📷 ${POSE_HINTS[0]} — capture at least 3 photos for best results`
              : `${photoCount}/3 minimum — ${POSE_HINTS[photoCount] ?? "try a different angle"}`
            }
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button type="button" onClick={capturePhoto}
              disabled={isCapturing || !canCapture}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#219EBC] py-2.5 text-xs font-bold text-white shadow-lg shadow-[#219EBC]/30 transition-all hover:bg-[#1A8BA8] active:scale-95 disabled:opacity-50">
              <Camera className="size-3.5" />
              {isCapturing ? "Capturing…" : photoCount === 0 ? "Capture Photo" : "Capture Another"}
            </button>
            {photoCount > 0 && (
              <button type="button" onClick={reset}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
                <RotateCcw className="size-3.5" /> Reset
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Input type="file" accept="image/*" multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              if (files.length) onCapture(files)
            }} />
          <p className="text-xs text-muted-foreground">
            Select 3–5 photos: one frontal, slight left, slight right. Well-lit photos only.
          </p>
        </div>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────
// View Student Dialog
// ─────────────────────────────────────────────
function ViewStudentDialog({ student, onClose }: { student: Student; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar className="size-16 border-2 border-[#219EBC]">
          <AvatarFallback className={cn(
            "text-xl font-bold text-white",
            student.status === "present" ? "bg-[#219EBC]" :
              student.status === "late" ? "bg-[#1E3A5F]" : "bg-[#0D1B2A]"
          )}>
            {student.avatar || student.name.substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h3 className="text-lg font-bold text-foreground">{student.name}</h3>
          <p className="text-sm text-muted-foreground font-mono">{student.roll}</p>
          <Badge className={cn("mt-1 rounded-full border-none px-2.5 py-0.5 text-[11px] font-medium capitalize",
            student.status === "present" && "bg-[rgba(33,158,188,0.1)] text-[#219EBC]",
            student.status === "late" && "bg-[rgba(30,58,95,0.15)] text-[#1E3A5F]",
            student.status === "absent" && "bg-[rgba(13,27,42,0.1)] text-[#0D1B2A]"
          )}>
            {student.status}
          </Badge>
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Email</span>
          <span className="font-medium text-foreground">{student.email}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Phone</span>
          <span className="font-medium text-foreground">{student.phone || "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Roll No.</span>
          <span className="font-mono font-medium text-foreground">{student.roll}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Attendance</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{
                width: `${student.attendance}%`,
                backgroundColor: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A"
              }} />
            </div>
            <span className="font-bold text-xs" style={{
              color: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A"
            }}>
              {student.attendance}%
            </span>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        {student.phone && (
          <a href={`tel:${student.phone}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-input bg-background py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            📞 Call
          </a>
        )}
        {student.email && (
          <a href={`mailto:${student.email}`}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-input bg-background py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors">
            ✉️ Email
          </a>
        )}
        <button onClick={onClose}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#219EBC] py-2 text-xs font-semibold text-white hover:bg-[#1A8BA8] transition-colors">
          Close
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Edit Student Dialog
// ─────────────────────────────────────────────
function EditStudentDialog({ student, onSave, onClose }: {
  student: Student
  onSave: (updated: Partial<Student>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: student.name, roll: student.roll,
    email: student.email, phone: student.phone || "",
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await updateStudent(student.id, formData)
      onSave(updated)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update student.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="edit-name">Full Name *</Label>
          <Input id="edit-name" required value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-roll">Roll Number *</Label>
          <Input id="edit-roll" required value={formData.roll}
            onChange={e => setFormData({ ...formData, roll: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="edit-email">Email *</Label>
        <Input id="edit-email" type="email" required value={formData.email}
          onChange={e => setFormData({ ...formData, email: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="edit-phone">Phone</Label>
        <Input id="edit-phone" type="tel" value={formData.phone}
          onChange={e => setFormData({ ...formData, phone: e.target.value })} />
      </div>
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        <Button type="submit" disabled={saving} className="flex-1 bg-[#219EBC] hover:bg-[#1A8BA8]">
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────
// Student Directory
// ─────────────────────────────────────────────
const STATUS_FILTERS = ["All", "Present", "Absent", "Late"] as const
type StatusFilter = typeof STATUS_FILTERS[number]

export function StudentDirectory({ externalSearch }: { externalSearch?: string }) {
  const [searchQuery, setSearchQuery] = useState("")
  const [studentsData, setStudentsData] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({ name: "", roll: "", email: "", phone: "", avatar: "" })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [viewStudent, setViewStudent] = useState<Student | null>(null)
  const [editStudent, setEditStudent] = useState<Student | null>(null)
  const [reEnrollStudent, setReEnrollStudent] = useState<Student | null>(null)
  const [reEnrollFiles, setReEnrollFiles] = useState<File[]>([])
  const [isReEnrolling, setIsReEnrolling] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")
  const [filterOpen, setFilterOpen] = useState(false)
  const [showMigrationBanner, setShowMigrationBanner] = useState(false)

  useEffect(() => {
    loadStudents()
    const dismissed = typeof window !== "undefined" && localStorage.getItem("hawkMigrationDismissed") === "1"
    if (!dismissed) {
      fetch("/api/migration/status", { headers: getAuthHeaders() })
        .then(r => r.json())
        .then(data => { if (data?.needs_reregistration) setShowMigrationBanner(true) })
        .catch(() => { })
    }
  }, [])

  const loadStudents = async () => {
    try {
      const data = await getStudents()
      setStudentsData(data)
    } catch (error) {
      console.error("Failed to load students", error)
    } finally {
      setLoading(false)
    }
  }

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFiles.length) {
      alert("Please capture or upload at least one face photo before saving.")
      return
    }
    setIsSubmitting(true)
    try {
      const newStudent = await createStudent({ ...formData, avatar: formData.name.substring(0, 2).toUpperCase() })
      await trainStudentFace(newStudent.id, selectedFiles)
      setIsAddOpen(false)
      setSelectedFiles([])
      setFormData({ name: "", roll: "", email: "", phone: "", avatar: "" })
      loadStudents()
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to register student")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Remove ${name} from the system?`)) return
    try {
      await deleteStudent(id)
      loadStudents()
    } catch { alert("Failed to delete student.") }
  }

  const handleEditSave = (updated: Partial<Student>) => {
    setStudentsData(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s))
    setEditStudent(null)
  }

  const handleReEnroll = async () => {
    if (!reEnrollStudent || !reEnrollFiles.length) return
    setIsReEnrolling(true)
    try {
      await trainStudentFace(reEnrollStudent.id, reEnrollFiles)
      setReEnrollStudent(null)
      setReEnrollFiles([])
      alert(`✓ ${reEnrollStudent.name} re-enrolled successfully.`)
    } catch (err) {
      alert(err instanceof Error ? err.message : "Re-enrolment failed.")
    } finally {
      setIsReEnrolling(false)
    }
  }

  const activeSearch = externalSearch !== undefined ? externalSearch : searchQuery
  const filteredStudents = studentsData.filter(s => {
    const matchesSearch =
      s.name.toLowerCase().includes(activeSearch.toLowerCase()) ||
      s.roll.toLowerCase().includes(activeSearch.toLowerCase()) ||
      s.email.toLowerCase().includes(activeSearch.toLowerCase())
    const matchesStatus = statusFilter === "All" || s.status === statusFilter.toLowerCase()
    return matchesSearch && matchesStatus
  })

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">

      {/* Migration Banner */}
      {showMigrationBanner && (
        <div className="flex items-start gap-3 border-b border-amber-200/40 bg-amber-500/10 px-5 py-3">
          <span className="mt-0.5 shrink-0 text-base">⚠️</span>
          <div className="flex-1 text-xs">
            <p className="font-semibold text-amber-700 dark:text-amber-400">
              Model upgraded — all students must re-register their face
            </p>
            <p className="mt-0.5 text-amber-600/80 dark:text-amber-400/70">
              Click the camera icon next to each student to re-enrol their face photos.
            </p>
          </div>
          <button onClick={() => {
            localStorage.setItem("hawkMigrationDismissed", "1")
            setShowMigrationBanner(false)
          }} className="shrink-0 rounded p-0.5 text-amber-600 hover:bg-amber-500/20">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Student Directory</h3>
          <p className="text-xs text-muted-foreground">Manage students and face enrolment</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input type="text" placeholder="Search students..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-[180px] rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>

          <div className="relative">
            <button onClick={() => setFilterOpen(!filterOpen)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted">
              <Filter className="size-3.5" />{statusFilter}<ChevronDown className="size-3" />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-32 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
                {STATUS_FILTERS.map(f => (
                  <button key={f} onClick={() => { setStatusFilter(f); setFilterOpen(false) }}
                    className={cn("flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted",
                      statusFilter === f ? "text-[#219EBC] font-semibold" : "text-foreground")}>
                    {f !== "All" && <span className="size-2 rounded-full inline-block" style={{
                      backgroundColor: f === "Present" ? "#219EBC" : f === "Late" ? "#1E3A5F" : "#0D1B2A"
                    }} />}
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Dialog open={isAddOpen} onOpenChange={(open) => {
            setIsAddOpen(open)
            if (!open) { setSelectedFiles([]); setFormData({ name: "", roll: "", email: "", phone: "", avatar: "" }) }
          }}>
            <DialogTrigger asChild>
              <button className="flex h-8 items-center gap-1.5 rounded-lg bg-[#219EBC] px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#1A8BA8]">
                <Plus className="size-3.5" /> Add Student
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[460px] max-h-[92vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Register New Student</DialogTitle></DialogHeader>
              <form onSubmit={handleAddStudent} className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input id="name" required value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Aarav Sharma" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="roll">Roll Number *</Label>
                    <Input id="roll" required value={formData.roll}
                      onChange={e => setFormData({ ...formData, roll: e.target.value })} placeholder="e.g. CS2024001" />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" required value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="student@university.edu" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" type="tel" value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="+91 98765 43210" />
                </div>
                <div className="grid gap-2">
                  <Label>Face Photos *</Label>
                  <p className="text-[10px] text-muted-foreground -mt-1">
                    Capture 3–5 photos in good lighting. Slight angle variations improve accuracy.
                  </p>
                  <WebcamCapture onCapture={setSelectedFiles} />
                  {selectedFiles.length > 0 && (
                    <p className={cn("text-[10px] font-semibold",
                      selectedFiles.length >= 3 ? "text-green-600" : "text-yellow-600"
                    )}>
                      {selectedFiles.length >= 3
                        ? `✓ ${selectedFiles.length} photos ready — great coverage!`
                        : `⚠ ${selectedFiles.length} photo${selectedFiles.length > 1 ? "s" : ""} — capture ${3 - selectedFiles.length} more for minimum accuracy`
                      }
                    </p>
                  )}
                </div>
                <Button type="submit" disabled={isSubmitting || selectedFiles.length < 3}
                  className="mt-1 bg-[#219EBC] hover:bg-[#1A8BA8] disabled:opacity-50">
                  {isSubmitting
                    ? "Saving & Training AI…"
                    : selectedFiles.length < 3
                    ? `📷 Capture ${3 - selectedFiles.length} more photo${3 - selectedFiles.length > 1 ? "s" : ""}`
                    : `Save & Train (${selectedFiles.length} photos → ${selectedFiles.length * 4} AI templates)`
                  }
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* View Dialog */}
      <Dialog open={!!viewStudent} onOpenChange={(open) => !open && setViewStudent(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader><DialogTitle>Student Profile</DialogTitle></DialogHeader>
          {viewStudent && <ViewStudentDialog student={viewStudent} onClose={() => setViewStudent(null)} />}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editStudent} onOpenChange={(open) => !open && setEditStudent(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Edit Student</DialogTitle></DialogHeader>
          {editStudent && <EditStudentDialog student={editStudent} onSave={handleEditSave} onClose={() => setEditStudent(null)} />}
        </DialogContent>
      </Dialog>

      {/* Re-enrol Dialog */}
      <Dialog open={!!reEnrollStudent} onOpenChange={(open) => {
        if (!open) { setReEnrollStudent(null); setReEnrollFiles([]) }
      }}>
        <DialogContent className="sm:max-w-[460px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Re-enrol Face — {reEnrollStudent?.name}</DialogTitle>
          </DialogHeader>
          {reEnrollStudent && (
            <div className="grid gap-4 py-2">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white",
                  reEnrollStudent.status === "present" ? "bg-[#219EBC]" :
                    reEnrollStudent.status === "late" ? "bg-[#1E3A5F]" : "bg-[#0D1B2A]"
                )}>
                  {reEnrollStudent.avatar || reEnrollStudent.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{reEnrollStudent.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{reEnrollStudent.roll}</p>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>New Face Photos *</Label>
                <p className="text-[10px] text-muted-foreground -mt-1">
                  Capture 3–5 fresh photos. This replaces the existing face template.
                </p>
                <WebcamCapture onCapture={setReEnrollFiles} />
                {reEnrollFiles.length > 0 && (
                  <p className="text-[10px] text-green-600 font-semibold">
                    ✓ {reEnrollFiles.length} photo{reEnrollFiles.length > 1 ? "s" : ""} ready
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1"
                  onClick={() => { setReEnrollStudent(null); setReEnrollFiles([]) }}>
                  Cancel
                </Button>
                <Button type="button" disabled={isReEnrolling || !reEnrollFiles.length}
                  className="flex-1 bg-[#219EBC] hover:bg-[#1A8BA8] disabled:opacity-50"
                  onClick={handleReEnroll}>
                  {isReEnrolling ? "Updating AI Model…" : "Save & Re-enrol"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Table */}
      <div className="overflow-x-auto min-h-[400px]" onClick={() => setFilterOpen(false)}>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading directory...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Student</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Roll No.</th>
                <th className="hidden px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell">Email</th>
                <th className="hidden px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground lg:table-cell">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Attendance</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                    {studentsData.length === 0 ? "No students yet. Click Add Student to register." : "No students match this filter."}
                  </td>
                </tr>
              ) : filteredStudents.map((student) => (
                <tr key={student.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className={cn("text-xs font-semibold text-white",
                          student.status === "present" ? "bg-[#219EBC]" :
                            student.status === "late" ? "bg-[#1E3A5F]" : "bg-[#0D1B2A]")}>
                          {student.avatar || student.name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium text-foreground">{student.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5"><span className="font-mono text-xs text-muted-foreground">{student.roll}</span></td>
                  <td className="hidden px-6 py-3.5 md:table-cell"><span className="text-xs text-muted-foreground">{student.email}</span></td>
                  <td className="hidden px-6 py-3.5 lg:table-cell"><span className="text-xs text-muted-foreground">{student.phone}</span></td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${student.attendance || 0}%`,
                          backgroundColor: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A"
                        }} />
                      </div>
                      <span className="text-xs font-semibold" style={{
                        color: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A"
                      }}>{student.attendance || 0}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <Badge className={cn("rounded-full border-none px-2.5 py-0.5 text-[11px] font-medium capitalize",
                      student.status === "present" && "bg-[rgba(33,158,188,0.1)] text-[#219EBC]",
                      student.status === "late" && "bg-[rgba(30,58,95,0.15)] text-[#1E3A5F]",
                      student.status === "absent" && "bg-[rgba(13,27,42,0.1)] text-[#0D1B2A]"
                    )}>{student.status || "absent"}</Badge>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setViewStudent(student)}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="View">
                        <Eye className="size-3.5" />
                      </button>
                      <button onClick={() => setEditStudent(student)}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Edit">
                        <Pencil className="size-3.5" />
                      </button>
                      <button onClick={() => { setReEnrollStudent(student); setReEnrollFiles([]) }}
                        className="rounded-lg p-1.5 text-[#219EBC] transition-colors hover:bg-[rgba(33,158,188,0.1)]" title="Re-enrol face">
                        <Camera className="size-3.5" />
                      </button>
                      <button onClick={() => handleDelete(student.id, student.name)}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-[rgba(13,27,42,0.1)] hover:text-[#0D1B2A]" title="Delete">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}