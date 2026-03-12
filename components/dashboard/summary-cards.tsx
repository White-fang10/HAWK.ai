"use client"

import { useState, useEffect } from "react"
import { Users, UserX, Clock, TrendingUp, RefreshCw } from "lucide-react"
import { getSummaryStats } from "@/lib/api"

interface SummaryData {
  total: number
  present: number
  absent: number
  late: number
  rate: number
}

export function SummaryCards() {
  const [data, setData] = useState<SummaryData>({ total: 0, present: 0, absent: 0, late: 0, rate: 0 })
  const [initialLoad, setInitialLoad] = useState(true)

  const load = () => {
    getSummaryStats()
      .then(setData)
      .catch(() => { })
      .finally(() => setInitialLoad(false))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 10000) // refresh every 10s to reduce backend load
    return () => clearInterval(interval)
  }, [])

  const cards = [
    {
      title: "Present Students",
      value: initialLoad ? "..." : String(data.present),
      subtitle: `out of ${data.total}`,
      icon: Users,
      color: "#219EBC",
      bgColor: "rgba(33,158,188,0.1)",
      trend: data.total > 0 ? `${data.rate}% attendance rate` : "No students yet",
      trendUp: data.rate >= 75,
    },
    {
      title: "Absent Students",
      value: initialLoad ? "..." : String(data.absent),
      subtitle: data.absent === 0 ? "All present!" : "not detected",
      icon: UserX,
      color: "#0D1B2A",
      bgColor: "rgba(13,27,42,0.15)",
      trend: data.absent === 0 ? "Great attendance!" : `${data.absent} missing`,
      trendUp: data.absent === 0,
    },
    {
      title: "Late Students",
      value: initialLoad ? "..." : String(data.late),
      subtitle: "arrived late",
      icon: Clock,
      color: "#1E3A5F",
      bgColor: "rgba(30,58,95,0.15)",
      trend: data.late === 0 ? "No late arrivals" : `${data.late} late today`,
      trendUp: data.late === 0,
    },
    {
      title: "Attendance Rate",
      value: initialLoad ? "..." : `${data.rate}%`,
      subtitle: "today",
      icon: TrendingUp,
      color: "#219EBC",
      bgColor: "rgba(142,202,230,0.12)",
      trend: data.rate >= 75 ? "On track" : "Below target",
      trendUp: data.rate >= 75,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.title}
          className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{card.title}</p>
              <p className="text-3xl font-bold text-foreground">{card.value}</p>
              <p className="text-xs text-muted-foreground">{card.subtitle}</p>
            </div>
            <div
              className="flex size-10 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110"
              style={{ backgroundColor: card.bgColor }}
            >
              <card.icon className="size-5" style={{ color: card.color }} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-xs font-medium" style={{ color: card.trendUp ? "#219EBC" : "#0D1B2A" }}>
              {card.trend}
            </span>
          </div>
          <div
            className="absolute bottom-0 left-0 h-1 w-full opacity-60 transition-opacity group-hover:opacity-100"
            style={{ backgroundColor: card.color }}
          />
        </div>
      ))}
    </div>
  )
}
