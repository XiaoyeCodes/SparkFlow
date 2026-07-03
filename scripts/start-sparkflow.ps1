param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [int]$PreferredPort = 5173
)

$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$stateDir = Join-Path $rootPath '.sparkflow'
$pidFile = Join-Path $stateDir 'vite.pid'
$listenerPidFile = Join-Path $stateDir 'vite-listener.pid'
$portFile = Join-Path $stateDir 'vite.port'
$logFile = Join-Path $rootPath 'vite-server.log'
$errFile = Join-Path $rootPath 'vite-server.err.log'

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$existingPort = 0
if ((Test-Path -LiteralPath $portFile) -and [int]::TryParse([string](Get-Content -LiteralPath $portFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$existingPort)) {
  $existing = Get-NetTCPConnection -LocalPort $existingPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing) {
    Write-Host "SparkFlow is already running at http://127.0.0.1:$existingPort/"
    Write-Host "Listener PID: $($existing.OwningProcess)"
    Write-Host 'Use stop-sparkflow.bat to stop it.'
    exit 0
  }
}

$port = $PreferredPort
$maxPort = $PreferredPort + 100
while (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  if ($port -eq $PreferredPort) {
    Write-Host "Port $PreferredPort is busy; searching for a free port..."
  }
  $port += 1
  if ($port -gt $maxPort) {
    throw "Could not find a free port in range $PreferredPort-$maxPort."
  }
}

$command = "npm run dev -- --port $port --strictPort"
$process = Start-Process `
  -FilePath 'cmd.exe' `
  -ArgumentList @('/d', '/c', $command) `
  -WorkingDirectory $rootPath `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logFile `
  -RedirectStandardError $errFile `
  -PassThru

Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii
Set-Content -LiteralPath $portFile -Value $port -Encoding ascii

$conn = $null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    break
  }
}
if ($conn) {
  Set-Content -LiteralPath $listenerPidFile -Value $conn.OwningProcess -Encoding ascii
  Write-Host "SparkFlow started: http://127.0.0.1:$port/"
  Write-Host "Launcher PID: $($process.Id)"
  Write-Host "Listener PID: $($conn.OwningProcess)"
} else {
  Write-Host "SparkFlow launch command was sent, but port $port is not listening yet."
  Write-Host 'Check vite-server.log and vite-server.err.log.'
  Write-Host "Launcher PID: $($process.Id)"
}
