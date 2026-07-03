param(
  [Parameter(Mandatory = $true)]
  [string]$Root,
  [int]$FallbackPort = 5173
)

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$stateDir = Join-Path $rootPath '.sparkflow'
$portFile = Join-Path $stateDir 'vite.port'
$pidFiles = @(
  (Join-Path $stateDir 'vite-listener.pid'),
  (Join-Path $stateDir 'vite.pid')
)

$port = $FallbackPort
if ((Test-Path -LiteralPath $portFile) -and [int]::TryParse([string](Get-Content -LiteralPath $portFile -ErrorAction SilentlyContinue | Select-Object -First 1), [ref]$port)) {
  # Use the recorded port from the last successful start.
}

$ports = @($port, $FallbackPort) | Select-Object -Unique
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

foreach ($candidatePort in $ports) {
  $listeners = Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $listeners) {
    if ($conn.OwningProcess) {
      $ids.Add([int]$conn.OwningProcess) | Out-Null
    }
  }
}

$ids = $ids | Select-Object -Unique

function Stop-ProcessTree([int]$ProcessId) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
  if (-not $proc) {
    return
  }

  $cmd = [string]$proc.CommandLine
  $isListener = $false
  foreach ($candidatePort in $ports) {
    $matches = Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.OwningProcess -eq $ProcessId }
    if (@($matches).Count -gt 0) {
      $isListener = $true
      break
    }
  }

  $belongsHere = $isListener -or $cmd.Contains($rootPath) -or $cmd.Contains('npm run dev') -or $cmd.Contains('vite')
  if (-not $belongsHere) {
    Write-Host "Skip PID $ProcessId because it does not look like SparkFlow."
    return
  }

  Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-ProcessTree ([int]$_.ProcessId) }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped PID $ProcessId"
}

if (-not $ids -or $ids.Count -eq 0) {
  Write-Host "No SparkFlow process was found on port $port."
} else {
  foreach ($id in $ids) {
    Stop-ProcessTree ([int]$id)
  }
}

Remove-Item -LiteralPath (Join-Path $stateDir 'vite.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $stateDir 'vite-listener.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $portFile -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 400

$still = $null
foreach ($candidatePort in $ports) {
  $candidateStill = Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($candidateStill) {
    $still = $candidateStill
    $port = $candidatePort
    break
  }
}

if ($still) {
  Write-Host "Port $port is still listening. PID: $($still.OwningProcess)"
  exit 1
}

Write-Host 'SparkFlow stopped.'
