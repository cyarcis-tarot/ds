@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 강릉시 아파트 거래 대시보드를 실행합니다.
echo 잠시만 기다리면 브라우저가 자동으로 열립니다.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-dashboard.ps1"
if errorlevel 1 (
  echo.
  echo 실행에 실패했습니다.
  echo 이 폴더의 dashboard.log, dashboard-server.log, dashboard-server-error.log를 확인하세요.
  pause
  exit /b 1
)
exit /b 0
