"use client"

import { useState } from "react"
import { FileSpreadsheet, FileText, Calendar, Loader2 } from "lucide-react"
import { downloadReport } from "@/lib/api"

type Period = "daily" | "weekly" | "monthly"
type Format = "excel" | "pdf"

const reportOptions: { label: string; description: string; period: Period }[] = [
  { label: "Daily Report", description: "Today's complete attendance", period: "daily" },
  { label: "Weekly Report", description: "Last 7 days summary", period: "weekly" },
  { label: "Monthly Report", description: "Full month analytics", period: "monthly" },
]

export function ReportExport() {
  // Track loading state per period+format combination
  const [loading, setLoading] = useState<Record<string, boolean>>({})

  const handleDownload = async (period: Period, format: Format) => {
    const key = `${period}_${format}`
    setLoading((prev) => ({ ...prev, [key]: true }))
    try {
      await downloadReport(period, format)
    } catch (err) {
      alert(`Failed to download ${format.toUpperCase()} report. Make sure the backend is running.`)
      console.error(err)
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }))
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-sm font-semibold text-foreground">Export Reports</h3>
        <p className="text-xs text-muted-foreground">Download attendance data</p>
      </div>
      <div className="space-y-3 p-5">
        {reportOptions.map((option) => {
          const excelLoading = loading[`${option.period}_excel`]
          const pdfLoading = loading[`${option.period}_pdf`]
          return (
            <div
              key={option.label}
              className="flex items-center justify-between rounded-xl border border-border p-4 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-[rgba(33,158,188,0.1)]">
                  <Calendar className="size-4 text-[#219EBC]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{option.label}</p>
                  <p className="text-xs text-muted-foreground">{option.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Excel Button */}
                <button
                  onClick={() => handleDownload(option.period, "excel")}
                  disabled={excelLoading || pdfLoading}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {excelLoading ? (
                    <Loader2 className="size-3.5 animate-spin text-emerald-600" />
                  ) : (
                    <FileSpreadsheet className="size-3.5 text-emerald-600" />
                  )}
                  Excel
                </button>
                {/* PDF Button */}
                <button
                  onClick={() => handleDownload(option.period, "pdf")}
                  disabled={excelLoading || pdfLoading}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {pdfLoading ? (
                    <Loader2 className="size-3.5 animate-spin text-[#219EBC]" />
                  ) : (
                    <FileText className="size-3.5 text-[#219EBC]" />
                  )}
                  PDF
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
