"""Native SDK wire serialization, always intercepted before any socket write."""
import asyncio
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
import hashlib
import sqlite3

import pytest

from src.ibkr_terminal.native_dispatch import NativeDispatcher, DispatchPermit, binding_hash, command_hash
from src.ibkr_terminal.identity import SubmissionCommand
from src.ibkr_terminal.managed_events import ManagedOrderObserver
from src.ibkr_terminal.reconcile import OrderReconciler
from src.ibkr_terminal.risk import RiskDenied, canonical
from src.ibkr_terminal.sdk import ObservedIB
from test_order_codec import inputs
from test_orders import NOW, authorization, context, intent, ledger
from test_submission import FakeBroker


@contextmanager
def harness(db, *, enabled=True, ack_timeout_seconds=10):
    binding, _, instrument = inputs()
    db.record_authorization(authorization())
    db.reserve(intent(), context(totalCash='1000'))
    row, _ = db.claim_submission('paper:engineering', 'paper', 'intent-1', context(totalCash='1000'), channel=FakeBroker().session())
    command = SubmissionCommand(intent=row.intent, identity=row.identity)
    observer = ManagedOrderObserver(OrderReconciler(db, binding.accountKey, 'paper', 1), binding,
        channel_key='engineering-gateway', source='fixture', current_revision=lambda: 1, clock=lambda: NOW)
    sdk = ObservedIB(managed_observer=observer)
    # Fixed SDK handshake state, explicitly engineering-only. No connect call.
    client = sdk.client
    client.host, client.port, client.clientId = binding.host, binding.port, binding.clientId
    client.connState, client._apiReady, client._hasReqId = client.CONNECTED, True, True
    client._serverVersion, client._reqIdSeq, client._accounts = 180, 71, [binding.brokerAccount]
    packets = []
    client.conn.sendMsg = lambda payload: packets.append(payload)
    dispatcher = NativeDispatcher(db, sdk, binding, channel_key='engineering-gateway',
        enabled=enabled, current_revision=lambda: 1, clock=lambda: NOW, ack_timeout_seconds=ack_timeout_seconds)
    permit = DispatchPermit(permitId='engineering-permit', commandHash=command_hash(command),
        bindingHash=binding_hash(binding), channelKey='engineering-gateway', accountKey=binding.accountKey,
        mode='paper', sessionRevision=1, source='fixture', purpose='submit',
        authorizationHash=hashlib.sha256(canonical(authorization()).encode()).hexdigest(),
        issuedAt=NOW-timedelta(seconds=1), expiresAt=NOW+timedelta(seconds=30),
        consentReference='engineering-only-not-user-authorization')
    try:
        yield dispatcher, sdk, packets, command, permit, instrument
    finally:
        dispatcher.close()
        sdk.client.reset()  # the handshake was simulated; no live connection to close


def test_default_disabled_and_missing_permit_never_reach_native_wire(tmp_path, api_event_loop):
    async def run():
        with ledger(tmp_path / 'orders.db') as db, harness(db, enabled=False) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            with pytest.raises(RiskDenied, match='BROKER_WRITE_DISABLED'):
                dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            dispatcher.enabled = True
            with pytest.raises(RiskDenied, match='DISPATCH_PERMIT_MISSING'):
                dispatcher.dispatch(command, 'missing', instrument=instrument, context=context(totalCash='1000'))
            assert packets == [] and not sdk.client._msgQ
    api_event_loop.run_until_complete(run())


def test_native_command_is_sent_once_after_durable_claim_and_waits_for_raw_ack(tmp_path, api_event_loop):
    async def run():
        from ib_async import OrderState
        from src.ibkr_terminal.order_codec import encode_order
        path = tmp_path / 'orders.db'
        with ledger(path) as db, harness(db) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            def capture(payload):
                with sqlite3.connect(path) as another:
                    assert another.execute('SELECT state FROM sdk_dispatch_attempts').fetchone()[0] == 'WRITING'
                    assert another.execute('SELECT count(*) FROM order_attempts').fetchone()[0] == 1
                packets.append(payload)
            sdk.client.conn.sendMsg = capture
            result = dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert result.state == 'SENT'
            dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert len(packets) == 1
            wire = packets[0][4:].decode().split('\0')
            assert wire[0] == '3' and 'TEST-ACCOUNT' in wire and command.identity.orderRef in wire
            assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'SUBMITTING'
            native_contract, native_order = encode_order(command, inputs()[0], instrument)
            native_order.permId = 901
            sdk.wrapper.openOrder(71, native_contract, native_order, OrderState(status='Submitted'))
            assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'ACKNOWLEDGED'
            assert not sdk.client._msgQ
    api_event_loop.run_until_complete(run())


@pytest.mark.parametrize('failure', ['expired', 'revoked', 'grant_revoked', 'wrong_binding', 'wrong_account',
    'revision', 'disconnected', 'stale_quote', 'queued', 'throttled'])
def test_last_boundary_refuses_changed_permission_scope_or_sdk_state(tmp_path, api_event_loop, failure):
    async def run():
        with ledger(tmp_path / 'orders.db') as db, harness(db) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            state = context(totalCash='1000')
            if failure == 'expired':
                permit = permit.model_copy(update={'expiresAt': NOW})
            if failure == 'wrong_binding':
                permit = permit.model_copy(update={'bindingHash': 'f'*64})
            dispatcher.record_permit(permit)
            if failure == 'revoked': dispatcher.revoke_permit(permit.permitId)
            if failure == 'grant_revoked': db.revoke_authorization('fixture-auth')
            if failure == 'wrong_account': sdk.client._accounts = ['OTHER']
            if failure == 'revision': dispatcher.current_revision = lambda: 2
            if failure == 'disconnected': sdk.client._apiReady = False
            if failure == 'stale_quote': state = state.model_copy(update={'quoteAt': NOW-timedelta(hours=1)})
            if failure == 'queued': sdk.client._msgQ.append('unrelated-existing-request')
            if failure == 'throttled': sdk.client._timeQ.extend([asyncio.get_running_loop().time()]*sdk.client.MaxRequests)
            with pytest.raises(RiskDenied):
                dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=state)
            assert packets == []
            if failure == 'queued':
                assert list(sdk.client._msgQ) == ['unrelated-existing-request']
            else:
                assert not sdk.client._msgQ
    api_event_loop.run_until_complete(run())


def test_transport_exception_is_unknown_and_second_attempt_cannot_send(tmp_path, api_event_loop):
    async def run():
        with ledger(tmp_path / 'orders.db') as db, harness(db) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            def lost_ack(payload):
                packets.append(payload)
                raise ConnectionError('PRIVATE-ACCOUNT wire outcome unknown')
            sdk.client.conn.sendMsg = lost_ack
            result = dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert result.state == 'UNKNOWN'
            assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'UNKNOWN'
            dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert len(packets) == 1 and db.reservations('paper:engineering', 'paper')['cash'] == '601'
            assert 'PRIVATE-ACCOUNT' not in str(db.audit('paper:engineering'))
    api_event_loop.run_until_complete(run())


def test_ack_timeout_is_durable_unknown_and_does_not_block_loop(tmp_path, api_event_loop):
    async def run():
        with ledger(tmp_path / 'orders.db') as db, harness(db, ack_timeout_seconds=0.01) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            result = dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert result.state == 'SENT'
            await asyncio.sleep(0.03)
            row = db.get('paper:engineering', 'paper', 'intent-1')
            assert row.submission == 'UNKNOWN' and row.lastError == 'SDK_ACK_TIMEOUT'
            assert dispatcher.pending_count == 0
            dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert len(packets) == 1
    api_event_loop.run_until_complete(run())


def test_permission_expiring_during_sdk_encoding_is_checked_at_wire_boundary(tmp_path, api_event_loop):
    async def run():
        with ledger(tmp_path / 'orders.db') as db, harness(db) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            original = sdk.client.placeOrder
            def delayed_encoding(*args):
                dispatcher.clock = lambda: permit.expiresAt
                return original(*args)
            sdk.client.placeOrder = delayed_encoding
            with pytest.raises(RiskDenied, match='DISPATCH_PERMIT_EXPIRED'):
                dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert packets == [] and not sdk.client._msgQ
    api_event_loop.run_until_complete(run())


def test_process_interruption_after_send_keeps_durable_unknown_without_replay(tmp_path, api_event_loop):
    class Interrupted(BaseException):
        pass
    async def run():
        with ledger(tmp_path / 'orders.db') as db, harness(db) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            def interrupted(payload):
                packets.append(payload)
                raise Interrupted()
            sdk.client.conn.sendMsg = interrupted
            with pytest.raises(Interrupted):
                dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'UNKNOWN'
            again = dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert again.state == 'UNKNOWN' and len(packets) == 1
    api_event_loop.run_until_complete(run())


def test_restart_checkpoint_never_resends_sent_native_command(tmp_path, api_event_loop):
    async def run():
        copied = tmp_path / 'restart.db'
        with ledger(tmp_path / 'orders.db') as db, harness(db) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            with sqlite3.connect(copied) as backup:
                db._db.backup(backup)
        with ledger(copied) as restored:
            assert restored.recover_inflight() == 1
            assert restored.get('paper:engineering', 'paper', 'intent-1').submission == 'UNKNOWN'
            assert restored._db.execute('SELECT state FROM sdk_dispatch_attempts').fetchone()[0] == 'UNKNOWN'
            assert restored.reservations('paper:engineering', 'paper')['cash'] == '601'
    api_event_loop.run_until_complete(run())


def test_truthy_configuration_and_changed_permit_cannot_enable_or_expand_scope(tmp_path, api_event_loop):
    from src.ibkr_terminal.orders import IntentConflict
    async def run():
        with ledger(tmp_path / 'orders.db') as db, harness(db) as values:
            dispatcher, sdk, packets, command, permit, instrument = values
            dispatcher.record_permit(permit)
            with pytest.raises(IntentConflict):
                dispatcher.record_permit(permit.model_copy(update={'mode': 'live', 'accountKey': 'live:engineering'}))
            dispatcher.enabled = 'false'
            with pytest.raises(RiskDenied, match='BROKER_WRITE_DISABLED'):
                dispatcher.dispatch(command, permit.permitId, instrument=instrument, context=context(totalCash='1000'))
            assert packets == []
    api_event_loop.run_until_complete(run())
