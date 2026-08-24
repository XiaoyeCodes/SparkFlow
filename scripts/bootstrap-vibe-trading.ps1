param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$serviceRoot = Join-Path $rootPath 'services\vibe-trading'
$pyprojectPath = Join-Path $serviceRoot 'pyproject.toml'
$lockPath = Join-Path $serviceRoot 'requirements-lock.txt'
$venvRoot = Join-Path $serviceRoot '.venv'
$venvPython = if ($IsLinux -or $IsMacOS) {
  Join-Path $venvRoot 'bin\python'
} else {
  Join-Path $venvRoot 'Scripts\python.exe'
}
$markerPath = Join-Path $venvRoot '.sparkflow-dependencies'

if (-not (Test-Path -LiteralPath $pyprojectPath) -or -not (Test-Path -LiteralPath $lockPath)) {
  throw "Bundled research service is incomplete: $serviceRoot"
}

$sourceHash = '{0}:{1}' -f `
  (Get-Sha256Hex $pyprojectPath),
  (Get-Sha256Hex $lockPath)
if ((Test-Path -LiteralPath $venvPython) -and (Test-Path -LiteralPath $markerPath)) {
  $installedHash = [string](Get-Content -LiteralPath $markerPath -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($installedHash.Trim() -eq $sourceHash) {
    Write-Host 'Bundled Vibe-Trading research runtime is ready.'
    exit 0
  }
}

$pythonFile = $null
$pythonPrefix = @()
$uvCommand = Get-Command 'uv' -ErrorAction SilentlyContinue | Select-Object -First 1
$candidates = @(
  @{ File = 'py'; Prefix = @('-3.11') },
  @{ File = 'python'; Prefix = @() },
  @{ File = 'python3'; Prefix = @() }
)

foreach ($candidate in $candidates) {
  $command = Get-Command $candidate.File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $command) {
    continue
  }
  try {
    [string[]]$candidatePrefix = @($candidate.Prefix)
    $version = & $command.Source @candidatePrefix -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
    if ($LASTEXITCODE -ne 0) {
      continue
    }
    $parts = [string]$version -split '\.'
    if ([int]$parts[0] -gt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11)) {
      $pythonFile = $command.Source
      $pythonPrefix = @($candidate.Prefix)
      break
    }
  } catch {
    continue
  }
}

if (-not $pythonFile -and -not $uvCommand) {
  throw 'Python 3.11+ or uv is required. Install uv from https://docs.astral.sh/uv/ and start SparkFlow again.'
}

if (-not (Test-Path -LiteralPath $venvPython)) {
  Write-Host 'Creating the bundled Vibe-Trading Python environment...'
  if ($uvCommand) {
    & $uvCommand.Source venv --python 3.11 $venvRoot
  } else {
    & $pythonFile @pythonPrefix -m venv $venvRoot
  }
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the Vibe-Trading virtual environment.'
  }
}

$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$env:PIP_DISABLE_PIP_VERSION_CHECK = '1'

Write-Host 'Installing bundled Vibe-Trading dependencies (first start can take several minutes)...'
if ($uvCommand) {
  & $uvCommand.Source pip install --python $venvPython --require-hashes --requirement $lockPath
  if ($LASTEXITCODE -eq 0) {
    & $uvCommand.Source pip install --python $venvPython --no-deps --editable $serviceRoot
  }
} else {
  & $venvPython -m pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) {
    throw 'Failed to upgrade pip for the Vibe-Trading runtime.'
  }
  & $venvPython -m pip install --require-hashes --requirement $lockPath
  if ($LASTEXITCODE -eq 0) {
    & $venvPython -m pip install --no-deps --editable $serviceRoot
  }
}
if ($LASTEXITCODE -ne 0) {
  throw 'Failed to install the bundled Vibe-Trading runtime.'
}

Set-Content -LiteralPath $markerPath -Value $sourceHash -Encoding ascii
Write-Host 'Bundled Vibe-Trading research runtime is ready.'
