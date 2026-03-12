"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
    LayoutDashboard, Users, GraduationCap, School, BarChart3, FileText,
    Settings, UserCog, Search, Bell, Sun, Moon, LogOut, ChevronLeft, ChevronRight,
    HardDrive, X
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "@/hooks/use-theme"
import { adminSearch } from "@/lib/admin-api"
import Image from "next/image"
import { AdminOverview } from "./admin-overview"
import { AdminTeachers } from "./admin-teachers"
import { AdminStudents } from "./admin-students"
import { AdminClasses } from "./admin-classes"
import { AdminAnalytics } from "./admin-analytics"
import { AdminReports } from "./admin-reports"
import { AdminSettings } from "./admin-settings"

type AdminTab = "dashboard" | "teachers" | "students" | "classes" | "analytics" | "reports" | "settings"

const navItems: { icon: React.ElementType; label: string; id: AdminTab }[] = [
    { icon: LayoutDashboard, label: "Dashboard", id: "dashboard" },
    { icon: GraduationCap, label: "Teachers", id: "teachers" },
    { icon: Users, label: "Students", id: "students" },
    { icon: School, label: "Classes", id: "classes" },
    { icon: BarChart3, label: "Attendance Analytics", id: "analytics" },
    { icon: FileText, label: "Reports", id: "reports" },
]

export function AdminShell() {
    const router = useRouter()
    const { theme, toggleTheme } = useTheme()
    const [activeTab, setActiveTab] = useState<AdminTab>("dashboard")
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
    const [adminName, setAdminName] = useState("Super Admin")
    const [searchQuery, setSearchQuery] = useState("")
    const [searchResults, setSearchResults] = useState<{ students: { name: string, roll: string }[]; teachers: { name: string, subject: string }[]; classes: { name: string }[] } | null>(null)
    const [searchOpen, setSearchOpen] = useState(false)

    useEffect(() => {
        const name = localStorage.getItem("hawk_name")
        const role = localStorage.getItem("hawk_role")
        if (name) setAdminName(name)
        // Guard: redirect if not admin
        if (role !== "admin") router.push("/")
    }, [router])

    useEffect(() => {
        if (searchQuery.length < 2) { setSearchResults(null); return }
        const timer = setTimeout(async () => {
            try {
                const r = await adminSearch(searchQuery)
                setSearchResults(r)
                setSearchOpen(true)
            } catch { }
        }, 300)
        return () => clearTimeout(timer)
    }, [searchQuery])

    const handleLogout = () => {
        localStorage.removeItem("hawk_token")
        localStorage.removeItem("hawk_role")
        localStorage.removeItem("hawk_name")
        localStorage.removeItem("hawk_email")
        router.push("/")
    }

    const sidebarWidth = sidebarCollapsed ? 72 : 256

    return (
        <div className="min-h-screen bg-[#011a27] text-[#EAF6F9] flex">
            {/* Sidebar */}
            <aside className={cn(
                "fixed left-0 top-0 z-40 h-screen flex flex-col bg-[#023047] border-r border-slate-800 transition-all duration-300",
                sidebarCollapsed ? "w-[72px]" : "w-64"
            )}>
                {/* Logo */}
                <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-3">
                    {/* White rounded container so the hawk logo (white bg) is clearly visible */}
                    <div
                        className="relative flex-shrink-0 rounded-xl overflow-hidden ring-2 ring-[#219EBC]/60 shadow-lg shadow-[#219EBC]/25"
                        style={{ width: 40, height: 40, background: "#ffffff" }}
                    >
                        <Image
                            src="/newlogo.png"
                            alt="Hawk AI"
                            fill
                            className="object-contain p-0.5"
                            priority
                        />
                    </div>
                    {!sidebarCollapsed && (
                        <div>
                            <h1 className="text-base font-bold tracking-tight text-white">Hawk AI</h1>
                            <p className="text-[9px] text-[#219EBC] uppercase font-bold tracking-widest leading-none">Smart Classroom</p>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {navItems.map((item) => {
                        const isActive = activeTab === item.id
                        return (
                            <button
                                key={item.id}
                                onClick={() => setActiveTab(item.id)}
                                title={sidebarCollapsed ? item.label : undefined}
                                className={cn(
                                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                                    isActive
                                        ? "bg-[#219EBC]/20 text-white border-l-4 border-[#219EBC] pl-2"
                                        : "text-slate-400 hover:text-white hover:bg-white/5"
                                )}
                            >
                                <item.icon className="size-5 shrink-0" />
                                {!sidebarCollapsed && <span>{item.label}</span>}
                            </button>
                        )
                    })}
                    <div className="pt-4 mt-4 border-t border-slate-800">
                        <button
                            onClick={() => setActiveTab("settings")}
                            title={sidebarCollapsed ? "System Settings" : undefined}
                            className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                                activeTab === "settings"
                                    ? "bg-[#219EBC]/20 text-white border-l-4 border-[#219EBC] pl-2"
                                    : "text-slate-400 hover:text-white hover:bg-white/5"
                            )}
                        >
                            <Settings className="size-5 shrink-0" />
                            {!sidebarCollapsed && <span>System Settings</span>}
                        </button>
                    </div>
                </nav>

                {/* Storage bar */}
                {!sidebarCollapsed && (
                    <div className="m-3 p-3 bg-[#219EBC]/10 rounded-xl border border-[#219EBC]/20">
                        <div className="flex items-center justify-between mb-2">
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-[#219EBC]">
                                <HardDrive className="size-3.5" /> Storage
                            </span>
                            <span className="text-xs text-slate-400">85%</span>
                        </div>
                        <div className="w-full bg-slate-800 rounded-full h-1.5">
                            <div className="bg-[#219EBC] h-1.5 rounded-full" style={{ width: "85%" }} />
                        </div>
                    </div>
                )}

                {/* Admin profile + logout */}
                <div className="border-t border-slate-800 p-3 space-y-1">
                    {!sidebarCollapsed && (
                        <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
                            <div className="size-8 rounded-full bg-[#219EBC] flex items-center justify-center text-xs font-bold text-white">
                                {adminName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-white truncate">{adminName}</p>
                                <p className="text-[10px] text-slate-400">Super Admin</p>
                            </div>
                        </div>
                    )}
                    <button onClick={handleLogout} title="Logout"
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors">
                        <LogOut className="size-4 shrink-0" />
                        {!sidebarCollapsed && "Logout"}
                    </button>
                    <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                        className="flex w-full items-center justify-center rounded-lg py-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors">
                        {sidebarCollapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col" style={{ marginLeft: sidebarWidth }}>
                {/* Top Navbar */}
                <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-[#023047]/80 backdrop-blur-md px-6">
                    <div className="flex items-center gap-4 flex-1">
                        <div className="relative max-w-sm w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                            <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onFocus={() => searchResults && setSearchOpen(true)}
                                type="text"
                                placeholder="Search teachers, classes, students..."
                                className="w-full pl-10 pr-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all"
                            />
                            {/* Search Results Dropdown */}
                            {searchOpen && searchResults && (
                                <div className="absolute top-full mt-1 w-full bg-[#023047] border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                                        <span className="text-xs text-slate-400">Search Results</span>
                                        <button onClick={() => { setSearchOpen(false); setSearchQuery("") }} className="text-slate-400 hover:text-white">
                                            <X className="size-3.5" />
                                        </button>
                                    </div>
                                    {[...searchResults.students.map(s => ({ label: s.name, sub: s.roll, type: "Student", tab: "students" as AdminTab })),
                                    ...searchResults.teachers.map(t => ({ label: t.name, sub: t.subject, type: "Teacher", tab: "teachers" as AdminTab })),
                                    ...searchResults.classes.map(c => ({ label: c.name, sub: "Class", type: "Class", tab: "classes" as AdminTab }))
                                    ].length === 0 ? (
                                        <p className="px-3 py-3 text-xs text-slate-400">No results for &quot;{searchQuery}&quot;</p>
                                    ) : (
                                        [...searchResults.students.map(s => ({ label: s.name, sub: s.roll, type: "Student", tab: "students" as AdminTab })),
                                        ...searchResults.teachers.map(t => ({ label: t.name, sub: t.subject, type: "Teacher", tab: "teachers" as AdminTab })),
                                        ...searchResults.classes.map(c => ({ label: c.name, sub: "Class", type: "Class", tab: "classes" as AdminTab }))]
                                            .map((item, i) => (
                                                <button key={i} onClick={() => { setActiveTab(item.tab); setSearchOpen(false); setSearchQuery("") }}
                                                    className="flex items-center gap-3 w-full px-3 py-2 hover:bg-slate-800 transition-colors text-left">
                                                    <span className="text-xs font-semibold text-[#219EBC] bg-[#219EBC]/10 px-1.5 py-0.5 rounded">{item.type}</span>
                                                    <div>
                                                        <p className="text-xs font-medium text-white">{item.label}</p>
                                                        <p className="text-[10px] text-slate-400">{item.sub}</p>
                                                    </div>
                                                </button>
                                            ))
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 rounded-full border border-green-500/20">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-[11px] font-bold text-green-500 uppercase tracking-wider">System Online</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="relative p-2 text-slate-400 hover:bg-slate-800 rounded-lg transition-colors">
                            <Bell className="size-5" />
                            <span className="absolute top-2 right-2 w-2 h-2 bg-[#219EBC] rounded-full border-2 border-[#023047]" />
                        </button>
                        <button onClick={toggleTheme} className="p-2 text-slate-400 hover:bg-slate-800 rounded-lg transition-colors">
                            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
                        </button>
                        <div className="h-8 w-px bg-slate-800 mx-1" />
                        <div className="flex items-center gap-2.5">
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-semibold text-white">{adminName}</p>
                                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-tight">Super Admin</p>
                            </div>
                            <div className="size-9 rounded-full bg-[#219EBC] border-2 border-[#219EBC] flex items-center justify-center text-xs font-bold text-white">
                                {adminName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                        </div>
                    </div>
                </header>

                {/* Content */}
                <main className="flex-1 overflow-y-auto p-8 relative">
                    {/* Watermark logo background */}
                    <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0">
                        <Image src="/newlogo.png" alt="" width={500} height={500} className="opacity-[0.03] select-none" />
                    </div>
                    <div className="relative z-10">
                        {activeTab === "dashboard" && <AdminOverview />}
                        {activeTab === "teachers" && <AdminTeachers />}
                        {activeTab === "students" && <AdminStudents />}
                        {activeTab === "classes" && <AdminClasses />}
                        {activeTab === "analytics" && <AdminAnalytics />}
                        {activeTab === "reports" && <AdminReports />}
                        {activeTab === "settings" && <AdminSettings />}
                    </div>
                </main>
            </div>
        </div>
    )
}
