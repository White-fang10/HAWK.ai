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
import { getStudents, createStudent, trainStudentFace, deleteStudent, Student } from "@/lib/api"

// ─────────────────────────────────────────────
// Webcam Capture Widget (Client-side)
// ─────────────────────────────────────────────
function WebcamCapture({ onCapture }: { onCapture: (file: File) => void }) {
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captureMode, setCaptureMode] = useState<"camera" | "upload">("camera")

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  // Start camera when entering camera mode
  useEffect(() => {
    let activeStream: MediaStream | null = null

    const startCamera = async () => {
      try {
        setError(null)
        activeStream = await navigator.mediaDevices.getUserMedia({ video: true })
        setStream(activeStream)
        if (videoRef.current) {
          videoRef.current.srcObject = activeStream
        }
      } catch (err) {
        console.warn("Camera access warning:", err)
        setError("Cannot access local camera. Please allow camera permissions or check if it is exclusively used.")
      }
    }

    if (captureMode === "camera" && !capturedImage) {
      startCamera()
    }

    // Cleanup when mode changes or unmounts
    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop())
      }
    }
  }, [captureMode, capturedImage])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !stream) return

    setIsCapturing(true)
    try {
      const video = videoRef.current
      const canvas = canvasRef.current

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        canvas.toBlob((blob: Blob | null) => {
          if (blob) {
            const url = URL.createObjectURL(blob)
            setCapturedImage(url)
            const file = new File([blob], "capture.jpg", { type: "image/jpeg" })
            onCapture(file)

            // Stop the camera stream after taking a picture
            stream.getTracks().forEach(track => track.stop())
            setStream(null)
          } else {
            setError("Failed to generate image blob.")
          }
          setIsCapturing(false)
        }, "image/jpeg", 0.9)
      }
    } catch (err) {
      console.error("Capture error:", err)
      setError("Could not capture photo from local camera.")
      setIsCapturing(false)
    }
  }, [onCapture, stream])

  const retake = useCallback(() => {
    if (capturedImage) URL.revokeObjectURL(capturedImage)
    setCapturedImage(null)
    setError(null)
  }, [capturedImage])

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg overflow-hidden border border-border text-xs font-medium">
        <button
          type="button"
          onClick={() => { setCaptureMode("camera"); retake() }}
          className={cn("flex flex-1 items-center justify-center gap-1.5 py-2 transition-colors",
            captureMode === "camera" ? "bg-[#219EBC] text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted"
          )}
        >
          <Camera className="size-3.5" /> Live Capture
        </button>
        <button
          type="button"
          onClick={() => { setCaptureMode("upload"); retake() }}
          className={cn("flex flex-1 items-center justify-center gap-1.5 py-2 transition-colors",
            captureMode === "upload" ? "bg-[#219EBC] text-white" : "bg-muted/40 text-muted-foreground hover:bg-muted"
          )}
        >
          <Upload className="size-3.5" /> Upload Photo
        </button>
      </div>

      {captureMode === "camera" ? (
        <div className="space-y-2">
          {/* Hidden canvas for taking snapshot */}
          <canvas ref={canvasRef} className="hidden" />

          <div className="relative overflow-hidden rounded-xl bg-[#023047] aspect-video flex items-center justify-center">
            {capturedImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedImage} alt="Captured" className="w-full h-full object-cover rounded-xl" />
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-green-500/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                  <CheckCircle className="size-3" /> Captured
                </div>
              </>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover rounded-xl"
                />
                {!stream && !error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#023047]/90 rounded-xl">
                    <p className="text-xs text-[#8ECAE6] px-4 text-center">Opening local camera...</p>
                  </div>
                )}
                {error && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#023047]/90 rounded-xl">
                    <p className="text-xs text-[#1E3A5F] px-4 text-center">{error}</p>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex gap-2">
            {capturedImage ? (
              <button type="button" onClick={retake}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#219EBC]/40 bg-[rgba(33,158,188,0.08)] py-2 text-xs font-semibold text-[#219EBC] transition-colors hover:bg-[rgba(33,158,188,0.15)]">
                <RotateCcw className="size-3.5" /> Retake Photo
              </button>
            ) : (
              <button type="button" onClick={capturePhoto} disabled={isCapturing || !stream}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#219EBC] py-2.5 text-xs font-bold text-white shadow-lg shadow-[#219EBC]/30 transition-all hover:bg-[#1A8BA8] active:scale-95 disabled:opacity-60">
                <Camera className="size-3.5" />
                {isCapturing ? "Capturing..." : "Capture Photo"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Input type="file" accept="image/*" required
            onChange={(e) => { const file = e.target.files?.[0]; if (file) onCapture(file) }} />
          <p className="text-[10px] text-muted-foreground">Upload a clear, front-facing photo.</p>
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
        <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium text-foreground">{student.email}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="font-medium text-foreground">{student.phone || "—"}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Roll No.</span><span className="font-mono font-medium text-foreground">{student.roll}</span></div>
        <div className="flex justify-between items-center">
          <span className="text-muted-foreground">Attendance</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{
                width: `${student.attendance}%`,
                backgroundColor: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A"
              }} />
            </div>
            <span className="font-bold text-xs" style={{ color: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A" }}>
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
function EditStudentDialog({ student, onSave, onClose }: { student: Student; onSave: (updated: Partial<Student>) => void; onClose: () => void }) {
  const [formData, setFormData] = useState({
    name: student.name,
    roll: student.roll,
    email: student.email,
    phone: student.phone || "",
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/students/${student.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })
      if (!res.ok) throw new Error("Failed to update student")
      const updated = await res.json()
      onSave(updated)
    } catch {
      alert("Failed to update student. Make sure the backend is running.")
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

interface StudentDirectoryProps {
  externalSearch?: string
}

export function StudentDirectory({ externalSearch }: StudentDirectoryProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [studentsData, setStudentsData] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({ name: "", roll: "", email: "", phone: "", avatar: "" })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [viewStudent, setViewStudent] = useState<Student | null>(null)
  const [editStudent, setEditStudent] = useState<Student | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All")
  const [filterOpen, setFilterOpen] = useState(false)

  useEffect(() => { loadStudents() }, [])

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
    if (!selectedFile) { alert("Please capture or upload a face photo before saving."); return }
    setIsSubmitting(true)
    try {
      const newStudent = await createStudent({ ...formData, avatar: formData.name.substring(0, 2).toUpperCase() })
      await trainStudentFace(newStudent.id, selectedFile)
      setIsAddOpen(false)
      setSelectedFile(null)
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
    } catch {
      alert("Failed to delete student.")
    }
  }

  const handleEditSave = (updated: Partial<Student>) => {
    setStudentsData(prev => prev.map(s => s.id === updated.id ? { ...s, ...updated } : s))
    setEditStudent(null)
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
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Student Directory</h3>
          <p className="text-xs text-muted-foreground">Manage and track student attendance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search students..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-[180px] rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Status Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Filter className="size-3.5" />
              {statusFilter}
              <ChevronDown className="size-3" />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-32 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
                {STATUS_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => { setStatusFilter(f); setFilterOpen(false) }}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted",
                      statusFilter === f ? "text-[#219EBC] font-semibold" : "text-foreground"
                    )}
                  >
                    {f !== "All" && (
                      <span className="size-2 rounded-full inline-block" style={{
                        backgroundColor: f === "Present" ? "#219EBC" : f === "Late" ? "#1E3A5F" : "#0D1B2A"
                      }} />
                    )}
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add Student Dialog */}
          <Dialog open={isAddOpen} onOpenChange={(open) => {
            setIsAddOpen(open)
            if (!open) { setSelectedFile(null); setFormData({ name: "", roll: "", email: "", phone: "", avatar: "" }) }
          }}>
            <DialogTrigger asChild>
              <button className="flex h-8 items-center gap-1.5 rounded-lg bg-[#219EBC] px-3 text-xs font-semibold text-[#FFFFFF] shadow-sm transition-colors hover:bg-[#1A8BA8]">
                <Plus className="size-3.5" /> Add Student
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[460px] max-h-[92vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Register New Student</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddStudent} className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="name">Full Name *</Label>
                    <Input id="name" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Aarav Sharma" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="roll">Roll Number *</Label>
                    <Input id="roll" required value={formData.roll} onChange={e => setFormData({ ...formData, roll: e.target.value })} placeholder="e.g. CS2024001" />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="student@university.edu" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="+91 98765 43210" />
                </div>
                <div className="grid gap-2">
                  <Label>Face Photo for AI Training *</Label>
                  <WebcamCapture onCapture={setSelectedFile} />
                  {selectedFile && (
                    <p className="text-[10px] text-green-600 font-medium">
                      ✓ {selectedFile.name === "capture.jpg" ? "Live capture ready" : `"${selectedFile.name}" selected`}
                    </p>
                  )}
                </div>
                <Button type="submit" disabled={isSubmitting || !selectedFile} className="mt-1 bg-[#219EBC] hover:bg-[#1A8BA8] disabled:opacity-50">
                  {isSubmitting ? "Training AI Model..." : "Save & Train"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* View Student Dialog */}
      <Dialog open={!!viewStudent} onOpenChange={(open) => !open && setViewStudent(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Student Profile</DialogTitle>
          </DialogHeader>
          {viewStudent && <ViewStudentDialog student={viewStudent} onClose={() => setViewStudent(null)} />}
        </DialogContent>
      </Dialog>

      {/* Edit Student Dialog */}
      <Dialog open={!!editStudent} onOpenChange={(open) => !open && setEditStudent(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
          </DialogHeader>
          {editStudent && (
            <EditStudentDialog
              student={editStudent}
              onSave={handleEditSave}
              onClose={() => setEditStudent(null)}
            />
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
                  <td colSpan={7} className="text-center py-10 text-sm text-muted-foreground">No students found.</td>
                </tr>
              ) : filteredStudents.map((student) => (
                <tr key={student.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarFallback className={cn("text-xs font-semibold text-[#FFFFFF]",
                          student.status === "present" ? "bg-[#219EBC]" :
                            student.status === "late" ? "bg-[#1E3A5F]" : "bg-[#0D1B2A]"
                        )}>
                          {student.avatar || student.name.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium text-foreground">{student.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className="font-mono text-xs text-muted-foreground">{student.roll}</span>
                  </td>
                  <td className="hidden px-6 py-3.5 md:table-cell">
                    <span className="text-xs text-muted-foreground">{student.email}</span>
                  </td>
                  <td className="hidden px-6 py-3.5 lg:table-cell">
                    <span className="text-xs text-muted-foreground">{student.phone}</span>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full transition-all"
                          style={{
                            width: `${student.attendance || 0}%`,
                            backgroundColor: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A"
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold"
                        style={{ color: student.attendance >= 85 ? "#219EBC" : student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A" }}>
                        {student.attendance || 0}%
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <Badge className={cn("rounded-full border-none px-2.5 py-0.5 text-[11px] font-medium capitalize",
                      student.status === "present" && "bg-[rgba(33,158,188,0.1)] text-[#219EBC]",
                      student.status === "late" && "bg-[rgba(30,58,95,0.15)] text-[#1E3A5F]",
                      student.status === "absent" && "bg-[rgba(13,27,42,0.1)] text-[#0D1B2A]"
                    )}>
                      {student.status || "absent"}
                    </Badge>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setViewStudent(student)}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="View profile">
                        <Eye className="size-3.5" />
                      </button>
                      <button
                        onClick={() => setEditStudent(student)}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="Edit student">
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(student.id, student.name)}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-[rgba(13,27,42,0.1)] hover:text-[#0D1B2A]" aria-label="Remove student">
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
