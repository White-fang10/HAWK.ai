"use client"

import { Bell, Search, Sun, Moon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useTheme } from "@/hooks/use-theme"
import { useState, useEffect } from "react"
import { getAlerts } from "@/lib/api"

interface TopNavbarProps {
  sidebarCollapsed: boolean
  onSearch?: (query: string) => void
}

export function TopNavbar({ sidebarCollapsed, onSearch }: TopNavbarProps) {
  const { theme, toggleTheme } = useTheme()
  const [alertCount, setAlertCount] = useState(0)
  const [userName, setUserName] = useState("Dr. Sarah Mitchell")
  const [userRole, setUserRole] = useState("Computer Science Dept.")
  const [searchValue, setSearchValue] = useState("")

  useEffect(() => {
    // Load session info
    const name = localStorage.getItem("hawk_name")
    const email = localStorage.getItem("hawk_email")
    const role = localStorage.getItem("hawk_role")
    if (name) setUserName(name)
    if (role === "admin") setUserRole("Administrator")
    else if (email) setUserRole(email)

    // Fetch real alert count
    const loadAlerts = () => {
      getAlerts()
        .then((alerts) => setAlertCount(alerts.filter((a: { type: string }) => a.type === "warning" || a.type === "alert").length))
        .catch(() => { })
    }
    loadAlerts()
    const interval = setInterval(loadAlerts, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value)
    onSearch?.(e.target.value)
  }

  const initials = userName
    .split(" ")
    .slice(-2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search students, classes..."
            value={searchValue}
            onChange={handleSearchChange}
            className="h-9 w-[280px] rounded-lg border border-input bg-background pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">System Online</span>
        </div>

        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Toggle dark mode"
        >
          {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>

        <button className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Bell className="size-5" />
          {alertCount > 0 && (
            <Badge className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border-none bg-[#219EBC] p-0 text-[10px] text-[#FFFFFF]">
              {alertCount > 9 ? "9+" : alertCount}
            </Badge>
          )}
        </button>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium leading-none text-foreground">{userName}</p>
            <p className="text-xs text-muted-foreground">{userRole}</p>
          </div>
          <Avatar className="size-9 border-2 border-[#219EBC]">
            <AvatarFallback className="bg-[#219EBC] text-xs font-semibold text-[#FFFFFF]">
              {initials || "U"}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  )
}
