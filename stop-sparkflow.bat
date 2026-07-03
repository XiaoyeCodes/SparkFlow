@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR:~0,-1%"

echo Stopping SparkFlow...

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\stop-sparkflow.ps1" -Root "%ROOT%" -FallbackPort 5173

echo.
pause
