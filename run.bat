@echo off
title CivicGuide AI — Full Stack Launcher
color 0A

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║         CivicGuide AI — Launcher                ║
echo  ║   Backend (Flask :5000) + Frontend (HTTP :5500)  ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: ── Check Python ────────────────────────────────────────
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo         Install Python 3.10+ from https://python.org
    pause
    exit /b 1
)

:: ── Install backend dependencies (if needed) ───────────
echo [1/4] Installing backend dependencies...
pip install -r "%~dp0backend\requirements.txt" --quiet 2>nul
echo       Done.
echo.

:: ── Check for .env / API key ────────────────────────────
if not exist "%~dp0backend\.env" (
    echo [WARN] No .env file found in backend\
    echo        Create backend\.env with:  GROQ_API_KEY=your_key_here
    echo        Chat will not work without it.
    echo.
)

:: ── Start Flask Backend (background) ────────────────────
echo [2/4] Starting Flask backend on http://127.0.0.1:5000 ...
start "CivicGuide-Backend" /D "%~dp0backend" python app.py
echo       Backend starting in new window.
echo.

:: ── Wait for backend to boot ────────────────────────────
echo [3/4] Waiting for backend to become ready...
ping 127.0.0.1 -n 4 >nul

:: ── Start Frontend HTTP Server ──────────────────────────
echo [4/4] Starting frontend server on http://127.0.0.1:5500 ...
start "CivicGuide-Frontend" /D "%~dp0frontend" python -m http.server 5500
echo       Frontend starting in new window.
echo.

:: ── Wait a moment, then open browser ────────────────────
ping 127.0.0.1 -n 3 >nul

echo  ===================================================
echo    CivicGuide AI is running!
echo.
echo    Frontend : http://127.0.0.1:5500
echo    Backend  : http://127.0.0.1:5000
echo    API Docs : http://127.0.0.1:5000/api/status
echo.
echo    Pages:
echo      Home        = http://127.0.0.1:5500
echo      Chat        = http://127.0.0.1:5500/chat.html
echo      Eligibility = http://127.0.0.1:5500/eligibility.html
echo      Timeline    = http://127.0.0.1:5500/timeline.html
echo      Booths      = http://127.0.0.1:5500/booths.html
echo.
echo    Close this window to stop all servers.
echo  ===================================================
echo.

:: ── Open browser to the landing page ────────────────────
start "" "http://127.0.0.1:5500"

echo Press any key to STOP all servers and exit...
pause >nul

:: ── Cleanup: kill both server windows ───────────────────
echo.
echo Shutting down servers...
taskkill /FI "WINDOWTITLE eq CivicGuide-Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CivicGuide-Frontend*" /F >nul 2>&1
echo Done. Goodbye!
ping 127.0.0.1 -n 3 >nul
