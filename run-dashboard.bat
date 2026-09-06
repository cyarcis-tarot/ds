@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 Node.js를 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
set NODE_OPTIONS=--use-system-ca
start "" "http://localhost:5177"
node server.js
pause
