"""Discover one authenticated IB Gateway account and create a local read-only binding."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path

from ib_async import IB, StartupFetch


async def discover(host: str, port: int, client_id: int) -> str:
    ib = IB()
    try:
        await ib.connectAsync(
            host,
            port,
            clientId=client_id,
            readonly=True,
            timeout=8,
            raiseSyncErrors=True,
            fetchFields=StartupFetch(0),
        )
        accounts = tuple(dict.fromkeys(ib.managedAccounts()))
        if not accounts:
            raise RuntimeError('Gateway did not return an account')
        if len(accounts) != 1:
            raise RuntimeError('Gateway returned multiple accounts; choose one explicitly before binding')
        return accounts[0]
    finally:
        ib.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime-dir', type=Path, required=True)
    parser.add_argument('--gateway-port', type=int, required=True)
    parser.add_argument('--client-id', type=int, default=78)
    parser.add_argument('--mode', choices=('live', 'paper'), default='live')
    args = parser.parse_args()
    if not 1 <= args.gateway_port <= 65535 or args.client_id <= 0:
        raise ValueError('invalid Gateway port or client id')
    account = asyncio.run(discover('127.0.0.1', args.gateway_port, args.client_id))
    account_key = f'{args.mode}:gateway-{hashlib.sha256(account.encode()).hexdigest()[:16]}'
    binding = [{
        'mode': args.mode,
        'accountKey': account_key,
        'brokerAccount': account,
        'confirmed': True,
        'host': '127.0.0.1',
        'port': args.gateway_port,
        'clientId': args.client_id,
        'readonly': True,
        'baseCurrency': None,
    }]
    args.runtime_dir.mkdir(parents=True, exist_ok=True)
    target = args.runtime_dir / 'bindings.json'
    temporary = target.with_suffix('.tmp')
    temporary.write_text(json.dumps(binding, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(target)
    print(f'Created one {args.mode} read-only Gateway binding at {target}')


if __name__ == '__main__':
    main()
