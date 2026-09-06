from datetime import timedelta

import pytest

from src.ibkr_terminal.orders import OrderLedger
from src.ibkr_terminal.strategy import StrategyCatalog
from src.ibkr_terminal.strategy_runtime import RuntimeSignal, StrategyRuntime, runtime_strategy_version
from test_orders import NOW, authorization, context
from test_strategy import definition


def setup(tmp_path, *, cash='1000'):
    catalog = StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW)
    record = catalog.save(definition())
    orders = OrderLedger(tmp_path / 'orders.sqlite', allow_fixtures=True, clock=lambda: NOW)
    version = runtime_strategy_version(record)
    orders.record_authorization(authorization(strategyVersion=version))
    runtime = StrategyRuntime(tmp_path / 'runtime.sqlite', orders, allow_fixtures=True, clock=lambda: NOW)
    active = runtime.activate(record, account_key='paper:engineering', mode='paper', session_revision=1,
        authorization_id='fixture-auth', expires_at=NOW + timedelta(hours=1), explicit=True)
    runtime.resume(active.activationId, context(settledCash=cash, totalCash=cash))
    return catalog, orders, runtime, record, active


def signal(record, sequence=1, target='2', **changes):
    values = dict(strategyHash=record.strategyHash, accountKey='paper:engineering', mode='paper', sequence=sequence,
        observedAt=NOW, snapshotId='engineering-snapshot', conId=12, targetQuantity=target, source='fixture')
    values.update(changes)
    return RuntimeSignal(**values)


def test_signal_persists_one_deterministic_intent_and_duplicate_is_idempotent(tmp_path):
    catalog, orders, runtime, record, active = setup(tmp_path)
    try:
        first = runtime.process(active.activationId, signal(record), context(totalCash='1000'))
        second = runtime.process(active.activationId, signal(record), context(totalCash='1000'))
        assert first == second and first.state == 'ORDER_PERSISTED'
        assert orders.get('paper:engineering', 'paper', first.clientIntentId).intent.quantity == '2'
        assert orders.reservations('paper:engineering', 'paper')['cash'] == '201'
        with pytest.raises(ValueError, match='SIGNAL_SEQUENCE_CONFLICT'):
            runtime.process(active.activationId, signal(record, target='3'), context(totalCash='1000'))
        assert runtime.get(active.activationId).state == 'HALTED'
    finally:
        runtime.close(); orders.close(); catalog.close()


def test_stale_quote_denial_is_recorded_without_bypassing_shared_order_risk(tmp_path):
    catalog, orders, runtime, record, active = setup(tmp_path)
    try:
        quote_at = NOW - timedelta(seconds=20)
        decision = runtime.process(active.activationId, signal(record, observedAt=quote_at), context(quoteAt=quote_at, totalCash='1000'))
        assert decision.state == 'DENIED' and decision.reason == 'STALE_QUOTE'
        assert orders.reservations('paper:engineering', 'paper')['cash'] == '0'
        assert runtime.get(active.activationId).lastSignalSequence == 1
    finally:
        runtime.close(); orders.close(); catalog.close()


def test_restart_requires_fresh_reconciliation_and_sequence_gaps_halt(tmp_path):
    catalog, orders, runtime, record, active = setup(tmp_path)
    runtime.close()
    runtime = StrategyRuntime(tmp_path / 'runtime.sqlite', orders, allow_fixtures=True, clock=lambda: NOW)
    try:
        assert runtime.get(active.activationId).state == 'RECOVERY_REQUIRED'
        with pytest.raises(ValueError, match='RECONCILIATION_REQUIRED'):
            runtime.resume(active.activationId, context(reconciled=False))
        runtime.resume(active.activationId, context())
        with pytest.raises(ValueError, match='SIGNAL_GAP'):
            runtime.process(active.activationId, signal(record, sequence=2), context())
        assert runtime.get(active.activationId).state == 'RECOVERY_REQUIRED'
    finally:
        runtime.close(); orders.close(); catalog.close()


def test_existing_position_can_make_signal_noop_and_stop_does_not_cancel_or_flatten(tmp_path):
    catalog, orders, runtime, record, active = setup(tmp_path)
    try:
        holding = dict(conId=12, quantity='2', marketValue='200', currency='USD')
        decision = runtime.process(active.activationId, signal(record), context(holdings=[holding], totalCash='1000'))
        assert decision.state == 'NOOP' and decision.clientIntentId is None
        stopped = runtime.stop(active.activationId)
        assert stopped.state == 'STOPPED' and orders.reservations('paper:engineering', 'paper')['cash'] == '0'
    finally:
        runtime.close(); orders.close(); catalog.close()


def test_fixture_runtime_is_disabled_in_production_and_live_requires_separate_implementation(tmp_path):
    with StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog, \
        OrderLedger(tmp_path / 'orders.sqlite', allow_fixtures=True, clock=lambda: NOW) as orders:
        record = catalog.save(definition())
        with StrategyRuntime(tmp_path / 'runtime.sqlite', orders, clock=lambda: NOW) as runtime:
            with pytest.raises(ValueError, match='FIXTURE_RUNTIME_DISABLED'):
                runtime.activate(record, account_key='paper:engineering', mode='paper', session_revision=1,
                    authorization_id='fixture-auth', expires_at=NOW + timedelta(hours=1), explicit=True)
        with StrategyRuntime(tmp_path / 'runtime-fixture.sqlite', orders, allow_fixtures=True, clock=lambda: NOW) as runtime:
            with pytest.raises(ValueError, match='LIVE_RUNTIME_DISABLED'):
                runtime.activate(record, account_key='live:engineering', mode='live', session_revision=1,
                    authorization_id='fixture-auth', expires_at=NOW + timedelta(hours=1), explicit=True)


def test_two_strategy_activations_share_the_same_atomic_cash_reservation(tmp_path):
    with StrategyCatalog(tmp_path / 'strategies.sqlite', allow_fixtures=True, clock=lambda: NOW) as catalog, \
        OrderLedger(tmp_path / 'orders.sqlite', allow_fixtures=True, clock=lambda: NOW) as orders, \
        StrategyRuntime(tmp_path / 'runtime.sqlite', orders, allow_fixtures=True, clock=lambda: NOW) as runtime:
        first = catalog.save(definition())
        second = catalog.save(definition(version='1.0.1', parameters={'targetQuantity': '2'}))
        orders.record_authorization(authorization(strategyVersion=runtime_strategy_version(first)))
        orders.record_authorization(authorization(authorizationId='fixture-auth-2', strategyVersion=runtime_strategy_version(second)))
        a = runtime.activate(first, account_key='paper:engineering', mode='paper', session_revision=1,
            authorization_id='fixture-auth', expires_at=NOW + timedelta(hours=1), explicit=True)
        b = runtime.activate(second, account_key='paper:engineering', mode='paper', session_revision=1,
            authorization_id='fixture-auth-2', expires_at=NOW + timedelta(hours=1), explicit=True)
        shared = context(settledCash='300', totalCash='300')
        runtime.resume(a.activationId, shared); runtime.resume(b.activationId, shared)
        assert runtime.process(a.activationId, signal(first), shared).state == 'ORDER_PERSISTED'
        denied = runtime.process(b.activationId, signal(second), shared)
        assert denied.state == 'DENIED' and denied.reason == 'INSUFFICIENT_CASH'
