"use client"

import { useState, useEffect } from "react"
import { AlertTriangle, Info, Wifi, TrendingDown } from "lucide-react"
import { getAlerts } from "@/lib/api"
import { cn } from "@/lib/utils"

const iconMap = {
  warning: AlertTriangle,
  alert: TrendingDown,
  info: Info,
  camera: Wifi,
}

export function RealtimeAlerts() {
  const [alerts, setAlerts] = useState<any[]>([])

  useEffect(() => {
    const load = () => getAlerts().then(setAlerts).catch(console.error)
    load()
    const interval = setInterval(load, 15000) // refresh every 15s
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Real-Time Alerts</h3>
          <p className="text-xs text-muted-foreground">Live notifications from AI system</p>
        </div>
        <span className="flex size-5 items-center justify-center rounded-full bg-[#0D1B2A] text-[10px] font-bold text-[#FFFFFF]">
          {alerts.length}
        </span>
      </div>
      <div className="divide-y divide-border">
        {alerts.map((alert) => {
          const Icon = alert.type === "warning" ? AlertTriangle : alert.type === "alert" ? TrendingDown : Info
          return (
            <div
              key={alert.id}
              className="flex items-start gap-3 px-6 py-3.5 transition-colors hover:bg-muted/30"
            >
              <div
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                  alert.type === "warning" && "bg-[rgba(13,27,42,0.1)]",
                  alert.type === "alert" && "bg-[rgba(13,27,42,0.1)]",
                  alert.type === "info" && "bg-[rgba(33,158,188,0.1)]"
                )}
              >
                <Icon
                  className={cn(
                    "size-4",
                    alert.type === "warning" && "text-[#0D1B2A]",
                    alert.type === "alert" && "text-[#0D1B2A]",
                    alert.type === "info" && "text-[#219EBC]"
                  )}
                />
              </div>
              <div className="flex-1">
                <p className="text-sm text-foreground">{alert.message}</p>
                <p className="text-xs text-muted-foreground">{alert.time}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
