@echo off
setlocal

set "ROOT=%~dp0"
set "PORT=5173"
set "STATE_DIR=%ROOT%.sparkflow"
set "LOG_FILE=%ROOT%vite-server.log"
set "ERR_FILE=%ROOT%vite-server.err.log"

if not exist "%STATE_DIR%" mkdir "%STATE_DIR%" >nul 2>nul

set "EXISTING_PID="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$conn = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { $conn.OwningProcess }"`) do set "EXISTING_PID=%%P"

if defined EXISTING_PID (
  echo SparkFlow is already running at http://127.0.0.1:%PORT%/
  echo Listener PID: %EXISTING_PID%
  echo Use stop-sparkflow.bat to stop it.
  pause
  exit /b 0
)

echo Starting SparkFlow in the background...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = (Resolve-Path -LiteralPath '%ROOT%').Path; " ^
  "$state = Join-Path $root '.sparkflow'; " ^
  "$pidFile = Join-Path $state 'vite.pid'; " ^
  "$listenerPidFile = Join-Path $state 'vite-listener.pid'; " ^
  "$log = Join-Path $root 'vite-server.log'; " ^
  "$err = Join-Path $root 'vite-server.err.log'; " ^
  "New-Item -ItemType Directory -Force -Path $state | Out-Null; " ^
  "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/d','/c','npm run dev -- --port %PORT%') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err -PassThru; " ^
  "Set-Content -LiteralPath $pidFile -Value $p.Id -Encoding ascii; " ^
  "Start-Sleep -Seconds 2; " ^
  "$conn = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; " ^
  "if ($conn) { Set-Content -LiteralPath $listenerPidFile -Value $conn.OwningProcess -Encoding ascii; Write-Host ('SparkFlow started: http://127.0.0.1:%PORT%/'); Write-Host ('Launcher PID: ' + $p.Id); Write-Host ('Listener PID: ' + $conn.OwningProcess); } " ^
  "else { Write-Host 'SparkFlow launch command was sent, but port %PORT% is not listening yet. Check vite-server.log and vite-server.err.log.'; Write-Host ('Launcher PID: ' + $p.Id); }"

echo.
echo Logs:
echo   %LOG_FILE%
echo   %ERR_FILE%
echo.
pause
