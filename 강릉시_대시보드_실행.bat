@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-dashboard.ps1"
if errorlevel 1 (
  echo.
  echo Dashboard failed to start.
  echo Check dashboard.log, dashboard-server.log, and dashboard-server-error.log in this folder.
  pause
  exit /b 1
)
exit /b 0
