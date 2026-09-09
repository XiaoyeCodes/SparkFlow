"""Discover one authenticated IB Gateway account and create a local binding."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/vibe-trading/agent'))
from src.ibkr_terminal.sdk import ObservedIB
from src.ibkr_terminal.gateway_discovery import save_binding
from src.ibkr_terminal.session import AccountBinding


async def discover(host: str, port: int, client_id: int) -> str:
    ib = ObservedIB()
    try:
        await ib.client.connectAsync(host, port, client_id, 8)
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
    parser.add_argument('--enable-paper-orders', action='store_true', help='Allow the guarded SparkFlow paper order flow')
    args = parser.parse_args()
    if not 1 <= args.gateway_port <= 65535 or args.client_id <= 0:
        raise ValueError('invalid Gateway port or client id')
    if args.enable_paper_orders and args.mode != 'paper':
        raise ValueError('order transport can only be enabled for paper mode')
    account = asyncio.run(discover('127.0.0.1', args.gateway_port, args.client_id))
    account_key = f'{args.mode}:gateway-{hashlib.sha256(account.encode()).hexdigest()[:16]}'
    binding = {
        'mode': args.mode,
        'accountKey': account_key,
        'brokerAccount': account,
        'confirmed': True,
        'host': '127.0.0.1',
        'port': args.gateway_port,
        'clientId': args.client_id,
        'readonly': not args.enable_paper_orders,
        'baseCurrency': None,
    }
    args.runtime_dir.mkdir(parents=True, exist_ok=True)
    target = args.runtime_dir / 'bindings.json'
    save_binding(target, AccountBinding.model_validate(binding))
    access = 'paper order-capable' if args.enable_paper_orders else 'read-only'
    print(f'Created one {args.mode} {access} Gateway binding at {target}')


if __name__ == '__main__':
    main()
