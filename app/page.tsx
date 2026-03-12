"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Eye, EyeOff, Shield, Users, Loader2, AlertCircle, UserPlus, ArrowLeft } from "lucide-react"

type LoginMode = "user" | "admin"
type AdminView = "signin" | "register"

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<LoginMode>("user")
  const [adminView, setAdminView] = useState<AdminView>("signin")

  // Sign-in state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Register state
  const [regName, setRegName] = useState("")
  const [regEmail, setRegEmail] = useState("")
  const [regPassword, setRegPassword] = useState("")
  const [regConfirm, setRegConfirm] = useState("")
  const [showRegPass, setShowRegPass] = useState(false)
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState("")
  const [regSuccess, setRegSuccess] = useState("")

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || "Invalid email or password")
        return
      }
      const data = await res.json()
      localStorage.setItem("hawk_token", data.token)
      localStorage.setItem("hawk_role", data.role)
      localStorage.setItem("hawk_name", data.name)
      localStorage.setItem("hawk_email", data.email)
      router.push(data.role === "admin" ? "/admin" : "/dashboard")
    } catch {
      setError("Cannot connect to backend. Please make sure the server is running.")
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setRegError("")
    setRegSuccess("")
    if (regPassword !== regConfirm) {
      setRegError("Passwords do not match")
      return
    }
    if (regPassword.length < 6) {
      setRegError("Password must be at least 6 characters")
      return
    }
    setRegLoading(true)
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: regName, email: regEmail, password: regPassword, role: "admin" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRegError(data.detail || "Registration failed")
        return
      }
      setRegSuccess("Account created! You can now sign in with your credentials.")
      setRegName(""); setRegEmail(""); setRegPassword(""); setRegConfirm("")
      setTimeout(() => { setAdminView("signin"); setRegSuccess("") }, 2500)
    } catch {
      setRegError("Cannot connect to backend. Please make sure the server is running.")
    } finally {
      setRegLoading(false)
    }
  }

  const switchMode = (m: LoginMode) => {
    setMode(m)
    setAdminView("signin")
    setError(""); setRegError(""); setRegSuccess("")
  }

  return (
    <div className="min-h-screen bg-[#011a27] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] bg-[#219EBC]/8 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-[#1E3A5F]/8 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1.5s" }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-[#023047]/60 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "linear-gradient(#219EBC 1px, transparent 1px), linear-gradient(90deg, #219EBC 1px, transparent 1px)",
          backgroundSize: "60px 60px"
        }} />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="relative inline-flex flex-col items-center">
            {/* Multi-layer glow */}
            <div className="absolute -inset-6 rounded-full bg-[#219EBC]/20 blur-2xl -z-10" />
            <div className="absolute -inset-2 rounded-2xl bg-[#219EBC]/10 blur-xl -z-10" />
            {/* Logo container */}
            <div
              className="relative rounded-2xl overflow-hidden border border-[#219EBC]/30 shadow-xl shadow-[#219EBC]/30"
              style={{ width: 150, height: 150, background: "rgba(2,48,71,0.7)", backdropFilter: "blur(8px)" }}
            >
              <Image
                src="/newlogo.png"
                alt="Hawk AI"
                fill
                className="object-contain p-3"
                style={{ filter: "drop-shadow(0 0 12px rgba(33,158,188,0.6)) brightness(1.1)" }}
                priority
              />
            </div>
          </div>
          <p className="text-[#8ECAE6] text-xs font-medium tracking-[0.2em] uppercase mt-4">Hawk-Powered Visibility for Every Classroom</p>
        </div>

        {/* Mode Toggle */}
        <div className="flex rounded-xl overflow-hidden border border-[rgba(255,255,255,0.08)] mb-5 p-1 bg-[#023047]/60 backdrop-blur-sm">
          <button type="button" onClick={() => switchMode("user")}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${mode === "user" ? "bg-[#219EBC] text-white shadow-lg shadow-[#219EBC]/30" : "text-[#8ECAE6] hover:text-white"
              }`}>
            <Users className="w-4 h-4" /> User Dashboard
          </button>
          <button type="button" onClick={() => switchMode("admin")}
            className={`flex flex-1 items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all duration-200 ${mode === "admin" ? "bg-[#219EBC] text-white shadow-lg shadow-[#219EBC]/30" : "text-[#8ECAE6] hover:text-white"
              }`}>
            <Shield className="w-4 h-4" /> Admin Panel
          </button>
        </div>

        {/* Card */}
        <div className="bg-[#023047]/80 backdrop-blur-md border border-[rgba(255,255,255,0.08)] rounded-2xl p-8 shadow-2xl">

          {/* ── USER LOGIN ── */}
          {mode === "user" && (
            <>
              <div className="mb-5">
                <h2 className="text-xl font-bold text-white">Staff Sign In</h2>
                <p className="text-[#8ECAE6] text-sm mt-1">Access your classroom dashboard</p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Email Address</label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="user@hawkai.edu"
                    suppressHydrationWarning
                    className="w-full px-4 py-2.5 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Password</label>
                  <div className="relative">
                    <input type={showPassword ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      suppressHydrationWarning
                      className="w-full px-4 py-2.5 pr-10 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8ECAE6]/60 hover:text-white transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                )}
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#219EBC] text-white font-bold text-sm shadow-lg shadow-[#219EBC]/25 hover:bg-[#1A8BA8] transition-all active:scale-95 disabled:opacity-60">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : "Sign In to Dashboard"}
                </button>
              </form>
              <div className="mt-5 pt-4 border-t border-[rgba(255,255,255,0.07)]">
                <p className="text-center text-xs text-[#8ECAE6]/60">
                  Accounts are provisioned by your institution admin.
                </p>
              </div>
            </>
          )}

          {/* ── ADMIN SIGN IN ── */}
          {mode === "admin" && adminView === "signin" && (
            <>
              <div className="mb-5">
                <h2 className="text-xl font-bold text-white">Administrator Sign In</h2>
                <p className="text-[#8ECAE6] text-sm mt-1">Access the Hawk AI control panel</p>
              </div>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Email Address</label>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@hawkai.edu"
                    suppressHydrationWarning
                    className="w-full px-4 py-2.5 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Password</label>
                  <div className="relative">
                    <input type={showPassword ? "text" : "password"} required value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      suppressHydrationWarning
                      className="w-full px-4 py-2.5 pr-10 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8ECAE6]/60 hover:text-white transition-colors">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400">{error}</p>
                  </div>
                )}
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#219EBC] text-white font-bold text-sm shadow-lg shadow-[#219EBC]/25 hover:bg-[#1A8BA8] transition-all active:scale-95 disabled:opacity-60">
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : "Sign In to Admin Panel"}
                </button>
              </form>

              {/* Register link */}
              <div className="mt-5 pt-4 border-t border-[rgba(255,255,255,0.07)]">
                <button onClick={() => { setAdminView("register"); setError("") }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[#219EBC]/40 text-[#219EBC] text-sm font-semibold hover:bg-[#219EBC]/10 transition-all">
                  <UserPlus className="w-4 h-4" />
                  New Admin Registration
                </button>
              </div>
            </>
          )}

          {/* ── ADMIN REGISTER ── */}
          {mode === "admin" && adminView === "register" && (
            <>
              <div className="flex items-center gap-3 mb-5">
                <button onClick={() => { setAdminView("signin"); setRegError(""); setRegSuccess("") }}
                  className="p-1.5 rounded-lg text-[#8ECAE6] hover:bg-slate-800 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-xl font-bold text-white">New Admin Registration</h2>
                  <p className="text-[#8ECAE6] text-sm">Create your admin account</p>
                </div>
              </div>
              <form onSubmit={handleRegister} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Full Name *</label>
                  <input required value={regName} onChange={e => setRegName(e.target.value)}
                    placeholder="e.g. Dr. John Smith"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Email Address *</label>
                  <input type="email" required value={regEmail} onChange={e => setRegEmail(e.target.value)}
                    placeholder="admin@hawkai.edu"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Password *</label>
                  <div className="relative">
                    <input type={showRegPass ? "text" : "password"} required value={regPassword} onChange={e => setRegPassword(e.target.value)}
                      placeholder="Minimum 6 characters" minLength={6}
                      className="w-full px-4 py-2.5 pr-10 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                    <button type="button" onClick={() => setShowRegPass(!showRegPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8ECAE6]/60 hover:text-white transition-colors">
                      {showRegPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8ECAE6] mb-1.5 uppercase tracking-wider">Confirm Password *</label>
                  <input type="password" required value={regConfirm} onChange={e => setRegConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#011a27]/80 border border-[rgba(255,255,255,0.1)] text-white placeholder:text-[#8ECAE6]/40 focus:outline-none focus:ring-2 focus:ring-[#219EBC]/50 transition-all text-sm" />
                </div>

                {regError && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-400">{regError}</p>
                  </div>
                )}
                {regSuccess && (
                  <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                    <p className="text-xs text-green-400 text-center">✓ {regSuccess}</p>
                  </div>
                )}

                <button type="submit" disabled={regLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#219EBC] text-white font-bold text-sm shadow-lg shadow-[#219EBC]/25 hover:bg-[#1A8BA8] transition-all active:scale-95 disabled:opacity-60 mt-1">
                  {regLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating Account...</> : <><UserPlus className="w-4 h-4" /> Create Admin Account</>}
                </button>
              </form>

              <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.07)]">
                <p className="text-center text-xs text-[#8ECAE6]/50">
                  Already have an account?{" "}
                  <button onClick={() => setAdminView("signin")} className="text-[#219EBC] font-semibold hover:underline">
                    Sign in
                  </button>
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[#8ECAE6]/25 text-[11px] mt-5 tracking-wide">
          © 2024 Hawk.AI Smart Classroom System · All rights reserved
        </p>
      </div>
    </div>
  )
}
