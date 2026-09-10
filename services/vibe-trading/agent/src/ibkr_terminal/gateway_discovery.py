"""Local IB API discovery. Installation files provide hints, never account identity."""
import asyncio
import hashlib
import json
import os
import re
import secrets
import subprocess
from pathlib import Path

from .session import AccountBinding


class DiscoveryError(Exception):
    pass


def local_inventory():
    """Only inspect IB processes and their listeners; never collect login fields."""
    if os.name != 'nt':
        return {'ports': [], 'directories': []}
    script = r'''
$ErrorActionPreference = 'Stop'
$apps = @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^(ibgateway|tws)\.exe$' -or
    ($_.Name -match '^javaw?\.exe$' -and $_.CommandLine -match 'ibgateway|jclient\.LoginFrame|ibcalpha\.ibc')
})
$ids = @($apps | ForEach-Object { $_.ProcessId })
$ports = @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $ids } | ForEach-Object { $_.LocalPort } | Sort-Object -Unique)
$directories = @($apps | Where-Object { $_.ExecutablePath } | ForEach-Object { Split-Path -Parent $_.ExecutablePath } | Sort-Object -Unique)
@{ports=$ports; directories=$directories} | ConvertTo-Json -Compress
'''
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
        capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise DiscoveryError('无法读取本机 IBKR 进程端口，请检查本机进程访问权限。')
    return json.loads(result.stdout)


def port_candidates(inventory, bindings, mode):
    ports = list(inventory.get('ports', []))
    directories = [Path(value) for value in inventory.get('directories', [])]
    directories += [Path.home() / 'Jts', Path('C:/Jts')]
    for directory in directories:
        try:
            # Read only explicit API socket settings. RemotePortOrderRouting and
            # LocalServerPort describe other channels and must not be treated as API ports.
            content = (directory / 'jts.ini').read_text(encoding='utf-8', errors='replace')
            ports += [int(value) for value in re.findall(r'^\s*(?:SocketPort|ApiPort)\s*=\s*(\d+)\s*$', content, re.M | re.I)]
        except OSError:
            pass
    ports += [value.port for value in bindings if value.mode == mode]
    ports += [4001, 7496, 4002, 7497] if mode == 'live' else [4002, 7497, 4001, 7496]
    return list(dict.fromkeys(port for port in ports if isinstance(port, int) and 1 <= port <= 65535))[:32]


async def handshake(port):
    from .sdk import ObservedIB
    ib = ObservedIB()
    try:
        # Use the protocol handshake directly. IB.connectAsync additionally waits
        # for positions, so it is unsuitable for API/managed-account discovery.
        await ib.client.connectAsync('127.0.0.1', port, secrets.randbelow(1_000_000) + 10000, 3)
        return tuple(dict.fromkeys(ib.client.getAccounts()))
    except (OSError, ConnectionError, TimeoutError):
        return ()
    finally:
        ib.disconnect()


def choose_binding(mode, results, bindings):
    expected = next((value for value in bindings if value.mode == mode), None)
    # An existing confirmed account is authoritative even on a nonstandard port.
    if expected:
        matching = [(port, accounts) for port, accounts in results if expected.brokerAccount in accounts]
        if matching:
            port = next((port for port, _ in matching if port == expected.port), matching[0][0])
            return expected.model_copy(update={'port': port, 'clientId': secrets.randbelow(1_000_000) + 10000 if expected.readonly else expected.clientId})
    else:
        # The selected mode is explicit. Account identifiers only reject an
        # incompatible mode; a port number is never evidence of live/paper identity.
        candidates = [(port, account) for port, accounts in results for account in accounts
            if isinstance(account, str) and re.fullmatch(r'DU[A-Z0-9]{1,30}' if mode == 'paper' else r'U\d+', account)]
        identities = {account for _, account in candidates}
        if len(identities) == 1:
            port, account = candidates[0]
            return AccountBinding(mode=mode, accountKey=f'{mode}:gateway-{hashlib.sha256(account.encode()).hexdigest()[:16]}',
                brokerAccount=account, confirmed=True, port=port, clientId=secrets.randbelow(1_000_000) + 10000)
        if len(identities) > 1:
            raise DiscoveryError('检测到多个可用账户，请在本机 bindings.json 中明确绑定要使用的账户。')
    label = '模拟盘' if mode == 'paper' else '实盘'
    active = [str(port) for port, accounts in results if accounts]
    if active:
        raise DiscoveryError(f'已发现 IBKR API（端口 {", ".join(active)}），但未返回当前绑定的{label}账户。请在 IBKR 登录对应模式；不会自动替换账户或混用实盘与模拟盘。')
    raise DiscoveryError(f'尚未发现可用的{label} IBKR API。请在官方客户端完成登录，并检查 API Socket、端口和本机连接授权；系统会自动重试。')


async def discover_binding(mode, bindings, *, inventory_reader=local_inventory, probe=handshake):
    inventory = await asyncio.to_thread(inventory_reader)
    semaphore = asyncio.Semaphore(4)
    async def read(port):
        async with semaphore:
            return port, await probe(port)
    results = await asyncio.gather(*(read(port) for port in port_candidates(inventory, bindings, mode)))
    return choose_binding(mode, results, bindings)


def save_binding(target, binding):
    target = Path(target)
    previous = json.loads(target.read_text(encoding='utf-8-sig')) if target.exists() else []
    # Validate before replacing; preserve the other mode and its identity.
    values = [AccountBinding.model_validate(value) for value in previous]
    values = [value for value in values if value.mode != binding.mode] + [binding]
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps([value.model_dump() for value in values], ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(target)
