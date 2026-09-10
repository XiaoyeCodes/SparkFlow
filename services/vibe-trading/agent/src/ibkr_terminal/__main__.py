"""Explicit local startup. Without a binding file, no broker connection occurs."""
import argparse
import asyncio
import contextlib
import json
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn

from .app import create_app
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
from .gateway_runtime import GatewayRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime-dir', type=Path, required=True)
    parser.add_argument('--bindings', type=Path)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise ValueError('bridge port must be between 1024 and 65535')
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
    app = create_app(store=store, session_token=token, port=args.port, strategy_catalog=strategies,
        backtest_archive=backtests, backtest_jobs=jobs, ai_consents=ai_consents, report_store=reports, report_jobs=report_jobs,
        market_data_store=market_data, strategy_runtime=strategy_runtime, paper_ledger=orders)

    @asynccontextmanager
    async def lifespan(_):
        runtime = GatewayRuntime(app, args.bindings or args.runtime_dir / 'bindings.json', bindings)
        app.state.gateway_runtime = runtime
        tasks = []
        for binding in bindings:
            tasks.append(asyncio.create_task(runtime.connect(binding.mode)))
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
            await runtime.close()
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
    from .bridge_lifecycle import install_lifecycle
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=args.port, access_log=False, timeout_graceful_shutdown=5))
    install_lifecycle(app, server)
    try:
        server.run()
    finally:
        lease.close()


if __name__ == '__main__':
    main()
