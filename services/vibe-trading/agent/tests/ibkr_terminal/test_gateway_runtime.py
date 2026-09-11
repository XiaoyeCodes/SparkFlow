import asyncio
import json
from types import SimpleNamespace

import pytest
import httpx

from src.ibkr_terminal.app import create_app
from src.ibkr_terminal.gateway_discovery import DiscoveryError, choose_binding, discover_binding, port_candidates, save_binding
from src.ibkr_terminal.gateway_runtime import GatewayRuntime
from src.ibkr_terminal.session import AccountBinding
from src.ibkr_terminal.store import SnapshotStore


def binding(mode='paper', port=4002):
    return AccountBinding(mode=mode, port=port, accountKey=f'{mode}:test', brokerAccount='DU12345' if mode == 'paper' else 'U12345', confirmed=True)


def test_process_listeners_and_explicit_socket_settings_precede_defaults(tmp_path):
    (tmp_path / 'jts.ini').write_text('[IBGateway]\nRemotePortOrderRouting=4001\nLocalServerPort=4000\n[API]\nSocketPort=45123\n')
    ports = port_candidates({'ports': [45122, 45122], 'directories': [str(tmp_path)]}, [binding()], 'paper')
    assert ports[:3] == [45122, 45123, 4002]
    assert 4000 not in ports


def test_binding_follows_verified_account_to_custom_port_and_keeps_other_mode(tmp_path):
    paper, live = binding(), binding('live')
    target = tmp_path / 'bindings.json'
    save_binding(target, live)
    selected = choose_binding('paper', [(4001, ('U12345',)), (45122, ('DU12345',))], [paper, live])
    save_binding(target, selected)
    rows = json.loads(target.read_text())
    assert len(rows) == 2
    assert rows[0]['mode'] == 'live' and rows[0]['brokerAccount'] == live.brokerAccount
    assert selected.port == 45122 and selected.accountKey == paper.accountKey
    assert selected.readonly is True and selected.clientId > 0


def test_existing_managed_paper_client_identity_is_preserved():
    paper = binding().model_copy(update={'readonly': False, 'clientId': 82})
    selected = choose_binding('paper', [(45122, ('DU12345',))], [paper])
    assert selected.readonly is False and selected.clientId == 82


def test_explicit_paper_transport_upgrade_preserves_live_readonly_binding(tmp_path, api_event_loop):
    async def scenario():
        with SnapshotStore(tmp_path / 'db') as store:
            app=create_app(store=store,session_token='test')
            paper,live=binding(),binding('live')
            save_binding(tmp_path/'bindings.json',live);save_binding(tmp_path/'bindings.json',paper)
            seen=[]
            async def discover(mode,bindings):
                selected=next(value for value in bindings if value.mode==mode);seen.append(selected);return selected
            class Connection:
                def __init__(self,session,**kwargs):self.session,self.binding,self.connected=session,session.binding,False
                async def connect(self):self.connected=True
                async def reconcile(self):self.session._snapshot=self.session.snapshot().model_copy(update={'state':'empty','connection':'connected'});return True
                async def refresh(self):return True
                def healthy(self):return self.connected
                async def wait_for_change(self,timeout):await asyncio.sleep(.01);return False
                def close(self,detail):self.connected=False
            runtime=GatewayRuntime(app,tmp_path/'bindings.json',[paper,live],discover=discover,factory=Connection,retry_seconds=.01)
            app.state.gateway_runtime=runtime
            try:
                result=await runtime.enable_paper_orders()
                assert result['phase']=='ready' and result['paperOrdersAvailable'] is True
                assert seen[0].mode=='paper' and seen[0].readonly is False
                saved={row['mode']:row for row in json.loads((tmp_path/'bindings.json').read_text())}
                assert saved['paper']['readonly'] is False and saved['live']['readonly'] is True
            finally:await runtime.close()
    api_event_loop.run_until_complete(scenario())


def test_live_never_accepts_paper_even_on_the_live_default_port():
    with pytest.raises(DiscoveryError, match='未返回当前绑定的实盘账户'):
        choose_binding('live', [(4001, ('DU12345',))], [binding('live')])
    with pytest.raises(DiscoveryError):
        choose_binding('live', [(4001, ('DU12345',))], [])


def test_discovery_does_not_silently_replace_a_saved_account():
    with pytest.raises(DiscoveryError):
        choose_binding('paper', [(4002, ('DU99999',))], [binding()])


def test_first_connection_requires_a_unique_mode_compatible_account():
    selected = choose_binding('paper', [(45122, ('DUR12345',))], [])
    assert selected.mode == 'paper' and selected.port == 45122 and selected.readonly is True
    assert selected.brokerAccount == 'DUR12345'
    with pytest.raises(DiscoveryError, match='多个'):
        choose_binding('paper', [(4002, ('DUR12345', 'DU67890'))], [])
    with pytest.raises(DiscoveryError):
        choose_binding('paper', [(4002, ('U12345', 'DU-INVALID'))], [])
    with pytest.raises(DiscoveryError):
        choose_binding('live', [(4001, ('UNKNOWN',))], [])


def test_async_discovery_scans_process_custom_ports(api_event_loop):
    async def probe(port):
        return ('DU12345',) if port == 45122 else ()
    result = api_event_loop.run_until_complete(discover_binding('paper', [binding()],
        inventory_reader=lambda: {'ports': [45122], 'directories': []}, probe=probe))
    assert result.port == 45122


def test_runtime_supervises_disconnects_until_explicitly_stopped(tmp_path, api_event_loop):
    async def scenario():
        with SnapshotStore(tmp_path / 'db') as store:
            app = create_app(store=store, session_token='test')
            discoveries, connections = [], []
            async def discover(mode, bindings):
                discoveries.append(mode)
                if len(discoveries) == 1:
                    raise DiscoveryError('等待登录')
                return binding(port=45122 if len(discoveries) == 2 else 45123)
            class Connection:
                def __init__(self, session, **kwargs):
                    self.session, self.binding = session, session.binding
                    self.connected = False
                    connections.append(self)
                async def connect(self): self.connected = True
                async def reconcile(self):
                    self.session._snapshot = self.session.snapshot().model_copy(update={'state': 'empty', 'connection': 'connected'})
                    return True
                async def refresh(self): return True
                def healthy(self): return self.connected
                async def wait_for_change(self, timeout):
                    await asyncio.sleep(.005)
                    return False
                def close(self, detail): self.connected = False
            runtime = GatewayRuntime(app, tmp_path / 'bindings.json', [binding()], discover=discover, factory=Connection, retry_seconds=.01)
            try:
                first = await runtime.connect('paper')
                assert first['phase'] == 'retrying'
                async def ready(count):
                    while len(connections) < count or runtime.status('paper')['phase'] != 'ready':
                        await asyncio.sleep(.005)
                await asyncio.wait_for(ready(1), 1)
                connections[0].connected = False
                await asyncio.wait_for(ready(2), 1)
                assert runtime.status('paper')['apiPort'] == 45123
                assert len(runtime.tasks) == 1
                assert not connections[0].connected
                closed=[]
                app.state.paper_flow=SimpleNamespace(source=SimpleNamespace(connection=connections[-1]),close=lambda:closed.append(True))
                await asyncio.gather(*(runtime.connect('paper') for _ in range(3)))
                assert len(connections) == 2
                stopped = await runtime.disconnect('paper')
                assert stopped['phase'] == 'waiting'
                assert '不会自动重连' in stopped['detail']
                await asyncio.sleep(.04)
                assert len(connections) == 2
                assert 'paper' not in runtime.tasks
            finally:
                await runtime.close()
            assert all(task.done() for task in runtime.tasks.values())
            assert not app.state.market_sources
            assert closed==[True] and app.state.paper_flow is None
    api_event_loop.run_until_complete(scenario())


def test_gateway_route_requires_token_origin_and_explicit_mode(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'db') as store:
        app = create_app(store=store, session_token='test')
        calls = []
        async def connect(mode):
            calls.append(mode)
            return {'phase': 'ready', 'apiPort': 45122, 'detail': '已核对'}
        async def disconnect(mode):
            calls.append(f'stop:{mode}')
            return {'phase': 'waiting', 'detail': '已断开'}
        app.state.gateway_runtime = SimpleNamespace(connect=connect, disconnect=disconnect)
        async def scenario():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as client:
                route = '/api/ibkr-terminal/gateway/connect'
                assert (await client.post(route, json={'mode': 'paper'})).status_code == 401
                headers = {'Authorization': 'Bearer test'}
                assert (await client.post(route, headers={**headers, 'Origin': 'https://evil.example'}, json={'mode': 'paper'})).status_code == 403
                assert (await client.post(route, headers=headers, json={'mode': 'wrong'})).status_code == 422
                assert (await client.post(route, headers=headers, json={'mode': 'paper', 'readonly': False})).status_code == 422
                assert (await client.post(route, headers=headers, json={'mode': 'paper'})).json()['apiPort'] == 45122
                assert (await client.post('/api/ibkr-terminal/gateway/disconnect', headers=headers, json={'mode': 'paper'})).json()['phase'] == 'waiting'
                assert calls == ['paper', 'stop:paper']
                assert (await client.post('/api/ibkr-terminal/orders', headers=headers, json={})).status_code == 403
        api_event_loop.run_until_complete(scenario())


def test_paper_transport_route_requires_explicit_confirmation_and_never_accepts_live(tmp_path, api_event_loop):
    with SnapshotStore(tmp_path / 'db') as store:
        app = create_app(store=store, session_token='test')
        calls = []
        async def enable_paper_orders():
            calls.append('paper')
            return {'phase': 'ready', 'apiPort': 4002, 'detail': '模拟盘订单通道已连接'}
        app.state.gateway_runtime = SimpleNamespace(enable_paper_orders=enable_paper_orders)
        async def scenario():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1:8765') as client:
                route='/api/ibkr-terminal/gateway/paper-orders'
                headers={'Authorization':'Bearer test'}
                assert (await client.post(route,headers=headers,json={})).status_code==422
                assert (await client.post(route,headers=headers,json={'explicit':False})).status_code==422
                assert (await client.post(route,headers=headers,json={'explicit':True,'mode':'live'})).status_code==422
                response=await client.post(route,headers=headers,json={'explicit':True})
                assert response.status_code==200 and response.json()['apiPort']==4002
                assert calls==['paper']
        api_event_loop.run_until_complete(scenario())
