"""Deterministic engineering replay; no real paper/live traffic."""
from datetime import timedelta

import pytest

from src.ibkr_terminal.broker import OrderExecutor
from src.ibkr_terminal.reconcile import OrderReconciler, BrokerEvent, AccountProof
from src.ibkr_terminal.risk import RiskDenied, intent_hash
from decimal import Decimal
from test_orders import NOW, authorization, context, intent, ledger
from test_submission import FakeBroker


def event(key, kind='status', **changes):
    data = dict(eventId=key, kind=kind, accountKey='paper:engineering', mode='paper', source='fixture',
        sessionRevision=1, orderId=71, clientId=78, permId=901, observedAt=NOW,
        status='OPEN', filled='0', remaining='6')
    if kind != 'status':
        data.pop('status'); data.pop('filled'); data.pop('remaining')
    data.update(changes)
    return BrokerEvent.model_validate(data)


def setup(db):
    db.record_authorization(authorization())
    db.reserve(intent(), context(totalCash='1000'))
    OrderExecutor(db, FakeBroker()).submit('paper:engineering', 'paper', 'intent-1', context(totalCash='1000'))
    return OrderReconciler(db, 'paper:engineering', 'paper', 1)


def proof(reconciler, **changes):
    reconciler.ledger.clock = lambda: NOW + timedelta(seconds=2)
    data = dict(accountKey='paper:engineering', mode='paper', source='fixture', sessionRevision=1,
        snapshotId=f'engineering-after-{reconciler.watermark()}', watermark=reconciler.watermark(), cashBalance='701.5', currency='USD',
        positions={12: '3'}, cashObservedAt=NOW + timedelta(seconds=1), positionsObservedAt=NOW + timedelta(seconds=1))
    data.update(changes)
    return AccountProof.model_validate(data)


def fill(key, exec_id, quantity, price, **changes):
    return event(key, 'fill', execId=exec_id, conId=12, side='BUY', quantity=quantity, price=price,
        currency='USD', executedAt=NOW, **changes)


def fee(key, exec_id, amount):
    return event(key, 'commission', execId=exec_id, commission=amount, currency='USD')


def test_partial_fill_cancel_race_keeps_cash_until_broker_state_and_cash_agree(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec = setup(db)
        rec.apply(fill('fill-a', 'EX-1', '2', '99'))
        rec.apply(event('partial', status='PARTIALLY_FILLED', filled='2', remaining='4'))
        rec.request_cancel('intent-1', 'cancel-1')
        assert db.get('paper:engineering', 'paper', 'intent-1').execution == 'CANCEL_PENDING'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        rec.apply(fill('fill-b', 'EX-2', '1', '100'))  # can fill while cancellation is pending
        rec.apply(event('cancelled', status='CANCELLED', filled='3', remaining='0'))
        assert db.get('paper:engineering', 'paper', 'intent-1').filledQuantity == '3'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        with pytest.raises(RiskDenied, match='COMMISSION_PENDING'):
            rec.reconcile(proof(rec))
        rec.apply(fee('fee-a', 'EX-1', '0.25'))
        rec.apply(fee('fee-b', 'EX-2', '0.25'))
        with pytest.raises(RiskDenied, match='CASH_MISMATCH'):
            rec.reconcile(proof(rec, cashBalance='900'))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        rec.reconcile(proof(rec))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'
        row = db.get('paper:engineering', 'paper', 'intent-1')
        assert row.execution == 'CANCELLED' and not row.reconciliationRequired


def test_market_partial_fill_reconciles_actual_price_and_cancel_releases_only_proven_cash(tmp_path):
    with ledger(tmp_path/'market.db') as db:
        market = intent(orderType='MKT',limitPrice=None)
        db.record_authorization(authorization(kind='manual',confirmedIntentHash=intent_hash(market)))
        db.reserve(market,context(totalCash='1000'))
        OrderExecutor(db,FakeBroker()).submit('paper:engineering','paper','intent-1',context(totalCash='1000'))
        rec = OrderReconciler(db,'paper:engineering','paper',1)
        assert Decimal(db.reservations('paper:engineering','paper')['cash']) == Decimal('631')
        rec.apply(fill('market-fill','MKT-1','2','110'))
        rec.apply(event('market-partial',status='PARTIALLY_FILLED',filled='2',remaining='4'))
        rec.apply(fee('market-fee','MKT-1','0.25'))
        rec.reconcile(proof(rec,cashBalance='779.75',positions={12:'2'}))
        assert Decimal(db.reservations('paper:engineering','paper')['cash']) == Decimal('441')
        rec.request_cancel('intent-1','market-cancel')
        rec.apply(event('market-cancelled',status='CANCELLED',filled='2',remaining='0'))
        assert Decimal(db.reservations('paper:engineering','paper')['cash']) > 0
        rec.reconcile(proof(rec,cashBalance='779.75',positions={12:'2'}))
        assert db.reservations('paper:engineering','paper')['cash'] == '0'


def test_duplicates_and_stale_open_status_cannot_double_fill_or_reopen_terminal_order(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        rec = setup(db)
        original = fill('fill-a', 'EX-1', '2', '99')
        rec.apply(original)
        rec.apply(original.model_copy(update={'observedAt': NOW + timedelta(seconds=1)}))
        rec.apply(original.model_copy(update={'eventId': 'callback-duplicate'}))
        assert db.get('paper:engineering', 'paper', 'intent-1').filledQuantity == '2'
        rec.apply(event('cancel', status='CANCELLED', filled='2', remaining='0'))
        rec.apply(event('old-open', status='OPEN', filled='0', remaining='6'))
        assert db.get('paper:engineering', 'paper', 'intent-1').execution == 'CANCELLED'
    with ledger(path) as db:
        assert db.get('paper:engineering', 'paper', 'intent-1').filledQuantity == '2'
        assert len(OrderReconciler(db, 'paper:engineering', 'paper', 1).executions()) == 1


@pytest.mark.parametrize('changes', [{'accountKey': 'paper:other'}, {'mode': 'live'}, {'sessionRevision': 2}, {'permId': 902}, {'source': 'ibkr'}])
def test_foreign_account_revision_source_or_external_order_cannot_change_managed_ledger(tmp_path, changes):
    with ledger(tmp_path / 'orders.db') as db:
        rec = setup(db)
        before = db.get('paper:engineering', 'paper', 'intent-1')
        with pytest.raises(RiskDenied):
            rec.apply(fill('foreign', 'EX-X', '2', '99').model_copy(update=changes))
        assert db.get('paper:engineering', 'paper', 'intent-1') == before


def test_correction_keeps_original_execution_and_reestablishes_risk_hold(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec = setup(db)
        rec.apply(fill('fill-a', 'EX-1', '2', '99'))
        rec.apply(fee('fee-a', 'EX-1', '0.25'))
        rec.apply(event('cancel', status='CANCELLED', filled='2', remaining='0'))
        rec.reconcile(proof(rec, cashBalance='801.75', positions={12: '2'}))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'
        rec.apply(fill('correct', 'EX-1-C', '1', '99', replacesExecId='EX-1'))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        assert db.get('paper:engineering', 'paper', 'intent-1').filledQuantity == '1'
        assert len(rec.executions(include_superseded=True)) == 2
        with pytest.raises(RiskDenied, match='UNRESOLVED_ORDER'):
            db.reserve(intent('next', quantity='1'), context(totalCash='901'))
        rec.apply(fee('fee-correct', 'EX-1-C', '0.20'))
        rec.apply(event('corrected-status', status='CANCELLED', filled='1', remaining='0'))
        rec.reconcile(proof(rec, cashBalance='900.80', positions={12: '1'}))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'


def test_event_arriving_during_account_read_invalidates_reconciliation_barrier(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec = setup(db)
        rec.apply(event('cancel', status='CANCELLED', filled='0', remaining='0'))
        before_read = proof(rec, cashBalance='1000', positions={})
        rec.apply(fill('late', 'EX-LATE', '1', '100'))
        with pytest.raises(RiskDenied, match='EVENT_BARRIER_CHANGED'):
            rec.reconcile(before_read)
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


def test_released_reservation_cannot_be_spent_again_using_pre_fill_account_snapshot(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec = setup(db)
        rec.apply(fill('fill-a', 'EX-1', '2', '99'))
        rec.apply(fee('fee-a', 'EX-1', '0.25'))
        rec.apply(event('cancel', status='CANCELLED', filled='2', remaining='0'))
        fresh = proof(rec, cashBalance='801.75', positions={12: '2'})
        rec.reconcile(fresh)
        with pytest.raises(RiskDenied, match='STALE_ACCOUNT_CHECKPOINT'):
            db.reserve(intent('stale-next', quantity='9'), context(totalCash='1000'))
        db.reserve(intent('fresh-next', quantity='1'), context(snapshotId='subsequent-broker-read', asOf=fresh.cashObservedAt+timedelta(seconds=1),
            totalCash='801.75', settledCash='801.75', holdings=[dict(conId=12, quantity='2', marketValue='200', currency='USD')]))


def test_conflicting_execution_freezes_account_even_after_prior_reconciliation(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec = setup(db)
        rec.apply(fill('fill-a', 'EX-1', '2', '99'))
        with pytest.raises(RiskDenied, match='CONFLICTING_EXECUTION'):
            rec.apply(fill('bad-duplicate', 'EX-1', '5', '99'))
        assert db.get('paper:engineering', 'paper', 'intent-1').filledQuantity == '2'
        with pytest.raises(RiskDenied, match='ACCOUNT_INTEGRITY_HALT'):
            db.reserve(intent('next', quantity='1'), context(totalCash='1000'))


def test_unexplained_reopening_of_terminal_order_pauses_account(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec = setup(db)
        rec.apply(event('cancel', status='CANCELLED', filled='0', remaining='0'))
        with pytest.raises(RiskDenied, match='CONFLICTING_TERMINAL_STATUS'):
            rec.apply(event('reopened', status='OPEN', filled='0', remaining='6'))


def real_source_projection(db):
    rec = setup(db)
    with db.transaction():
        row = db.get('paper:engineering', 'paper', 'intent-1')
        db._replace(row.model_copy(update={'source': 'user', 'testData': False}), 'ENGINEERING_SOURCE')
    return rec


def test_legacy_timezone_replay_preserves_original_and_recovers_only_after_full_proof(tmp_path):
    from src.ibkr_terminal.audit import append_event, read_events
    with ledger(tmp_path/'time.db') as db:
        rec = real_source_projection(db)
        original = fill('fill-a', 'EX-1', '6', '99', source='ibkr').model_copy(
            update={'executedAt': NOW - timedelta(hours=8)})
        rec.apply(original)
        rec.apply(fee('fee-a', 'EX-1', '1.00003').model_copy(update={'source':'ibkr'}))
        rec.apply(event('filled', status='FILLED', filled='6', remaining='0', source='ibkr'))
        with db.transaction():
            db._db.execute('INSERT INTO order_integrity_halts VALUES(?,?,?)', ('paper','paper:engineering','CONFLICTING_EVENT_ID'))
            append_event(db._db,'paper:engineering','BROKER_EVIDENCE_CONFLICT',NOW.isoformat(),
                {'code':'CONFLICTING_EVENT_ID','eventId':'fill-a'})
        corrected = original.model_copy(update={'executedAt':NOW,'observedAt':NOW+timedelta(seconds=1)})
        rec.apply(corrected)
        rec.apply(corrected)  # replay is idempotent; no duplicate fill
        assert rec.executions()[0].executedAt == NOW
        assert len(rec.executions()) == 1
        stored = db._db.execute("SELECT payload FROM order_broker_events WHERE event_id='fill-a'").fetchone()[0]
        assert BrokerEvent.model_validate_json(stored).executedAt == NOW-timedelta(hours=8)
        with pytest.raises(RiskDenied, match='CASH_MISMATCH'):
            rec.reconcile(proof(rec, source='ibkr', cashBalance='405.01', positions={12:'6'}))
        assert db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone()
        rec.reconcile(proof(rec, source='ibkr', cashBalance='405.00', positions={12:'6'}))
        assert not db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone()
        assert db.reservations('paper:engineering','paper')['cash'] == '0'
        assert read_events(db._db,'paper:engineering')[-2]['kind'] == 'EXECUTION_TIME_HALT_RECOVERED'


@pytest.mark.parametrize('changes', [{'price':'100'}, {'quantity':'5'}, {'executedAt':NOW-timedelta(hours=1)}, {'executedAt':NOW-timedelta(seconds=30)}])
def test_timezone_repair_does_not_accept_financial_or_arbitrary_timestamp_conflicts(tmp_path, changes):
    with ledger(tmp_path/'bad-time.db') as db:
        rec = real_source_projection(db)
        original = fill('fill-a','EX-1','6','99',source='ibkr').model_copy(update={'executedAt':NOW-timedelta(hours=8)})
        rec.apply(original)
        replay = original.model_copy(update={'executedAt':NOW,'observedAt':NOW+timedelta(seconds=1),**changes})
        with pytest.raises(RiskDenied,match='CONFLICTING_EVENT_ID'):
            rec.apply(replay)
