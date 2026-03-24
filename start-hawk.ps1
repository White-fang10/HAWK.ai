#Requires -Version 5.0
$ErrorActionPreference = 'Continue'

# ─────────────────────────────────────────────────────────────
# FUNCTIONS (MUST BE AT TOP)
# ─────────────────────────────────────────────────────────────

function Type-Text($text, $delay = 2) {
    foreach ($char in $text.ToCharArray()) {
        Write-Host -NoNewline $char
        Start-Sleep -Milliseconds $delay
    }
    Write-Host ""
}

function Divider {
    Write-Host "--------------------------------------------------" -ForegroundColor DarkGray
}

function Spinner($scriptBlock) {
    $job = Start-Job $scriptBlock
    $spin = @('|', '/', '-', '\')
    $i = 0

    while ($job.State -eq "Running") {
        Write-Host -NoNewline "`r  $($spin[$i % 4]) Starting..." -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 120
        $i++
    }

    Receive-Job $job | Out-Null
    Remove-Job $job
    Write-Host "`r  OK Backend Ready        " -ForegroundColor Green
}

function Fake-Progress {
    param($text)

    Write-Host ""
    Type-Text $text

    $steps = @(
        "Initializing modules...",
        "Loading AI models...",
        "Preparing pipelines...",
        "Optimizing runtime...",
        "Finalizing startup..."
    )

    foreach ($step in $steps) {
        Write-Host "  -> $step" -ForegroundColor DarkGray
        Start-Sleep -Milliseconds 200
    }
}

function Show-Banner {
    Clear-Host

    Write-Host "  _   _    _    __        ___  __" -ForegroundColor Cyan
    Write-Host " | | | |  / \   \ \      / / |/ /" -ForegroundColor Cyan
    Write-Host " | |_| | / _ \   \ \ /\ / /| ' / " -ForegroundColor White
    Write-Host " |  _  |/ ___ \   \ V  V / | . \ " -ForegroundColor Gray
    Write-Host " |_| |_/_/   \_\   \_/\_/  |_|\_\" -ForegroundColor DarkGray

    Write-Host ""
    Write-Host "        HAWK.ai CLI - Burst Capture Edition" -ForegroundColor Yellow
    Write-Host ""
}

# ─────────────────────────────────────────────────────────────
# UI START
# ─────────────────────────────────────────────────────────────

Show-Banner
Fake-Progress "[BOOT] Initializing Hawk.ai..."

Divider
Write-Host "Usage: hawk [command]" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "Commands:" -ForegroundColor Yellow
Write-Host "  start     Launch system"
Write-Host "  backend   Run API"
Write-Host "  frontend  Run UI"
Write-Host "  test      Run tests"
Divider

# ─────────────────────────────────────────────────────────────
# ORIGINAL LOGIC BELOW (UNCHANGED)
# ─────────────────────────────────────────────────────────────

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $scriptRoot 'backend'
$frontendDir = $scriptRoot
$venvPython = Join-Path $backendDir 'venv\Scripts\python.exe'
$venvPip = Join-Path $backendDir 'venv\Scripts\pip.exe'

Write-Host ""
Type-Text "[CHECK] Running diagnostics..."
Divider

# Python
try {
    $pyVer = & python --version 2>&1
    Write-Host "  OK Python   : $pyVer" -ForegroundColor Green
}
catch {
    Write-Host "  ERR Python not found" -ForegroundColor Red
    exit 1
}

# Node
try {
    $nodeVer = & node --version 2>&1
    Write-Host "  OK Node.js  : $nodeVer" -ForegroundColor Green
}
catch {
    Write-Host "  ERR Node not found" -ForegroundColor Red
    exit 1
}

# venv
if (Test-Path $venvPython) {
    Write-Host "  OK venv     : Found" -ForegroundColor Green
}
else {
    Write-Host "  Creating venv..." -ForegroundColor Yellow
    & python -m venv (Join-Path $backendDir 'venv')
}

# Dependencies
Write-Host ""
Type-Text "[DEPS] Checking dependencies..."
Divider

$depsCheck = & $venvPython -c "import fastapi, insightface, onnxruntime, cv2; print('ok')" 2>&1

if ($depsCheck -notmatch "ok") {
    Write-Host "  Installing..." -ForegroundColor Yellow
    & $venvPip install -r (Join-Path $backendDir 'requirements.txt') --quiet
    Write-Host "  OK Installed" -ForegroundColor Green
}
else {
    Write-Host "  OK Already installed" -ForegroundColor Green
}

# Backend
Write-Host ""
Type-Text "[START] Backend (8000)..."

$backendCmd = "`"$venvPython`" -m uvicorn main:app --host 0.0.0.0 --port 8000"

Start-Process cmd.exe -ArgumentList "/k cd /d `"$backendDir`" && $backendCmd"

Spinner {
    Start-Sleep -Seconds 5
}

# Frontend
Write-Host ""
Type-Text "[START] Frontend (3000)..."

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $npmCmd = "pnpm"
}
else {
    $npmCmd = "npm"
}

Start-Process cmd.exe -ArgumentList "/k cd /d `"$frontendDir`" && $npmCmd run dev"

# Done
Write-Host ""
Divider
Write-Host "HAWK.ai is running!" -ForegroundColor Green
Divider

Write-Host "Dashboard: http://localhost:3000"
Write-Host "Backend : http://localhost:8000"

Read-Host "Press Enter to exit"