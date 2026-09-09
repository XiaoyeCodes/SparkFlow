param([string]$BindingFile, [int]$Port = 0)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$terminalDir = Join-Path $projectRoot '.sparkflow/ibkr-terminal'
New-Item -ItemType Directory -Force -Path $terminalDir | Out-Null
# Restrict local session token, database, and future reports to this Windows user.
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$directoryAcl = New-Object Security.AccessControl.DirectorySecurity
$directoryAcl.SetAccessRuleProtection($true, $false)
$userRule = New-Object Security.AccessControl.FileSystemAccessRule($userSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$directoryAcl.SetAccessRule($userRule)
if ($PSVersionTable.PSEdition -eq 'Core') {
    [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($terminalDir), $directoryAcl)
} else {
    ([IO.DirectoryInfo]::new($terminalDir)).SetAccessControl($directoryAcl)
}
$pythonPath = Join-Path $projectRoot 'services/vibe-trading/.venv/Scripts/python.exe'
$agentRoot = Join-Path $projectRoot 'services/vibe-trading/agent'
$portFile = Join-Path $terminalDir 'bridge.port'
if ($Port -eq 0 -and $env:SPARKFLOW_IBKR_BRIDGE_PORT) { $Port = [int]$env:SPARKFLOW_IBKR_BRIDGE_PORT }
if ($Port -eq 0 -and (Test-Path -LiteralPath $portFile)) { $Port = [int](Get-Content -LiteralPath $portFile -Raw).Trim() }
if ($Port -eq 0) { $Port = 8765 }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'IBKR bridge port must be between 1024 and 65535.' }
[IO.File]::WriteAllText($portFile, [string]$Port, [Text.UTF8Encoding]::new($false))
$arguments = @('-m', 'src.ibkr_terminal', '--runtime-dir', $terminalDir, '--port', [string]$Port)
if ($BindingFile) { $arguments += @('--bindings', [IO.Path]::GetFullPath($BindingFile)) }
Push-Location $agentRoot
try { & $pythonPath @arguments; if ($LASTEXITCODE -ne 0) { throw "IBKR terminal exited with code $LASTEXITCODE" } }
finally { Pop-Location }
