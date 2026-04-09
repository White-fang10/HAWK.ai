# backend/camera_control.py
# ─────────────────────────────────────────────────────────────────────────────
# Camera control for the Raptor 65 smartboard.
#
# Zoom method cascade (auto-selects best available):
#   1. ADB over TCP  — full optical zoom, tap-to-focus
#   2. ONVIF PTZ     — PTZ zoom if board exposes ONVIF (ports 80/8080)
#   3. Software      — returns ok=False; frontend applies SR crop-zoom
#
# SETUP (ADB):
#   1. Install ADB: https://developer.android.com/tools/releases/platform-tools
#   2. Enable USB Debugging on the Raptor 65 (Settings → Developer Options)
#   3. Connect:  adb connect <RAPTOR_IP>:5555
#   4. Set env:  RAPTOR_IP=192.168.1.X  in backend/.env
#
# SETUP (ONVIF — HiSilicon boards with ADB disabled):
#   Just enter the board IP in the UI — ONVIF is probed automatically on ports 80/8080.
# ─────────────────────────────────────────────────────────────────────────────
import os
import subprocess
import threading
import time
import shutil
import glob
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from typing import Optional

# ── Config ────────────────────────────────────────────────────────────────────
_raptor_ip     = os.getenv("RAPTOR_IP", "")           # e.g. "192.168.1.100"
RAPTOR_PORT    = int(os.getenv("RAPTOR_ADB_PORT", "5555"))
ADB_TIMEOUT_S  = 5                                    # per-command timeout
ADB_SERIAL     = f"{_raptor_ip}:{RAPTOR_PORT}" if _raptor_ip else ""


def _find_adb() -> str:
    """
    Locate the adb executable even when PATH hasn't been refreshed in the
    current process (e.g. installed by winget after the server started).
    Returns the full path to adb.exe, or just 'adb' as a fallback.
    """
    # 1. Already on PATH?
    found = shutil.which("adb")
    if found:
        return found

    # 2. Search winget packages directory (Windows)
    local_app = os.environ.get("LOCALAPPDATA", "")
    if local_app:
        pattern = os.path.join(
            local_app,
            "Microsoft", "WinGet", "Packages",
            "*PlatformTools*", "platform-tools", "adb.exe"
        )
        matches = glob.glob(pattern)
        if matches:
            return matches[0]

    # 3. Common manual install locations
    candidates = [
        r"C:\platform-tools\adb.exe",
        r"C:\Android\platform-tools\adb.exe",
        os.path.expanduser(r"~\AppData\Local\Android\Sdk\platform-tools\adb.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c

    return "adb"  # last resort — will raise FileNotFoundError if truly missing


ADB_EXE = _find_adb()
print(f"[CameraControl] ADB executable: {ADB_EXE}")

# ── State ─────────────────────────────────────────────────────────────────────
_connected:     bool  = False
_connect_lock         = threading.Lock()
_current_zoom:  float = 1.0

# ONVIF state
_onvif_available: bool = False
_onvif_base_url:  str  = ""     # e.g. "http://192.168.1.100:80"
_onvif_lock             = threading.Lock()


# ── ADB helpers ───────────────────────────────────────────────────────────────

def _run(args: list[str]) -> tuple[bool, str]:
    """
    Run an ADB command, return (success, output).
    Automatically substitutes the resolved ADB path for the bare 'adb' token.
    """
    global ADB_EXE
    if ADB_EXE == "adb":
        ADB_EXE = _find_adb()

    if args and args[0] == "adb":
        args = [ADB_EXE] + args[1:]
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=ADB_TIMEOUT_S
        )
        ok  = result.returncode == 0
        out = (result.stdout + result.stderr).strip()
        return ok, out
    except subprocess.TimeoutExpired:
        return False, "ADB command timed out"
    except FileNotFoundError:
        return False, "adb not found — install Android Platform Tools"
    except Exception as e:
        return False, str(e)


# ── ADB connection management ─────────────────────────────────────────────────

def connect() -> dict:
    """
    Connect to the Raptor 65 via ADB-over-network.
    Safe to call multiple times — reconnects only when needed.
    Returns {connected: bool, message: str}.
    """
    global _connected

    if not _raptor_ip:
        return {
            "connected": False,
            "message":   "RAPTOR_IP not set — ADB disabled, software zoom will be used",
        }

    with _connect_lock:
        ok, out = _run(["adb", "connect", ADB_SERIAL])
        _connected = ok and ("connected" in out.lower() or "already" in out.lower())
        msg = out if _connected else f"ADB connect failed: {out}"
        if _connected:
            print(f"[CameraControl] ADB connected → {ADB_SERIAL}")
        else:
            print(f"[CameraControl] ADB not available: {msg}")
        return {"connected": _connected, "message": msg}


def reconnect(new_ip: str) -> dict:
    """
    Dynamically update the RAPTOR_IP and attempt fresh ADB + ONVIF probe.
    Used by the frontend to configure camera control without a restart.
    """
    global _raptor_ip, ADB_SERIAL, _connected

    if ADB_SERIAL:
        _run(["adb", "disconnect", ADB_SERIAL])

    _raptor_ip = new_ip.strip()
    ADB_SERIAL = f"{_raptor_ip}:{RAPTOR_PORT}" if _raptor_ip else ""
    _connected = False

    if not _raptor_ip:
        return {"connected": False, "message": "RAPTOR_IP cleared"}

    adb_result = connect()

    # Always probe ONVIF alongside ADB (parallel paths)
    if _raptor_ip:
        onvif_result = probe_onvif(_raptor_ip)
        adb_result["onvif_available"] = onvif_result["available"]
        adb_result["onvif_url"]       = onvif_result.get("url", "")

    return adb_result


def is_connected() -> bool:
    """Quick non-blocking check of current ADB connection state."""
    return _connected


# ── ONVIF probe ───────────────────────────────────────────────────────────────

def probe_onvif(ip: str) -> dict:
    """
    Try to find an ONVIF device service endpoint on the given IP.
    Checks ports 80 and 8080 at standard ONVIF paths.
    Sets _onvif_available and _onvif_base_url on success.

    Returns: {available: bool, url?: str}
    """
    global _onvif_available, _onvif_base_url

    ports = [80, 8080, 8000]
    paths = [
        "/onvif/device_service",
        "/onvif/device",
        "/onvif",
        "/",
    ]

    for port in ports:
        for path in paths:
            url = f"http://{ip}:{port}{path}"
            try:
                req = urllib.request.Request(url, method="GET")
                req.add_header("Content-Type", "application/soap+xml; charset=utf-8")
                req.add_header("User-Agent",   "HAWK.ai/1.0")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    body = resp.read(512).decode("utf-8", errors="ignore")
                    # ONVIF responses contain SOAP envelope or mention 'onvif'
                    if resp.status < 500 and (
                        "onvif" in body.lower()
                        or "envelope" in body.lower()
                        or "device" in body.lower()
                    ):
                        with _onvif_lock:
                            _onvif_available = True
                            _onvif_base_url  = f"http://{ip}:{port}"
                        print(f"[CameraControl] ONVIF found at {url}")
                        return {"available": True, "url": url}
            except Exception:
                continue

    with _onvif_lock:
        _onvif_available = False
        _onvif_base_url  = ""
    print(f"[CameraControl] ONVIF not found on {ip} (ports 80/8080/8000)")
    return {"available": False}


def _send_onvif_ptz(zoom: float, center_x_pct: float, center_y_pct: float) -> tuple[bool, str]:
    """
    Send ONVIF AbsoluteMove PTZ command.
    Zoom is normalised to [0.0, 1.0] for ONVIF (1.0 = max zoom).
    Pan/Tilt mapped from center percentages to [-1, 1].
    """
    if not _onvif_available or not _onvif_base_url:
        return False, "ONVIF not available"

    # Normalise zoom: HAWK uses 1.0–5.0, ONVIF uses 0.0–1.0
    z = round(min(1.0, max(0.0, (zoom - 1.0) / 4.0)), 3)
    # Pan: 0%→-1.0, 50%→0.0, 100%→+1.0
    pan  = round((center_x_pct * 2.0) - 1.0, 3)
    # Tilt: 0% (top)→+1.0, 100% (bottom)→-1.0
    tilt = round(1.0 - (center_y_pct * 2.0), 3)

    soap = f"""<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
               xmlns:ptz="http://www.onvif.org/ver20/ptz/wsdl"
               xmlns:tt="http://www.onvif.org/ver10/schema">
  <soap:Body>
    <ptz:AbsoluteMove>
      <ptz:ProfileToken>PROFILE_1</ptz:ProfileToken>
      <ptz:Position>
        <tt:PanTilt x="{pan}" y="{tilt}"/>
        <tt:Zoom x="{z}"/>
      </ptz:Position>
      <ptz:Speed>
        <tt:PanTilt x="0.5" y="0.5"/>
        <tt:Zoom x="0.5"/>
      </ptz:Speed>
    </ptz:AbsoluteMove>
  </soap:Body>
</soap:Envelope>"""

    url = f"{_onvif_base_url}/onvif/PTZ"
    try:
        req = urllib.request.Request(
            url,
            data=soap.encode("utf-8"),
            method="POST",
        )
        req.add_header("Content-Type", "application/soap+xml; charset=utf-8")
        req.add_header("SOAPAction",   '"http://www.onvif.org/ver20/ptz/wsdl/AbsoluteMove"')
        with urllib.request.urlopen(req, timeout=3) as resp:
            body = resp.read(256).decode("utf-8", errors="ignore")
            ok   = resp.status < 400
            return ok, body[:80]
    except Exception as e:
        return False, str(e)


# ── Public status ─────────────────────────────────────────────────────────────

def get_status() -> dict:
    """Return current hardware control state and zoom method."""
    if _connected:
        zoom_method = "adb"
    elif _onvif_available:
        zoom_method = "onvif"
    else:
        zoom_method = "software"

    return {
        "adb_configured":  bool(_raptor_ip),
        "adb_connected":   _connected,
        "onvif_available": _onvif_available,
        "onvif_url":       _onvif_base_url,
        "zoom_method":     zoom_method,
        "raptor_ip":       _raptor_ip or "",
        "current_zoom":    _current_zoom,
    }


# ── Zoom control ──────────────────────────────────────────────────────────────

def set_zoom(zoom: float, center_x_pct: float = 0.5, center_y_pct: float = 0.5) -> dict:
    """
    Set camera zoom level and focus on the given screen position.

    Cascade:
      1. ADB (if connected)    → optical zoom + tap-to-focus
      2. ONVIF (if available)  → PTZ AbsoluteMove
      3. Returns ok=False      → frontend uses software SR crop-zoom

    Args:
        zoom:          Zoom ratio (1.0 = wide, 3.0 = 3×, up to hardware max).
        center_x_pct:  Horizontal fraction 0.0–1.0 (left→right).
        center_y_pct:  Vertical fraction 0.0–1.0 (top→bottom).

    Returns:
        {ok: bool, method: "adb"|"onvif"|"software", message: str}
    """
    global _current_zoom
    _current_zoom = zoom
    zoom_clamped  = round(max(1.0, min(zoom, 10.0)), 2)

    # ── Path 1: ADB ──────────────────────────────────────────────────────────
    if _connected:
        results = []

        ok1, out1 = _run([
            "adb", "-s", ADB_SERIAL, "shell",
            "am", "broadcast",
            "-a", "com.android.camera.SET_ZOOM",
            "--ef", "zoom_ratio", str(zoom_clamped),
        ])
        results.append(f"broadcast={'ok' if ok1 else 'fail'}: {out1[:80]}")

        ok2, out2 = _run([
            "adb", "-s", ADB_SERIAL, "shell",
            "am", "broadcast",
            "-a", "com.raptor.camera.ZOOM",
            "--ef", "zoom", str(zoom_clamped),
        ])
        results.append(f"raptor_broadcast={'ok' if ok2 else 'fail'}: {out2[:80]}")

        screen_w, screen_h = _get_screen_resolution()
        tap_x = int(screen_w * center_x_pct)
        tap_y = int(screen_h * center_y_pct)

        ok3, out3 = _run([
            "adb", "-s", ADB_SERIAL, "shell",
            "input", "tap", str(tap_x), str(tap_y),
        ])
        results.append(f"tap({tap_x},{tap_y})={'ok' if ok3 else 'fail'}: {out3[:60]}")

        return {
            "ok":      ok1 or ok2 or ok3,
            "method":  "adb",
            "zoom":    zoom_clamped,
            "tap":     {"x": tap_x, "y": tap_y},
            "details": results,
        }

    # ── Path 2: ONVIF ────────────────────────────────────────────────────────
    if _onvif_available:
        ok, msg = _send_onvif_ptz(zoom_clamped, center_x_pct, center_y_pct)
        return {
            "ok":     ok,
            "method": "onvif",
            "zoom":   zoom_clamped,
            "message": msg,
        }

    # ── Path 3: Software fallback ────────────────────────────────────────────
    return {
        "ok":     False,
        "method": "software",
        "zoom":   zoom_clamped,
        "message": "No hardware zoom available — use software SR crop",
    }


def reset_zoom() -> dict:
    """Reset camera to 1× zoom (wide view)."""
    return set_zoom(1.0, 0.5, 0.5)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_screen_resolution() -> tuple[int, int]:
    """Query the Raptor's display resolution via ADB."""
    ok, out = _run(["adb", "-s", ADB_SERIAL, "shell", "wm", "size"])
    if ok and "x" in out:
        try:
            part = out.split(":")[-1].strip()
            w, h = part.split("x")
            return int(w), int(h)
        except Exception:
            pass
    return 1920, 1080  # safe default for Raptor 65


def disconnect() -> dict:
    """Disconnect ADB session."""
    global _connected
    if ADB_SERIAL:
        _run(["adb", "disconnect", ADB_SERIAL])
    _connected = False
    return {"disconnected": True}
