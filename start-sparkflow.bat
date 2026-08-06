@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "ROOT=%SCRIPT_DIR:~0,-1%"
set "LOG_FILE=%ROOT%\vite-server.log"
set "ERR_FILE=%ROOT%\vite-server.err.log"

echo Starting SparkFlow in the background...

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\start-sparkflow.ps1" -Root "%ROOT%" -PreferredPort 5180

echo.
echo Logs:
echo   %LOG_FILE%
echo   %ERR_FILE%
echo.
pause
