"use client"

import dynamic from "next/dynamic"

const DashboardShell = dynamic(
    () => import("@/components/dashboard/dashboard-shell").then((mod) => mod.DashboardShell),
    { ssr: false }
)

export default function DashboardPage() {
    return <DashboardShell />
}
