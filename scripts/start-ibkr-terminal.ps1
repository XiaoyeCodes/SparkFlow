param([string]$BindingFile)
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
$arguments = @('-m', 'src.ibkr_terminal', '--runtime-dir', $terminalDir)
if ($BindingFile) { $arguments += @('--bindings', [IO.Path]::GetFullPath($BindingFile)) }
Push-Location $agentRoot
try { & $pythonPath @arguments; if ($LASTEXITCODE -ne 0) { throw "IBKR terminal exited with code $LASTEXITCODE" } }
finally { Pop-Location }
