"use client"

import { useState, useEffect } from "react"
import { UserX, AlertTriangle, Phone, Mail } from "lucide-react"
import { getStudents, Student } from "@/lib/api"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"

export function AbsentStudents() {
  const [absentStudents, setAbsentStudents] = useState<Student[]>([])

  useEffect(() => {
    const load = () => {
      getStudents()
        .then((all) => setAbsentStudents(all.filter((s) => s.status === "absent")))
        .catch(() => { })
    }
    load()
    const interval = setInterval(load, 15000) // refresh every 15s
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-[rgba(13,27,42,0.1)]">
            <UserX className="size-5 text-[#0D1B2A]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Absent Students</h3>
            <p className="text-xs text-muted-foreground">
              {absentStudents.length} student{absentStudents.length !== 1 ? "s" : ""} not detected today
            </p>
          </div>
        </div>
        <Badge className="rounded-full border-none bg-[rgba(13,27,42,0.1)] px-2.5 py-0.5 text-[11px] font-semibold text-[#0D1B2A]">
          {absentStudents.length} absent
        </Badge>
      </div>

      {absentStudents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-[rgba(33,158,188,0.1)]">
            <UserX className="size-6 text-[#219EBC]" />
          </div>
          <p className="text-sm font-medium text-foreground">All students present</p>
          <p className="text-xs text-muted-foreground">No absences detected today</p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {absentStudents.map((student) => (
            <div
              key={student.id}
              className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-center gap-3">
                <Avatar className="size-10 border-2 border-[#0D1B2A]/30">
                  <AvatarFallback className="bg-[#0D1B2A] text-xs font-semibold text-[#FFFFFF]">
                    {student.avatar || student.name.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-semibold text-foreground">{student.name}</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{student.roll}</span>
                    <span className="text-muted-foreground">{"/"}</span>
                    <span className="text-xs text-muted-foreground">{student.email}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden items-center gap-1.5 sm:flex">
                  <AlertTriangle className="size-3.5 text-[#0D1B2A]" />
                  <span
                    className="text-xs font-medium"
                    style={{ color: student.attendance >= 75 ? "#1E3A5F" : "#0D1B2A" }}
                  >
                    {student.attendance}% attendance
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {student.phone && (
                    <a
                      href={`tel:${student.phone}`}
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[rgba(33,158,188,0.1)] hover:text-[#219EBC]"
                      aria-label={`Call ${student.name}`}
                    >
                      <Phone className="size-3.5" />
                    </a>
                  )}
                  {student.email && (
                    <a
                      href={`mailto:${student.email}`}
                      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[rgba(33,158,188,0.1)] hover:text-[#219EBC]"
                      aria-label={`Email ${student.name}`}
                    >
                      <Mail className="size-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
