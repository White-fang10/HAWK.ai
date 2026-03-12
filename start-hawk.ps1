$ErrorActionPreference = "Stop"

Write-Host "==================================" -ForegroundColor Cyan
Write-Host "   Hawk.ai Attendance Startup" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan

# Check if Python is installed
try {
    $pythonVersion = python --version
    Write-Host "Python detected: $pythonVersion" -ForegroundColor Green
}
catch {
    Write-Host "Python is not installed or not in PATH." -ForegroundColor Red
    exit
}

# Check if Node is installed
try {
    $nodeVersion = node --version
    Write-Host "Node.js detected: $nodeVersion" -ForegroundColor Green
}
catch {
    Write-Host "Node.js is not installed or not in PATH." -ForegroundColor Red
    exit
}

# Start Backend
Write-Host "`n[1/2] Starting FastAPI Backend..." -ForegroundColor Yellow

$backendDir = ".\backend"
if (Test-Path "$backendDir\venv\Scripts\python.exe") {
    Write-Host "Starting backend via virtual environment (Listening on all LAN interfaces)..." -ForegroundColor Green
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd $backendDir && .\venv\Scripts\activate && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2 --timeout-keep-alive 30" -NoNewWindow
}
else {
    Write-Host "Virtual environment not found! Please run setup first or check your python path." -ForegroundColor Red
    exit
}

# Wait a moment for backend to initialize
Start-Sleep -Seconds 3

# Start Frontend
Write-Host "`n[2/2] Starting Next.js Frontend..." -ForegroundColor Yellow
if (Test-Path "package.json") {
    # Using cmd.exe to ensure correct paths are resolved
    if (Get-Command "pnpm" -ErrorAction SilentlyContinue) {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c pnpm run dev" -NoNewWindow
    }
    else {
        Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev" -NoNewWindow
    }
}
else {
    Write-Host "Frontend package.json not found." -ForegroundColor Red
}

Write-Host "`nHawk.ai is now running!" -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend API: http://localhost:8000" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to terminate both." -ForegroundColor Yellow

# Keep the script running to keep the processes tied or wait for manual exit
while ($true) {
    Start-Sleep -Seconds 1
}
