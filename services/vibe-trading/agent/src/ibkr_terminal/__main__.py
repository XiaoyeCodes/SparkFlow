"""Explicit local startup. Without a binding file, no broker connection occurs."""
import argparse
import asyncio
import contextlib
import json
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn

from .app import create_app
from .readonly import ReadonlyConnection
from .session import AccountBinding
from .store import SnapshotStore
from .strategy import StrategyCatalog
from .backtests import BacktestArchive
from .workers import BacktestJobs
from .intelligence import AiConsentStore
from .reports import LocalReportStore
from .report_jobs import ReportJobs
from .market_data import MarketDataStore
from .orders import OrderLedger
from .strategy_runtime import StrategyRuntime
from .runtime_lease import RuntimeLease


async def keep_readonly(connection):
    # One connection attempt. On failure stop and require explicit service restart.
    detail = '只读服务已停止；缓存不能代表当前账户。'
    try:
        await connection.connect()
        await asyncio.wait_for(connection.refresh(), timeout=8)
        next_reconcile = 0.0
        changed = True
        loop = asyncio.get_running_loop()
        while True:
            if not connection.healthy():
                break
            if loop.time() >= next_reconcile:
                if not await asyncio.wait_for(connection.reconcile(), timeout=18):
                    break
                next_reconcile = loop.time() + 30
            elif changed:
                if not await asyncio.wait_for(connection.refresh(), timeout=8):
                    break
            changed = await connection.wait_for_change(min(5, max(0, next_reconcile - loop.time())))
            if changed:
                # Account/position rendering only. P3 order events must never use this coalescer.
                await asyncio.sleep(0.1)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        # Raw SDK errors may contain account identifiers. State explains the failure.
        detail = f'只读同步失败（{type(exc).__name__}）；请核对配置与官方客户端后重启服务。'
        logging.getLogger(__name__).error(detail)
    finally:
        connection.close(detail)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime-dir', type=Path, required=True)
    parser.add_argument('--bindings', type=Path)
    args = parser.parse_args()
    bindings = [] if args.bindings is None else [AccountBinding.model_validate(value) for value in json.loads(args.bindings.read_text(encoding='utf-8'))]
    if len({value.mode for value in bindings}) != len(bindings):
        raise ValueError('first phase permits one explicitly configured account per mode')
    if len({(value.host, value.port, value.clientId) for value in bindings}) != len(bindings):
        raise ValueError('account connections must use distinct client sessions')
    args.runtime_dir.mkdir(parents=True, exist_ok=True)
    lease = RuntimeLease(args.runtime_dir)
    token = secrets.token_urlsafe(32)
    (args.runtime_dir / 'session.token').write_text(token, encoding='utf-8')
    store = SnapshotStore(args.runtime_dir / 'terminal.sqlite')
    strategies = StrategyCatalog(args.runtime_dir / 'strategies.sqlite')
    backtests = BacktestArchive(args.runtime_dir / 'backtests.sqlite')
    jobs = BacktestJobs(args.runtime_dir / 'backtest-jobs.sqlite', backtests)
    ai_consents = AiConsentStore(args.runtime_dir / 'ai-consent.sqlite')
    reports = LocalReportStore(args.runtime_dir / 'reports', clock=lambda: datetime.now(timezone.utc))
    report_jobs = ReportJobs(args.runtime_dir / 'report-jobs.sqlite', reports)
    market_data = MarketDataStore(args.runtime_dir / 'market-data.sqlite')
    orders = OrderLedger(args.runtime_dir / 'orders.sqlite')
    orders.recover_inflight()
    strategy_runtime = StrategyRuntime(args.runtime_dir / 'strategy-runtime.sqlite', orders)
    app = create_app(store=store, session_token=token, strategy_catalog=strategies,
        backtest_archive=backtests, backtest_jobs=jobs, ai_consents=ai_consents, report_store=reports, report_jobs=report_jobs,
        market_data_store=market_data, strategy_runtime=strategy_runtime, paper_ledger=orders)

    @asynccontextmanager
    async def lifespan(_):
        tasks = []
        for binding in bindings:
            session = app.state.sessions[binding.mode]
            session.bind(binding)
            connection = ReadonlyConnection(session, allow_partial=True)
            app.state.market_sources[binding.mode] = connection
            tasks.append(asyncio.create_task(keep_readonly(connection)))
        try:
            yield
        finally:
            if app.state.paper_flow is not None:
                app.state.paper_flow.close()
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            app.state.market_sources.clear()
            jobs.close()
            report_jobs.close()
            backtests.close()
            strategies.close()
            ai_consents.close()
            market_data.close()
            strategy_runtime.close()
            orders.close()
            store.close()

    app.router.lifespan_context = lifespan
    try:
        uvicorn.run(app, host='127.0.0.1', port=8765, access_log=False)
    finally:
        lease.close()


if __name__ == '__main__':
    main()
