@echo off
rem Start the production stack (FastAPI + built frontend) for the Cloudflare tunnel.
rem Runs at logon from the per-user Startup folder; no admin rights required.
cd /d "%~dp0.."
start "" /b "%~dp0..\backend\.venv\Scripts\pythonw.exe" "%~dp0run_prod.py"
