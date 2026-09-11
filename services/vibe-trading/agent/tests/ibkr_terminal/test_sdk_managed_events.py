"""Raw pinned SDK callbacks over engineering ledgers, with sockets disabled."""
from datetime import timedelta
from decimal import Decimal

import pytest

from src.ibkr_terminal.managed_events import ManagedOrderObserver
from src.ibkr_terminal.sdk import ObservedIB
from src.ibkr_terminal.risk import RiskDenied
from test_order_codec import inputs
from test_order_events import setup, proof
from test_orders import NOW, ledger, intent, context


def bridge(db):
    rec = setup(db)
    binding, _, _ = inputs()
    observer = ManagedOrderObserver(rec, binding, channel_key='engineering-gateway', source='fixture',
        current_revision=lambda: 1, clock=lambda: NOW)
    return rec, observer


def native(db, *, exec_id='0001.abcd.01.01', quantity='2', **changes):
    from ib_async import Contract, Execution
    row = db.get('paper:engineering', 'paper', 'intent-1')
    data = dict(execId=exec_id, time=NOW, acctNumber='TEST-ACCOUNT', orderId=71, clientId=78, permId=901,
        orderRef=row.identity.orderRef, side='BOT', shares=Decimal(quantity), price=99.0)
    data.update(changes)
    return Contract(conId=12, symbol='TEST', secType='STK', currency='USD'), Execution(**data)


def status(observer, name='Submitted', filled=0, remaining=6, **changes):
    values = dict(orderId=71, status=name, filled=filled, remaining=remaining, permId=901, clientId=78)
    values.update(changes)
    return observer.order_status(**values)


def test_raw_sdk_partial_cancel_commission_and_duplicate_replay(tmp_path, api_event_loop):
    async def run():
        from ib_async import CommissionReport
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer = bridge(db)
            sdk = ObservedIB(managed_observer=observer)
            contract, execution = native(db)
            # No SDK Trade exists; high level execDetailsEvent would omit this.
            sdk.wrapper.execDetails(-1, contract, execution)
            sdk.wrapper.execDetails(-1, contract, execution)
            assert db.get('paper:engineering', 'paper', 'intent-1').filledQuantity == '2'
            sdk.wrapper.orderStatus(71, 'Submitted', 2, 4, 99, 901, 0, 99, 78, '')
            assert db.get('paper:engineering', 'paper', 'intent-1').execution == 'PARTIALLY_FILLED'
            rec.request_cancel('intent-1', 'cancel-test')
            sdk.wrapper.orderStatus(71, 'Cancelled', 2, 0, 99, 901, 0, 99, 78, '')
            assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
            with pytest.raises(RiskDenied, match='COMMISSION_PENDING'):
                rec.reconcile(proof(rec, cashBalance='801.75', positions={12: '2'}))
            report = CommissionReport(execId=execution.execId, commission=0.25, currency='USD')
            sdk.wrapper.commissionReport(report)
            count = rec.watermark()
            sdk.wrapper.commissionReport(report)
            assert rec.watermark() == count
            rec.reconcile(proof(rec, cashBalance='801.75', positions={12: '2'}))
            assert db.reservations('paper:engineering', 'paper')['cash'] == '0'
            assert not sdk.isConnected()
    api_event_loop.run_until_complete(run())


def test_execution_correction_chain_survives_restart_and_old_duplicate(tmp_path):
    from ib_async import CommissionReport
    from src.ibkr_terminal.reconcile import OrderReconciler
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        rec, observer = bridge(db)
        observer.execution(*native(db))
    with ledger(path) as db:
        rec = OrderReconciler(db, 'paper:engineering', 'paper', 1)
        observer = ManagedOrderObserver(rec, inputs()[0], channel_key='engineering-gateway', source='fixture',
            current_revision=lambda: 1, clock=lambda: NOW + timedelta(seconds=1))
        observer.execution(*native(db, exec_id='0001.abcd.01.02', quantity='1'))
        observer.execution(*native(db, exec_id='0001.abcd.01.02', quantity='1'))
        observer.execution(*native(db))
        assert len(rec.executions(include_superseded=True)) == 2
        assert rec.executions()[0].replacesExecId == '0001.abcd.01.01'
        assert db.get('paper:engineering', 'paper', 'intent-1').filledQuantity == '1'
        observer.commission(CommissionReport(execId='0001.abcd.01.02', commission=-0.1, currency='USD'))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


@pytest.mark.parametrize('changes', [dict(acctNumber='OTHER-ACCOUNT'), dict(orderRef='foreign-ref'),
    dict(time=NOW.replace(tzinfo=None)), dict(shares=Decimal('NaN'))])
def test_invalid_managed_execution_is_rejected_without_mutation(tmp_path, changes):
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        with pytest.raises(RiskDenied):
            observer.execution(*native(db, **changes))
        assert rec.executions() == []


def test_external_callback_and_wrong_session_do_not_gain_ownership(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        assert observer.execution(*native(db, orderId=999, permId=999)) is None
        assert status(observer, orderId=999, permId=999) is None
        observer.current_revision = lambda: 2
        with pytest.raises(RiskDenied, match='SDK_SESSION_CHANGED'):
            status(observer)
        assert rec.watermark() == 0


def test_inactive_and_missing_counters_cannot_release_risk(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        status(observer, 'Inactive')
        assert db.get('paper:engineering', 'paper', 'intent-1').execution == 'INACTIVE'
        with pytest.raises(RiskDenied, match='INACTIVE_ORDER_UNRESOLVED'):
            rec.reconcile(proof(rec, cashBalance='1000', positions={}))
        for bad in (None, float('nan'), float('inf')):
            with pytest.raises(RiskDenied):
                status(observer, filled=bad)
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


def test_missing_correction_predecessor_and_unknown_fee_are_not_invented(tmp_path):
    from ib_async import CommissionReport
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        with pytest.raises(RiskDenied, match='SDK_CORRECTION_PREDECESSOR_MISSING'):
            observer.execution(*native(db, exec_id='0001.abcd.01.02'))
        assert observer.commission(CommissionReport(execId='external.01', commission=0.25, currency='USD')) is None
        assert rec.watermark() == 0


def test_raw_callback_failure_persists_halt_without_raw_account_error(tmp_path, api_event_loop):
    async def run():
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer = bridge(db)
            sdk = ObservedIB(managed_observer=observer)
            sdk.wrapper.execDetails(-1, *native(db, acctNumber='SECRET-ACCOUNT'))
            with pytest.raises(RiskDenied, match='ACCOUNT_INTEGRITY_HALT'):
                db.reserve(intent('next', quantity='1'), context())
            assert rec.executions() == []
            assert 'SECRET-ACCOUNT' not in str(db.audit('paper:engineering'))
    api_event_loop.run_until_complete(run())


def unknown_bridge(db):
    from src.ibkr_terminal.broker import OrderExecutor
    from src.ibkr_terminal.reconcile import OrderReconciler
    from test_orders import authorization
    from test_submission import FakeBroker
    db.record_authorization(authorization())
    db.reserve(intent(), context(totalCash='1000'))
    OrderExecutor(db, FakeBroker(fail=True)).submit('paper:engineering', 'paper', 'intent-1', context(totalCash='1000'))
    rec = OrderReconciler(db, 'paper:engineering', 'paper', 1)
    observer = ManagedOrderObserver(rec, inputs()[0], channel_key='engineering-gateway', source='fixture',
        current_revision=lambda: 1, clock=lambda: NOW)
    from src.ibkr_terminal.identity import SubmissionCommand
    from src.ibkr_terminal.order_codec import encode_order
    row = db.get('paper:engineering', 'paper', 'intent-1')
    contract, order = encode_order(SubmissionCommand(intent=row.intent, identity=row.identity), inputs()[0], inputs()[2])
    order.permId = 901
    return rec, observer, contract, order


def test_raw_open_order_matches_unknown_without_inventing_fill_counters(tmp_path, api_event_loop):
    async def run():
        from ib_async import OrderState
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer, contract, order = unknown_bridge(db)
            sdk = ObservedIB(managed_observer=observer)
            sdk.wrapper.openOrder(71, contract, order, OrderState(status='Submitted'))
            row = db.get('paper:engineering', 'paper', 'intent-1')
            assert row.submission == 'ACKNOWLEDGED' and row.permId == 901
            assert row.brokerFilled is None and row.brokerRemaining is None
            assert row.reconciliationRequired and row.reservedCash == '601'
            assert rec.watermark() == 0
            sdk.wrapper.orderStatus(71, 'Submitted', 0, 6, 0, 901, 0, 0, 78, '')
            assert rec.watermark() == 1
    api_event_loop.run_until_complete(run())


def test_order_status_before_open_order_waits_for_full_identity_without_freezing_account(tmp_path, api_event_loop):
    async def run():
        from ib_async import OrderState
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer, contract, order = unknown_bridge(db)
            sdk = ObservedIB(managed_observer=observer)
            sdk.wrapper.orderStatus(71, 'Submitted', 0, 6, 0, 901, 0, 0, 78, '')
            before = db.get('paper:engineering', 'paper', 'intent-1')
            assert before.permId is None and rec.watermark() == 0
            assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone()
            sdk.wrapper.openOrder(71, contract, order, OrderState(status='Submitted'))
            sdk.wrapper.orderStatus(71, 'Submitted', 0, 6, 0, 901, 0, 0, 78, '')
            after = db.get('paper:engineering', 'paper', 'intent-1')
            assert after.permId == 901 and after.execution == 'OPEN' and rec.watermark() == 1
    api_event_loop.run_until_complete(run())


def test_identical_open_status_does_not_reopen_account_proof_barrier(tmp_path, api_event_loop):
    async def run():
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer = bridge(db)
            status(observer)
            db.clock = lambda: NOW + timedelta(seconds=2)
            rec.reconcile(proof(rec, cashBalance='1000', positions={}))
            before = db.get('paper:engineering', 'paper', 'intent-1')
            watermark = rec.watermark()
            status(observer)
            duplicate = db.get('paper:engineering', 'paper', 'intent-1')
            assert duplicate == before and rec.watermark() == watermark
            status(observer, name='Cancelled', filled=0, remaining=0)
            assert rec.watermark() == watermark + 1
            assert db.get('paper:engineering', 'paper', 'intent-1').execution == 'CANCELLED'
    api_event_loop.run_until_complete(run())


def test_confirmed_permanent_id_mismatch_still_freezes_account(tmp_path, api_event_loop):
    async def run():
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer = bridge(db)
            sdk = ObservedIB(managed_observer=observer)
            sdk.wrapper.orderStatus(71, 'Submitted', 0, 6, 0, 902, 0, 0, 78, '')
            assert rec.watermark() == 0
            assert db._db.execute('SELECT reason FROM order_integrity_halts').fetchone()[0] == 'SDK_ORDER_IDENTITY_MISMATCH'
    api_event_loop.run_until_complete(run())


@pytest.mark.parametrize('field,value', [('account', 'OTHER'), ('orderRef', 'EXTERNAL'),
    ('totalQuantity', Decimal('7')), ('lmtPrice', 101.0)])
def test_unknown_read_requires_full_identity_and_order_body(tmp_path, field, value):
    from ib_async import OrderState
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer, contract, order = unknown_bridge(db)
        setattr(order, field, value)
        with pytest.raises(RiskDenied):
            observer.open_order(71, contract, order, OrderState(status='Submitted'))
        assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'UNKNOWN'
        assert rec.watermark() == 0


def test_what_if_open_reply_never_acknowledges_a_submission(tmp_path):
    from ib_async import OrderState
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer, contract, order = unknown_bridge(db)
        order.whatIf = True
        assert observer.open_order(71, contract, order, OrderState(status='Submitted')) is None
        assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'UNKNOWN'


def test_legacy_regular_hours_only_paper_order_can_still_be_reconciled(tmp_path):
    from ib_async import OrderState
    with ledger(tmp_path / 'orders.db') as db:
        _, observer, contract, order = unknown_bridge(db)
        order.outsideRth = False  # Existing order created before the policy upgrade.
        observer.open_order(71, contract, order, OrderState(status='Submitted'))
        assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'ACKNOWLEDGED'


def test_raw_amendment_ack_keeps_identity_and_hold_until_account_proof(tmp_path, api_event_loop):
    async def run():
        from ib_async import OrderState
        from src.ibkr_terminal.amendments import AmendmentManager
        from src.ibkr_terminal.order_codec import encode_order
        from test_amendments import prepare, ModifyBroker
        with ledger(tmp_path / 'orders.db') as db:
            rec, state, request = prepare(db, quantity='4')
            fake = ModifyBroker(timeout=True)
            manager = AmendmentManager(db, fake)
            manager.prepare(request, state)
            manager.send(request.accountKey, request.mode, request.amendmentId, state)
            before = db.get('paper:engineering', 'paper', 'intent-1')
            observer = ManagedOrderObserver(rec, inputs()[0], channel_key='engineering-gateway', source='fixture',
                current_revision=lambda: 1, clock=db.clock)
            sdk = ObservedIB(managed_observer=observer)
            contract, order = encode_order(fake.modifications[0], inputs()[0], inputs()[2])
            sdk.wrapper.openOrder(71, contract, order, OrderState(status='Submitted'))
            after = db.get('paper:engineering', 'paper', 'intent-1')
            assert after.orderVersion == 2 and after.amendmentState == 'ACKNOWLEDGED'
            assert after.identity == before.identity and after.intent == before.intent
            assert after.reservedCash == '601' and after.brokerFilled is None
            sdk.wrapper.openOrder(71, contract, order, OrderState(status='Submitted'))
            assert db.get('paper:engineering', 'paper', 'intent-1').orderVersion == 2
            sdk.wrapper.orderStatus(71, 'Submitted', 0, 4, 0, 901, 0, 0, 78, '')
            rec.reconcile(proof(rec, cashBalance='1000', positions={}, cashObservedAt=NOW + timedelta(seconds=2),
                positionsObservedAt=NOW + timedelta(seconds=2)))
            assert db.reservations('paper:engineering', 'paper')['cash'] == '401'
            assert len(fake.modifications) == 1 and not sdk.isConnected()
    api_event_loop.run_until_complete(run())


def test_unsent_amendment_cannot_be_acknowledged_by_a_matching_read(tmp_path):
    from ib_async import OrderState
    from src.ibkr_terminal.amendments import AmendmentManager
    from src.ibkr_terminal.identity import ModificationCommand
    from src.ibkr_terminal.order_codec import encode_order
    from test_amendments import prepare, ModifyBroker
    with ledger(tmp_path / 'orders.db') as db:
        rec, state, request = prepare(db, quantity='4')
        row = AmendmentManager(db, ModifyBroker()).prepare(request, state)
        observer = ManagedOrderObserver(rec, inputs()[0], channel_key='engineering-gateway', source='fixture',
            current_revision=lambda: 1, clock=db.clock)
        command = ModificationCommand(intent=row.intent.model_copy(update={'quantity': '4'}), identity=row.identity,
            permId=row.permId, amendmentId=request.amendmentId, expectedVersion=1)
        contract, order = encode_order(command, inputs()[0], inputs()[2])
        with pytest.raises(RiskDenied, match='ORDER_VERSION'):
            observer.open_order(71, contract, order, OrderState(status='Submitted'))
        assert db.get('paper:engineering', 'paper', 'intent-1').orderVersion == 1


@pytest.mark.parametrize('error_code', [201, 321, 10147])
def test_raw_order_error_preserves_risk_without_freezing_manual_paper_account(tmp_path, api_event_loop, error_code, caplog):
    async def run():
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer = bridge(db)
            sdk = ObservedIB(managed_observer=observer)
            status(observer)
            sdk.wrapper.error(71, error_code, 'SECRET-ACCOUNT raw rejection detail', '{"secret": "PRIVATE"}')
            row = db.get('paper:engineering', 'paper', 'intent-1')
            assert row.lastError == f'IBKR_{error_code}'
            assert row.execution == 'OPEN' and row.reservedCash == '601' and row.reconciliationRequired
            assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone()
            next_intent = intent('next', quantity='1', authorizationId='manual-next')
            from test_orders import authorization
            from src.ibkr_terminal.risk import intent_hash
            db.record_authorization(authorization(authorizationId='manual-next', kind='manual',
                confirmedIntentHash=intent_hash(next_intent)))
            next_row = db.reserve(next_intent, context())
            assert next_row.submission == 'PERSISTED'
            assert db.reservations('paper:engineering', 'paper')['cash'] == '702'
            assert 'SECRET-ACCOUNT' not in str(db.audit('paper:engineering'))
            assert 'SECRET-ACCOUNT' not in caplog.text and 'PRIVATE' not in caplog.text
    api_event_loop.run_until_complete(run())


def test_cancelled_status_then_202_notice_releases_hold_and_allows_next_order(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        status(observer)
        rec.request_cancel('intent-1', 'cancel-test')
        status(observer, name='Cancelled', filled=0, remaining=0)
        observer.broker_error(71, 202, request_active=False)
        cancelled = db.get('paper:engineering', 'paper', 'intent-1')
        assert cancelled.execution == 'CANCELLED' and cancelled.lastError is None
        assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone()
        assert db.audit('paper:engineering')[-1]['kind'] == 'SDK_CANCELLATION_NOTICE'
        db.clock = lambda: NOW + timedelta(seconds=2)
        rec.reconcile(proof(rec, cashBalance='1000', positions={}))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'
        db.clock = lambda: NOW + timedelta(seconds=4)
        db.reserve(intent('next', quantity='1'), context(snapshotId='next-read', asOf=NOW+timedelta(seconds=3),
            totalCash='1000', settledCash='1000'))
        assert db.get('paper:engineering', 'paper', 'next').submission == 'PERSISTED'


def test_202_before_cancelled_status_keeps_hold_until_terminal_proof(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        status(observer)
        rec.request_cancel('intent-1', 'cancel-test')
        observer.broker_error(71, 202, request_active=False)
        pending = db.get('paper:engineering', 'paper', 'intent-1')
        assert pending.lastError == 'IBKR_202' and pending.reservedCash == '601'
        db.clock = lambda: NOW + timedelta(seconds=2)
        rec.reconcile(proof(rec, cashBalance='1000', positions={}))
        pending = db.get('paper:engineering', 'paper', 'intent-1')
        assert pending.execution == 'CANCEL_PENDING' and pending.reservedCash == '601'
        assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone()
        status(observer, name='Cancelled', filled=0, remaining=0)
        rec.reconcile(proof(rec, cashBalance='1000', positions={}))
        restored = db.get('paper:engineering', 'paper', 'intent-1')
        assert restored.execution == 'CANCELLED' and restored.lastError is None
        assert restored.reservedCash == '0' and not restored.reconciliationRequired
        assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone()


def test_request_error_id_collision_does_not_modify_order(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        before = db.get('paper:engineering', 'paper', 'intent-1')
        assert observer.broker_error(71, 321, request_active=True) is None
        assert observer.broker_error(999, 201, request_active=False) is None
        assert observer.broker_error(-1, 2104, request_active=False) is None
        assert db.get('paper:engineering', 'paper', 'intent-1') == before
        assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchall()


def test_connectivity_messages_gate_writes_without_creating_permanent_halt(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, observer = bridge(db)
        observer.broker_error(-1, 1100, request_active=False)
        assert not observer.broker_ready
        assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchall()
        observer.broker_error(-1, 1102, request_active=False)
        assert observer.broker_ready


@pytest.mark.parametrize('error_code', [300, 354, 10089, 10090, 10091, 10167, 10168, 10186, 10189, 10190, 10197])
def test_streaming_market_error_id_collision_never_changes_managed_order(tmp_path, api_event_loop, error_code):
    async def run():
        from ib_async import Contract
        with ledger(tmp_path / 'orders.db') as db:
            rec, observer = bridge(db)
            sdk = ObservedIB(managed_observer=observer)
            status(observer)
            before = db.get('paper:engineering', 'paper', 'intent-1')
            sdk.wrapper.startTicker(71, Contract(conId=12, symbol='TEST', secType='STK', exchange='SMART', currency='USD'), 'mktData')
            sdk.wrapper.error(71, error_code, 'private broker diagnostic')
            assert db.get('paper:engineering', 'paper', 'intent-1') == before
            assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchall()
    api_event_loop.run_until_complete(run())
