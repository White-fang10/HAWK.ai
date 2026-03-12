/** @type {import('next').NextConfig} */

// BACKEND_URL is set by start-hawk-lan.ps1 → cloudflared tunnel URL.
// When running locally (start-hawk.ps1), it falls back to http://localhost:8000.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ]
  },
  experimental: {
    // Increase proxy timeout so YOLO/InsightFace startup delay doesn't kill requests
    proxyTimeout: 120_000,
  },
  // Reuse TCP connections to backend to reduce connection churn
  httpAgentOptions: {
    keepAlive: true,
  },
}

export default nextConfig
