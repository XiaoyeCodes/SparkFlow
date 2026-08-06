param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [int]$FallbackPort = 5180
)

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$stateDir = Join-Path $rootPath '.sparkflow'
$portFile = Join-Path $stateDir 'vite.port'
$vibePortFile = Join-Path $stateDir 'vibe.port'
$pidFiles = @(
  (Join-Path $stateDir 'vite-listener.pid'),
  (Join-Path $stateDir 'vite.pid'),
  (Join-Path $stateDir 'vibe.pid')
)

$port = $FallbackPort
$hasRecordedPort = $false
if ((Test-Path -LiteralPath $portFile) -and [int]::TryParse([string](Get-Content -LiteralPath $portFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$port)) {
  $hasRecordedPort = $true
}

$vibePort = 0
$hasRecordedVibePort = $false
if ((Test-Path -LiteralPath $vibePortFile) -and [int]::TryParse([string](Get-Content -LiteralPath $vibePortFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$vibePort)) {
  $hasRecordedVibePort = $true
}

$ids = New-Object System.Collections.Generic.List[int]

foreach ($file in $pidFiles) {
  if (Test-Path -LiteralPath $file) {
    $raw = Get-Content -LiteralPath $file -ErrorAction SilentlyContinue | Select-Object -First 1
    $parsed = 0
    if ([int]::TryParse([string]$raw, [ref]$parsed)) {
      $ids.Add($parsed) | Out-Null
    }
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

if ($hasRecordedPort) {
  $listenerPid = Get-ListenerProcessId $port
  if ($listenerPid -gt 0) {
    $ids.Add($listenerPid) | Out-Null
  }
}
if ($hasRecordedVibePort) {
  $vibeListenerPid = Get-ListenerProcessId $vibePort
  if ($vibeListenerPid -gt 0) {
    $ids.Add($vibeListenerPid) | Out-Null
  }
}

$ids = $ids | Select-Object -Unique

function Stop-RecordedProcessTree([int]$ProcessId) {
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    return
  }
  & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
  Write-Host "Stopped PID $ProcessId"
}

if (-not $ids -or $ids.Count -eq 0) {
  Write-Host "No SparkFlow process was found on port $port."
} else {
  foreach ($id in $ids) {
    Stop-RecordedProcessTree ([int]$id)
  }
}

Remove-Item -LiteralPath (Join-Path $stateDir 'vite.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $stateDir 'vite-listener.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $stateDir 'vibe.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $vibePortFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 400

Write-Host 'SparkFlow stopped.'
