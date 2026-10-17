@echo off
title WebGIS MSVT - Backend FastAPI
cd /d "%~dp0backend-fastapi"
echo [WebGIS MSVT] Dang khoi dong Backend FastAPI...
echo Swagger UI: http://127.0.0.1:8000/docs
".venv\Scripts\python.exe" run.py
pause
