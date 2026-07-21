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

function Test-PortAvailable([int]$Port) {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try {
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    try { $listener.Stop() } catch { }
  }
}

function Test-PortListening([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    return $task.Wait(350) -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-ListenerProcessId([int]$Port) {
  $pattern = "^\s*TCP\s+127\.0\.0\.1:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$"
  foreach ($line in (& netstat -ano -p tcp 2>$null)) {
    if ($line -match $pattern) {
      return [int]$Matches[1]
    }
  }
  return 0
}

$existingPort = 0
if ((Test-Path -LiteralPath $portFile) -and [int]::TryParse([string](Get-Content -LiteralPath $portFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$existingPort)) {
  if (Test-PortListening $existingPort) {
    Write-Host "SparkFlow is already running at http://127.0.0.1:$existingPort/"
    $existingListenerPid = Get-ListenerProcessId $existingPort
    if ($existingListenerPid -gt 0) {
      Write-Host "Listener PID: $existingListenerPid"
    }
    Write-Host 'Use stop-sparkflow.bat to stop it.'
    exit 0
  }
}

$packageLockPath = Join-Path $rootPath 'package-lock.json'
$nodeModulesPath = Join-Path $rootPath 'node_modules'
$nodeMarkerPath = Join-Path $stateDir 'npm-dependencies'
$npmCommand = Get-Command 'npm' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $npmCommand) {
  throw 'Node.js and npm are required. Install Node.js 20+ and start SparkFlow again.'
}
if (-not (Test-Path -LiteralPath $packageLockPath)) {
  throw "Missing package-lock.json: $packageLockPath"
}

$packageLockHash = (Get-FileHash -LiteralPath $packageLockPath -Algorithm SHA256).Hash
$installedNodeHash = if (Test-Path -LiteralPath $nodeMarkerPath) {
  [string](Get-Content -LiteralPath $nodeMarkerPath -ErrorAction SilentlyContinue | Select-Object -First 1)
} else {
  ''
}
if (-not (Test-Path -LiteralPath $nodeModulesPath) -or $installedNodeHash.Trim() -ne $packageLockHash) {
  Write-Host 'Installing SparkFlow frontend dependencies...'
  & $npmCommand.Source ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to install SparkFlow frontend dependencies.'
  }
  Set-Content -LiteralPath $nodeMarkerPath -Value $packageLockHash -Encoding ascii
}

$bootstrapScript = Join-Path $rootPath 'scripts\bootstrap-vibe-trading.ps1'
Write-Host 'Checking the bundled research runtime...'
& $bootstrapScript -Root $rootPath
if ($LASTEXITCODE -ne 0) {
  throw 'The bundled research runtime could not be prepared.'
}

$port = $PreferredPort
$maxPort = $PreferredPort + 100
while (-not (Test-PortAvailable $port)) {
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

$listenerPid = 0
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  if (Test-PortListening $port) {
    $listenerPid = Get-ListenerProcessId $port
    break
  }
}
if ($listenerPid -gt 0) {
  Set-Content -LiteralPath $listenerPidFile -Value $listenerPid -Encoding ascii
  Write-Host "SparkFlow started: http://127.0.0.1:$port/"
  Write-Host "Launcher PID: $($process.Id)"
  Write-Host "Listener PID: $listenerPid"
} elseif (Test-PortListening $port) {
  Write-Host "SparkFlow started: http://127.0.0.1:$port/"
  Write-Host "Launcher PID: $($process.Id)"
} else {
  Write-Host "SparkFlow launch command was sent, but port $port is not listening yet."
  Write-Host 'Check vite-server.log and vite-server.err.log.'
  Write-Host "Launcher PID: $($process.Id)"
}
