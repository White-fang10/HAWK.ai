import type { Metadata } from "next"

export const metadata: Metadata = {
    title: "Hawk AI — Admin Dashboard",
    description: "Admin control panel for Hawk AI Smart Classroom System",
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
}
