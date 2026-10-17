@echo off
title WebGIS MSVT - Launcher
cd /d "%~dp0"

echo [1/3] Khoi dong Database PostGIS container (neu co Docker)...
docker start webgis_postgis >nul 2>&1

echo [2/3] Khoi dong Backend FastAPI (Port 8000)...
start "WebGIS MSVT - Backend FastAPI" cmd /k "cd /d "%~dp0backend-fastapi" && .venv\Scripts\python.exe run.py"

echo [3/3] Khoi dong Frontend React (Port 5173)...
start "WebGIS MSVT - Frontend React" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ======================================================
echo  WebGIS MSVT da duoc khoi dong thanh cong!
echo  - Frontend: http://localhost:5173
echo  - Backend Docs: http://127.0.0.1:8000/docs
echo ======================================================
timeout /t 5
