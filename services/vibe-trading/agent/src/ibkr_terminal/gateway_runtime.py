"""Supervise read-only sessions across late login, socket changes and disconnects."""
import asyncio
import contextlib

from .gateway_discovery import DiscoveryError, discover_binding, save_binding
from .readonly import ReadonlyConnection


class GatewayRuntime:
    def __init__(self, app, binding_file, bindings, *, discover=discover_binding, factory=ReadonlyConnection, retry_seconds=15):
        self.app, self.binding_file = app, binding_file
        self.bindings = {value.mode: value for value in bindings}
        self.discover, self.factory, self.retry_seconds = discover, factory, retry_seconds
        self.tasks, self.wakes, self.attempts, self.statuses = {}, {}, {}, {}
        self.lock = asyncio.Lock()

    def status(self, mode):
        return self.statuses.get(mode, {'phase': 'waiting', 'detail': '等待选择账户模式并连接本机 IBKR API。'})

    async def connect(self, mode):
        source = self.app.state.market_sources.get(mode)
        snapshot = self.app.state.sessions[mode].snapshot()
        if source and source.healthy() and snapshot.state in ('ready', 'empty'):
            return self.status(mode)
        if mode not in self.tasks or self.tasks[mode].done():
            self.wakes[mode], self.attempts[mode] = asyncio.Event(), asyncio.Event()
            self.tasks[mode] = asyncio.create_task(self.run(mode))
        else:
            self.attempts[mode].clear()
            self.wakes[mode].set()
        # A browser request has a bound, while recovery survives its cancellation.
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self.attempts[mode].wait(), 35)
        return self.status(mode)

    async def enable_paper_orders(self):
        """Replace only the confirmed paper binding and restart its supervised session."""
        binding = self.bindings.get('paper')
        if binding is None:
            raise DiscoveryError('请先连接并核对一个明确的模拟盘账户。')
        task = self.tasks.pop('paper', None)
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        current = getattr(self.app.state, 'paper_flow', None)
        if current is not None:
            current.close()
            self.app.state.paper_flow = None
        source = self.app.state.market_sources.pop('paper', None)
        if source is not None:
            source.close('正在切换到受控模拟盘订单连接。')
        writable = binding.model_copy(update={'readonly': False})
        # Full validation enforces that live bindings can never take this path.
        writable = type(binding).model_validate(writable.model_dump())
        save_binding(self.binding_file, writable)
        self.bindings['paper'] = writable
        self.app.state.sessions['paper'].disconnected('正在切换到受控模拟盘订单连接。')
        result = await self.connect('paper')
        return {**result, 'paperOrdersAvailable': result.get('phase') == 'ready'}

    async def run(self, mode):
        session = self.app.state.sessions[mode]
        while True:
            connection = None
            self.wakes[mode].clear()
            self.statuses[mode] = {'phase': 'connecting', 'detail': '正在识别本机 IBKR API 端口并核对账户身份…'}
            try:
                async with self.lock:
                    binding = await self.discover(mode, list(self.bindings.values()))
                    save_binding(self.binding_file, binding)
                    self.bindings[mode] = binding
                session.bind(binding)
                connection = self.factory(session, allow_partial=True)
                self.app.state.market_sources[mode] = connection
                await connection.connect()
                if not await asyncio.wait_for(connection.reconcile(), 20):
                    raise ConnectionError()
                if session.snapshot().state not in ('ready', 'empty'):
                    raise DiscoveryError(session.snapshot().detail)
                access = '只读快照' if binding.readonly else '模拟盘订单通道与账户快照'
                self.statuses[mode] = {'phase': 'ready', 'apiPort': binding.port,
                    'detail': f'IBKR API 127.0.0.1:{binding.port} 已连接，账户身份及{access}已核对。'}
                self.attempts[mode].set()
                loop = asyncio.get_running_loop()
                next_reconcile = loop.time() + 30
                while connection.healthy():
                    changed = await connection.wait_for_change(min(5, max(0, next_reconcile - loop.time())))
                    if not connection.healthy():
                        break
                    if loop.time() >= next_reconcile:
                        if not await asyncio.wait_for(connection.reconcile(), 20):
                            break
                        next_reconcile = loop.time() + 30
                    elif changed:
                        await asyncio.sleep(0.1)
                        if not await asyncio.wait_for(connection.refresh(), 12):
                            break
                raise ConnectionError()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                detail = str(error) if isinstance(error, DiscoveryError) else f'IBKR 账户连接暂不可用（{type(error).__name__}），正在自动重新识别端口并恢复。'
                self.statuses[mode] = {'phase': 'retrying', 'detail': detail}
                session.disconnected(detail)
                self.attempts[mode].set()
            finally:
                if connection:
                    connection.close(self.status(mode)['detail'])
                    if self.app.state.market_sources.get(mode) is connection:
                        self.app.state.market_sources.pop(mode, None)
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.wakes[mode].wait(), self.retry_seconds)

    async def close(self):
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
