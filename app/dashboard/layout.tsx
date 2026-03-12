import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "HAWK.AI - Smart Attendance Dashboard",
    description: "AI-powered classroom attendance tracking",
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
}
