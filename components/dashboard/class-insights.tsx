"use client"

import { useState, useEffect } from "react"
import { TrendingUp, TrendingDown, Minus, Lightbulb } from "lucide-react"
import { getClassInsights } from "@/lib/api"
import { cn } from "@/lib/utils"

export function ClassInsights() {
  const [insights, setInsights] = useState<any[]>([])

  useEffect(() => {
    getClassInsights().then(setInsights).catch(console.error)
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-[rgba(255,183,3,0.12)]">
          <Lightbulb className="size-5 text-[#219EBC]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">AI Class Insights</h3>
          <p className="text-xs text-muted-foreground">Intelligent analysis of attendance patterns</p>
        </div>
      </div>
      <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {insights.map((insight) => (
          <div
            key={insight.label}
            className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-muted/30"
          >
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{insight.label}</p>
              <p className="text-lg font-bold text-foreground">{insight.value}</p>
            </div>
            <div
              className={cn(
                "flex size-8 items-center justify-center rounded-lg",
                insight.trend === "up" && "bg-[rgba(33,158,188,0.1)]",
                insight.trend === "down" && "bg-[rgba(251,133,0,0.1)]",
                insight.trend === "neutral" && "bg-[rgba(255,183,3,0.12)]"
              )}
            >
              {insight.trend === "up" && <TrendingUp className="size-4 text-[#219EBC]" />}
              {insight.trend === "down" && <TrendingDown className="size-4 text-[#0D1B2A]" />}
              {insight.trend === "neutral" && <Minus className="size-4 text-[#1E3A5F]" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
