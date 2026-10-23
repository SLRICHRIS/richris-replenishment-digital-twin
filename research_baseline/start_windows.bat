@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -3 -m venv .venv
    if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements-backend.txt
if errorlevel 1 exit /b 1
".venv\Scripts\python.exe" -m uvicorn warehouse_twin.api:app --host 127.0.0.1 --port 8000
