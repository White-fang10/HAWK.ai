import { useState } from "react";

const steps = [
    {
        id: 1,
        title: "Install MediaMTX on Smart Board",
        tag: "Smart Board",
        tagColor: "#0ea5e9",
        problem: "The Smart Board camera isn't broadcasting an RTSP stream yet — MediaMTX turns it into one.",
        commands: [
            {
                label: "Download MediaMTX (Windows)",
                code: `# Download from: https://github.com/bluenviron/mediamtx/releases\n# Extract the zip, you'll get mediamtx.exe`
            },
            {
                label: "Run MediaMTX",
                code: `mediamtx.exe\n# It starts an RTSP server on port 8554 by default`
            }
        ],
        note: "MediaMTX acts as the 'post office' — FFmpeg pushes video TO it, your backend PULLS from it."
    },
    {
        id: 2,
        title: "Stream Smart Board Camera via FFmpeg",
        tag: "Smart Board",
        tagColor: "#0ea5e9",
        problem: "FFmpeg captures the Smart Board webcam and pushes it to MediaMTX over LAN.",
        commands: [
            {
                label: "List available cameras (find your webcam name)",
                code: `ffmpeg -list_devices true -f dshow -i dummy`
            },
            {
                label: "Start streaming (replace camera name)",
                code: `ffmpeg -f dshow -i video="Integrated Camera" ^\n  -preset ultrafast ^\n  -vcodec libx264 ^\n  -tune zerolatency ^\n  -b:v 900k ^\n  -f rtsp rtsp://localhost:8554/classroom`
            }
        ],
        note: "The stream is now available at rtsp://<SMART_BOARD_IP>:8554/classroom"
    },
    {
        id: 3,
        title: "Find Smart Board's LAN IP Address",
        tag: "Smart Board",
        tagColor: "#0ea5e9",
        problem: "Your backend needs to know the Smart Board's IP to pull the RTSP stream.",
        commands: [
            {
                label: "Run this on the Smart Board",
                code: `ipconfig\n# Look for IPv4 Address under your Wi-Fi or Ethernet adapter\n# Example: 192.168.1.105`
            }
        ],
        note: "Write this IP down — you'll use it in the next step."
    },
    {
        id: 4,
        title: "Set RTSP_URL in Backend .env",
        tag: "Your PC (Server)",
        tagColor: "#8b5cf6",
        problem: "Your backend currently uses a default RTSP URL. Point it to the Smart Board.",
        commands: [
            {
                label: "Edit or create .env in your backend folder",
                code: `# Replace 192.168.1.105 with your Smart Board's actual IP\nRTSP_URL=rtsp://192.168.1.105:8554/classroom`
            },
            {
                label: "Verify pipeline.py reads it correctly",
                code: `# In pipeline.py, confirm this line exists:\nimport os\nrtsp_url = os.getenv("RTSP_URL", "rtsp://192.168.1.105:8554/classroom")\ncap = cv2.VideoCapture(rtsp_url)`
            }
        ],
        note: "Both machines must be on the same Wi-Fi / LAN network for this to work."
    },
    {
        id: 5,
        title: "Open Firewall Ports on Server PC",
        tag: "Your PC (Server)",
        tagColor: "#8b5cf6",
        problem: "Windows Firewall may block the Smart Board from reaching your backend.",
        commands: [
            {
                label: "Allow FastAPI port (run as Admin in PowerShell)",
                code: `netsh advfirewall firewall add rule name="FastAPI" dir=in action=allow protocol=TCP localport=8000`
            },
            {
                label: "Allow RTSP port on Smart Board (if MediaMTX is there)",
                code: `netsh advfirewall firewall add rule name="MediaMTX RTSP" dir=in action=allow protocol=TCP localport=8554`
            }
        ],
        note: "Skip if both PCs are on a trusted home/school LAN with firewall already off."
    },
    {
        id: 6,
        title: "Start Backend Server on Your PC",
        tag: "Your PC (Server)",
        tagColor: "#8b5cf6",
        problem: "Start FastAPI so it's accessible from other devices on the LAN.",
        commands: [
            {
                label: "Run with host 0.0.0.0 (critical for LAN access)",
                code: `uvicorn main:app --host 0.0.0.0 --port 8000 --reload\n# NOT just 'uvicorn main:app' — that only listens on localhost`
            },
            {
                label: "Get your Server PC's LAN IP",
                code: `ipconfig\n# Example result: 192.168.1.200`
            }
        ],
        note: "The dashboard and stream are now available at http://192.168.1.200:8000 from any LAN device."
    },
    {
        id: 7,
        title: "Update Frontend Stream URL",
        tag: "Frontend",
        tagColor: "#10b981",
        problem: "The <img> tag must point to your server's LAN IP, not localhost.",
        commands: [
            {
                label: "In live-monitor.tsx, update the src",
                code: `// Change this:\n<img src="http://localhost:8000/api/camera/stream" />\n\n// To this (use your server's LAN IP):\n<img src="http://192.168.1.200:8000/api/camera/stream" />`
            },
            {
                label: "Same for stats polling",
                code: `// Update your setInterval fetch URL too:\nfetch("http://192.168.1.200:8000/api/camera/stats")`
            }
        ],
        note: "Tip: Use an environment variable like NEXT_PUBLIC_API_URL so you don't hardcode the IP."
    },
    {
        id: 8,
        title: "Open Dashboard on Smart Board Browser",
        tag: "Smart Board",
        tagColor: "#0ea5e9",
        problem: "Final check — open the frontend from the Smart Board.",
        commands: [
            {
                label: "If using Next.js dev server",
                code: `# On your server PC, start frontend:\nnpm run dev\n\n# On Smart Board browser, open:\nhttp://192.168.1.200:3000/dashboard`
            },
            {
                label: "Verify the stream is working",
                code: `# Open this URL directly in Smart Board browser:\nhttp://192.168.1.200:8000/api/camera/stream\n# You should see the live YOLO-processed feed`
            }
        ],
        note: "If the stream URL shows a broken image, check firewall rules (Step 5) first."
    }
];

export default function LANGuide() {
    const [completed, setCompleted] = useState({});
    const [expanded, setExpanded] = useState({ 1: true });
    const [copied, setCopied] = useState({});

    const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));
    const check = (id) => setCompleted(c => ({ ...c, [id]: !c[id] }));
    const copy = (text, key) => {
        navigator.clipboard.writeText(text);
        setCopied(c => ({ ...c, [key]: true }));
        setTimeout(() => setCopied(c => ({ ...c, [key]: false })), 1500);
    };

    const done = Object.values(completed).filter(Boolean).length;

    return (
        <div style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", background: "#0d1117", minHeight: "100vh", padding: "2rem 1rem", color: "#e6edf3" }}>
            <div style={{ maxWidth: 720, margin: "0 auto" }}>

                {/* Header */}
                <div style={{ marginBottom: "2rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                        <span style={{ fontSize: "1.5rem" }}>🎓</span>
                        <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 700, color: "#f0f6fc", letterSpacing: "-0.02em" }}>
                            Auto-Attendance LAN Deployment
                        </h1>
                    </div>
                    <p style={{ margin: 0, color: "#8b949e", fontSize: "0.8rem" }}>Smart Board → RTSP → Backend Server → Dashboard</p>

                    {/* Progress bar */}
                    <div style={{ marginTop: "1rem", background: "#161b22", borderRadius: 8, padding: "0.75rem 1rem", border: "1px solid #30363d" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                            <span style={{ fontSize: "0.75rem", color: "#8b949e" }}>Progress</span>
                            <span style={{ fontSize: "0.75rem", color: "#58a6ff" }}>{done} / {steps.length} steps complete</span>
                        </div>
                        <div style={{ background: "#21262d", borderRadius: 4, height: 6 }}>
                            <div style={{ background: "linear-gradient(90deg, #1f6feb, #58a6ff)", height: "100%", borderRadius: 4, width: `${(done / steps.length) * 100}%`, transition: "width 0.4s ease" }} />
                        </div>
                    </div>
                </div>

                {/* Architecture diagram */}
                <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: "1rem", marginBottom: "1.5rem", fontSize: "0.78rem", color: "#8b949e", textAlign: "center" }}>
                    <span style={{ color: "#0ea5e9" }}>📷 Smart Board Camera</span>
                    <span style={{ color: "#30363d", margin: "0 0.5rem" }}>──FFmpeg──▶</span>
                    <span style={{ color: "#0ea5e9" }}>MediaMTX (RTSP :8554)</span>
                    <span style={{ color: "#30363d", margin: "0 0.5rem" }}>──LAN──▶</span>
                    <span style={{ color: "#8b5cf6" }}>Backend PC (YOLO)</span>
                    <span style={{ color: "#30363d", margin: "0 0.5rem" }}>──HTTP──▶</span>
                    <span style={{ color: "#10b981" }}>Dashboard Browser</span>
                </div>

                {/* Steps */}
                {steps.map((step) => (
                    <div key={step.id} style={{ marginBottom: "0.75rem", background: "#161b22", border: `1px solid ${completed[step.id] ? "#238636" : "#30363d"}`, borderRadius: 10, overflow: "hidden", transition: "border-color 0.3s" }}>

                        {/* Step header */}
                        <div
                            style={{ display: "flex", alignItems: "center", padding: "0.875rem 1rem", cursor: "pointer", userSelect: "none" }}
                            onClick={() => toggle(step.id)}
                        >
                            <button
                                onClick={(e) => { e.stopPropagation(); check(step.id); }}
                                style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${completed[step.id] ? "#238636" : "#30363d"}`, background: completed[step.id] ? "#238636" : "transparent", color: "white", fontSize: "0.7rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: "0.75rem" }}
                            >
                                {completed[step.id] ? "✓" : ""}
                            </button>

                            <span style={{ background: "#21262d", color: "#8b949e", borderRadius: 4, padding: "0.1rem 0.5rem", fontSize: "0.7rem", marginRight: "0.75rem", flexShrink: 0 }}>
                                {step.id < 10 ? `0${step.id}` : step.id}
                            </span>

                            <span style={{ flex: 1, fontSize: "0.85rem", fontWeight: 600, color: completed[step.id] ? "#3fb950" : "#f0f6fc" }}>
                                {step.title}
                            </span>

                            <span style={{ background: step.tagColor + "22", color: step.tagColor, border: `1px solid ${step.tagColor}44`, borderRadius: 4, padding: "0.1rem 0.5rem", fontSize: "0.68rem", marginRight: "0.5rem", flexShrink: 0 }}>
                                {step.tag}
                            </span>

                            <span style={{ color: "#8b949e", fontSize: "0.8rem", transform: expanded[step.id] ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}>▶</span>
                        </div>

                        {/* Expanded content */}
                        {expanded[step.id] && (
                            <div style={{ borderTop: "1px solid #21262d", padding: "1rem" }}>
                                <p style={{ margin: "0 0 1rem 0", color: "#8b949e", fontSize: "0.78rem", lineHeight: 1.6 }}>
                                    💡 {step.problem}
                                </p>

                                {step.commands.map((cmd, i) => (
                                    <div key={i} style={{ marginBottom: "0.75rem" }}>
                                        <div style={{ fontSize: "0.72rem", color: "#8b949e", marginBottom: "0.3rem" }}>{cmd.label}</div>
                                        <div style={{ position: "relative", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "0.75rem 3rem 0.75rem 0.875rem" }}>
                                            <pre style={{ margin: 0, fontSize: "0.75rem", color: "#79c0ff", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{cmd.code}</pre>
                                            <button
                                                onClick={() => copy(cmd.code, `${step.id}-${i}`)}
                                                style={{ position: "absolute", top: "0.5rem", right: "0.5rem", background: "#21262d", border: "1px solid #30363d", borderRadius: 4, color: "#8b949e", padding: "0.2rem 0.4rem", fontSize: "0.65rem", cursor: "pointer" }}
                                            >
                                                {copied[`${step.id}-${i}`] ? "✓" : "copy"}
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                <div style={{ background: "#1c2128", borderLeft: "3px solid #f0883e", borderRadius: "0 6px 6px 0", padding: "0.6rem 0.75rem", fontSize: "0.75rem", color: "#d29922", lineHeight: 1.5 }}>
                                    ⚠️ {step.note}
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                <div style={{ textAlign: "center", marginTop: "1.5rem", color: "#8b949e", fontSize: "0.75rem" }}>
                    {done === steps.length ? "🎉 All steps complete! Your system should be live on LAN." : "Check each step as you complete it →"}
                </div>
            </div>
        </div>
    );
}
