import sqlite3

import pytest

from src.ibkr_terminal.amendments import Amendment, AmendmentManager, amendment_hash
from src.ibkr_terminal.broker import OrderExecutor
from src.ibkr_terminal.identity import ReadOrderEvidence
from src.ibkr_terminal.orders import IntentConflict
from src.ibkr_terminal.reconcile import OrderReconciler
from src.ibkr_terminal.risk import RiskDenied
from test_order_events import event, proof, fill, fee
from test_orders import authorization, context, intent, ledger
from test_submission import FakeBroker


class ModifyBroker(FakeBroker):
    def __init__(self, *, timeout=False):
        super().__init__()
        self.modifications = []
        self.timeout = timeout

    def modify(self, command):
        self.modifications.append(command)
        if self.timeout:
            raise TimeoutError('engineering modification acknowledgement lost')


def prepare(db, *, quantity='8'):
    db.record_authorization(authorization())
    db.reserve(intent(), context(totalCash='1000'))
    OrderExecutor(db, FakeBroker()).submit('paper:engineering', 'paper', 'intent-1', context(totalCash='1000'))
    rec = OrderReconciler(db, 'paper:engineering', 'paper', 1)
    rec.apply(event('initial-open'))
    checkpoint = proof(rec, cashBalance='1000', positions={})
    rec.reconcile(checkpoint)
    state = context(totalCash='1000', snapshotId=checkpoint.snapshotId, asOf=checkpoint.cashObservedAt)
    request = Amendment(amendmentId='amend-1', accountKey='paper:engineering', mode='paper', clientIntentId='intent-1',
        expectedVersion=1, sessionRevision=1, authorizationId='amend-auth', snapshotId=state.snapshotId, quantity=quantity, limitPrice='100')
    grant = authorization(authorizationId='amend-auth', purpose='amend_order', kind='manual', confirmedIntentHash=amendment_hash(request))
    db.record_authorization(grant)
    return rec, state, request


def confirmed(command):
    return ReadOrderEvidence(channelKey=command.identity.channelKey, source='fixture', accountKey=command.intent.accountKey,
        mode=command.intent.mode, sessionRevision=1, clientId=command.identity.clientId, orderId=command.identity.orderId,
        orderRef=command.identity.orderRef, permId=command.permId, conId=command.intent.conId, side=command.intent.side,
        quantity=command.intent.quantity, orderType=command.intent.orderType, limitPrice=command.intent.limitPrice, tif=command.intent.tif)


def test_increase_is_reserved_before_send_and_original_intent_remains_immutable(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, state, request = prepare(db)
        fake = ModifyBroker()
        manager = AmendmentManager(db, fake)
        before = db.get('paper:engineering', 'paper', 'intent-1')
        manager.prepare(request, state)
        assert db.reservations('paper:engineering', 'paper')['cash'] == '801'
        manager.send(request.accountKey, request.mode, request.amendmentId, state)
        manager.send(request.accountKey, request.mode, request.amendmentId, state)
        assert len(fake.modifications) == 1
        command = fake.modifications[0]
        assert command.identity == before.identity and command.permId == 901
        assert db.get('paper:engineering', 'paper', 'intent-1').orderVersion == 1
        manager.confirm(request.amendmentId, confirmed(command))
        after = db.get('paper:engineering', 'paper', 'intent-1')
        assert after.orderVersion == 2 and after.terms.quantity == '8'
        assert after.intent == before.intent and after.bodyHash == before.bodyHash
        assert after.reconciliationRequired
        rec.apply(event('amended-open', remaining='8'))
        rec.reconcile(proof(rec, cashBalance='1000', positions={}))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '801'


def test_decrease_keeps_old_risk_until_read_confirmation_and_account_reconcile(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, state, request = prepare(db, quantity='4')
        fake = ModifyBroker()
        manager = AmendmentManager(db, fake)
        manager.prepare(request, state)
        manager.send(request.accountKey, request.mode, request.amendmentId, state)
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        manager.confirm(request.amendmentId, confirmed(fake.modifications[0]))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        rec.apply(event('smaller-open', remaining='4'))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        rec.reconcile(proof(rec, cashBalance='1000', positions={}))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '401'


def test_modification_requires_its_own_confirmation_and_version(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        _, state, request = prepare(db)
        manager = AmendmentManager(db, ModifyBroker())
        with pytest.raises(RiskDenied, match='AUTHORIZATION_PURPOSE'):
            manager.prepare(request.model_copy(update={'authorizationId': 'fixture-auth'}), state)
        with pytest.raises(RiskDenied, match='MANUAL_CONFIRMATION'):
            manager.prepare(request.model_copy(update={'quantity': '9'}), state)
        with pytest.raises(RiskDenied, match='ORDER_VERSION'):
            manager.prepare(request.model_copy(update={'expectedVersion': 2}), state)
        manager.prepare(request, state)
        with pytest.raises(IntentConflict):
            manager.prepare(request.model_copy(update={'quantity': '9'}), state)


def test_lost_amendment_ack_does_not_retry_or_release_worst_case_reservation(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        _, state, request = prepare(db)
        fake = ModifyBroker(timeout=True)
        manager = AmendmentManager(db, fake)
        manager.prepare(request, state)
        result = manager.send(request.accountKey, request.mode, request.amendmentId, state)
        assert result.amendmentState == 'UNKNOWN' and result.reservedCash == '801'
        manager.send(request.accountKey, request.mode, request.amendmentId, state)
        assert len(fake.modifications) == 1
        with pytest.raises(RiskDenied, match='UNRESOLVED_ORDER'):
            db.reserve(intent('next', quantity='1'), state)


def test_partial_fill_amendment_reserves_remaining_shares_without_double_counting_fills(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, _, request = prepare(db)
        rec.apply(fill('two-filled', 'EX-1', '2', '99'))
        rec.apply(fee('fee', 'EX-1', '0.25'))
        rec.apply(event('partial', status='PARTIALLY_FILLED', filled='2', remaining='4'))
        checkpoint = proof(rec, cashBalance='801.75', positions={12: '2'})
        rec.reconcile(checkpoint)
        state = context(snapshotId=checkpoint.snapshotId, asOf=checkpoint.cashObservedAt, totalCash='801.75', settledCash='801.75',
            holdings=[dict(conId=12, quantity='2', marketValue='200', currency='USD')])
        request = request.model_copy(update={'amendmentId': 'partial-amend', 'authorizationId': 'partial-auth', 'snapshotId': state.snapshotId})
        db.record_authorization(authorization(authorizationId='partial-auth', purpose='amend_order', kind='manual', confirmedIntentHash=amendment_hash(request)))
        manager = AmendmentManager(db, ModifyBroker())
        row = manager.prepare(request, state)
        assert row.reservedCash == '601'  # 8 total - 2 already filled, plus fee reserve


def test_new_fill_between_preview_and_send_requires_reconciliation_not_submission(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        rec, state, request = prepare(db)
        fake = ModifyBroker()
        manager = AmendmentManager(db, fake)
        manager.prepare(request, state)
        rec.apply(fill('new-fill', 'EX-1', '1', '100'))
        assert db.get('paper:engineering', 'paper', 'intent-1').reservedCash == '801'
        with pytest.raises(RiskDenied, match='ORDER_NOT_READY_FOR_AMENDMENT'):
            manager.send(request.accountKey, request.mode, request.amendmentId, state)
        assert fake.modifications == []
        row = manager.discard(request.accountKey, request.mode, request.amendmentId)
        assert row.pendingAmendmentId is None and row.reconciliationRequired


def test_revoking_amendment_consent_after_preview_prevents_send(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        _, state, request = prepare(db)
        fake = ModifyBroker()
        manager = AmendmentManager(db, fake)
        manager.prepare(request, state)
        db.revoke_authorization(request.authorizationId)
        with pytest.raises(RiskDenied, match='AUTHORIZATION_REVOKED'):
            manager.send(request.accountKey, request.mode, request.amendmentId, state)
        assert fake.modifications == []


def test_increasing_order_size_cannot_skip_cash_reservation_check(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        _, state, request = prepare(db)
        manager = AmendmentManager(db, ModifyBroker())
        with pytest.raises(RiskDenied, match='INSUFFICIENT_CASH'):
            manager.prepare(request, state.model_copy(update={'settledCash': '700'}))
        assert db.get('paper:engineering', 'paper', 'intent-1').pendingAmendmentId is None
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


def test_amendment_counts_toward_account_command_frequency_limits(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        _, state, request = prepare(db)
        request = request.model_copy(update={'authorizationId': 'limited-amend'})
        grant = authorization(authorizationId='limited-amend', purpose='amend_order', kind='manual', confirmedIntentHash=amendment_hash(request))
        db.record_authorization(grant.model_copy(update={'limits': grant.limits.model_copy(update={'maxDailyOrders': 1})}))
        with pytest.raises(RiskDenied, match='DAILY_ORDER_LIMIT'):
            AmendmentManager(db, ModifyBroker()).prepare(request, state)


def test_crash_while_cancel_and_amend_are_inflight_recovers_both_states(tmp_path):
    checkpoint = tmp_path / 'crash-checkpoint.db'
    with ledger(tmp_path / 'orders.db') as db:
        _, state, request = prepare(db)
        class CaptureCrash(ModifyBroker):
            def modify(self, command):
                _, _, claimed = db.claim_cancel('paper:engineering', 'paper', 'intent-1', 'cancel-while-amending', self.session())
                assert claimed
                with sqlite3.connect(checkpoint) as snapshot:
                    db._db.backup(snapshot)
                super().modify(command)
        manager = AmendmentManager(db, CaptureCrash())
        manager.prepare(request, state)
        manager.send(request.accountKey, request.mode, request.amendmentId, state)
    with ledger(checkpoint) as restored:
        assert restored.recover_inflight() == 2
        record = restored.get('paper:engineering', 'paper', 'intent-1')
        assert record.cancelState == 'UNKNOWN' and record.amendmentState == 'UNKNOWN'
        assert record.reservedCash == '801' and record.reconciliationRequired
