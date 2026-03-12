"use client"

import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import Image from "next/image"
import {
  LayoutDashboard,
  Video,
  Users,
  BarChart3,
  FileText,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react"

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", id: "dashboard" },
  { icon: Video, label: "Live Monitor", id: "monitor" },
  { icon: Users, label: "Students", id: "students" },
  { icon: BarChart3, label: "Analytics", id: "analytics" },
  { icon: FileText, label: "Reports", id: "reports" },
]

interface SidebarNavProps {
  activeTab: string
  onTabChange: (tab: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function SidebarNav({ activeTab, onTabChange, collapsed, onToggleCollapse }: SidebarNavProps) {
  const router = useRouter()

  const handleLogout = () => {
    localStorage.removeItem("hawk_token")
    localStorage.removeItem("hawk_role")
    localStorage.removeItem("hawk_name")
    localStorage.removeItem("hawk_email")
    router.push("/")
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col bg-[#023047] transition-all duration-300",
        collapsed ? "w-[72px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-[rgba(255,255,255,0.1)] px-3">
        {/* White rounded container so the hawk logo is clearly visible on the dark sidebar */}
        <div
          className="relative flex-shrink-0 rounded-xl overflow-hidden ring-2 ring-[#219EBC]/60 shadow-lg shadow-[#219EBC]/25"
          style={{ width: 40, height: 40, background: "#ffffff" }}
        >
          <Image
            src="/newlogo.png"
            alt="Hawk AI"
            fill
            className="object-contain p-0.5"
            style={{}}
            priority
          />
        </div>
        {!collapsed && (
          <div>
            <h1 className="text-base font-bold tracking-tight text-white">Hawk AI</h1>
            <p className="text-[9px] text-[#219EBC] uppercase font-bold tracking-widest leading-none">Smart Classroom</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-[#219EBC] text-[#FFFFFF] shadow-lg shadow-[#219EBC]/25"
                  : "text-[#8ECAE6] hover:bg-[rgba(255,255,255,0.08)] hover:text-[#FFFFFF]"
              )}
            >
              <item.icon className="size-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-[rgba(255,255,255,0.1)] p-3 space-y-1">
        {/* Logout button */}
        <button
          onClick={handleLogout}
          title="Logout"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <LogOut className="size-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center rounded-lg py-2 text-[#8ECAE6] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-[#FFFFFF]"
        >
          {collapsed ? (
            <ChevronRight className="size-5" />
          ) : (
            <ChevronLeft className="size-5" />
          )}
        </button>
      </div>
    </aside>
  )
}
