param([Parameter(Mandatory=$true)][string]$RuntimeDirectory, [Parameter(Mandatory=$true)][int]$Port)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid bridge port' }
$expectedRuntime = [IO.Path]::GetFullPath($RuntimeDirectory).TrimEnd('\')
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object LocalAddress -eq '127.0.0.1')
if ($listeners.Count -eq 0) { exit 0 }
$ownerIds = @($listeners.OwningProcess | Select-Object -Unique)
if ($ownerIds.Count -ne 1) { throw 'Ambiguous bridge owner' }
$bridgeProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($ownerIds[0])"
if ($bridgeProcess.Name -notin @('python.exe','pythonw.exe') -or $bridgeProcess.CommandLine -notmatch '(?:^|\s)-m\s+src\.ibkr_terminal(?:\s|$)') { throw 'Port is not owned by the SparkFlow bridge' }
$runtimeMatch = [regex]::Match($bridgeProcess.CommandLine, '--runtime-dir\s+(?:"(?<quoted>[^"]+)"|(?<plain>\S+))')
if (!$runtimeMatch.Success) { throw 'Bridge runtime is unverified' }
$actualRuntime = if ($runtimeMatch.Groups['quoted'].Success) { $runtimeMatch.Groups['quoted'].Value } else { $runtimeMatch.Groups['plain'].Value }
if (![string]::Equals([IO.Path]::GetFullPath($actualRuntime).TrimEnd('\'), $expectedRuntime, [StringComparison]::OrdinalIgnoreCase)) { throw 'Bridge belongs to another workspace' }
$processHandle = Get-Process -Id $bridgeProcess.ProcessId
if ([Math]::Abs(($processHandle.StartTime.ToUniversalTime() - $bridgeProcess.CreationDate.ToUniversalTime()).TotalSeconds) -gt 1) { throw 'Bridge process changed' }
# Only the verified Python bridge, never Gateway, other Python tasks or a tree.
Stop-Process -InputObject $processHandle -ErrorAction Stop
Wait-Process -Id $bridgeProcess.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
