@echo off
setlocal

set "ROOT=%~dp0"
set "PORT=5173"

echo Stopping SparkFlow...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = (Resolve-Path -LiteralPath '%ROOT%').Path; " ^
  "$state = Join-Path $root '.sparkflow'; " ^
  "$pidFiles = @((Join-Path $state 'vite-listener.pid'), (Join-Path $state 'vite.pid')); " ^
  "$ids = New-Object System.Collections.Generic.List[int]; " ^
  "foreach ($file in $pidFiles) { if (Test-Path -LiteralPath $file) { $raw = Get-Content -LiteralPath $file -ErrorAction SilentlyContinue | Select-Object -First 1; $parsed = 0; if ([int]::TryParse([string]$raw, [ref]$parsed)) { $ids.Add($parsed) | Out-Null } } } " ^
  "$listeners = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; " ^
  "foreach ($conn in $listeners) { if ($conn.OwningProcess) { $ids.Add([int]$conn.OwningProcess) | Out-Null } } " ^
  "$ids = $ids | Select-Object -Unique; " ^
  "function Stop-ProcessTree([int]$procId) { " ^
  "  $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $procId) -ErrorAction SilentlyContinue; " ^
  "  if (-not $proc) { return } " ^
  "  $cmd = [string]$proc.CommandLine; " ^
  "  $isListener = @(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $procId }).Count -gt 0; " ^
  "  $belongsHere = $isListener -or $cmd.Contains($root) -or $cmd.Contains('npm run dev') -or $cmd.Contains('vite'); " ^
  "  if (-not $belongsHere) { Write-Host ('Skip PID ' + $procId + ' because it does not look like SparkFlow.'); return } " ^
  "  Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $procId) -ErrorAction SilentlyContinue | ForEach-Object { Stop-ProcessTree ([int]$_.ProcessId) }; " ^
  "  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; " ^
  "  Write-Host ('Stopped PID ' + $procId); " ^
  "} " ^
  "if (-not $ids -or $ids.Count -eq 0) { Write-Host 'No SparkFlow process was found on port %PORT%.' } else { foreach ($id in $ids) { Stop-ProcessTree ([int]$id) } } " ^
  "Remove-Item -LiteralPath (Join-Path $state 'vite.pid') -Force -ErrorAction SilentlyContinue; " ^
  "Remove-Item -LiteralPath (Join-Path $state 'vite-listener.pid') -Force -ErrorAction SilentlyContinue; " ^
  "Start-Sleep -Milliseconds 400; " ^
  "$still = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; " ^
  "if ($still) { Write-Host ('Port %PORT% is still listening. PID: ' + (($still | Select-Object -First 1).OwningProcess)); exit 1 } else { Write-Host 'SparkFlow stopped.' }"

echo.
pause
