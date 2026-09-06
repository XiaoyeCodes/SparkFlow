import pytest

from src.ibkr_terminal.broker import OrderExecutor
from src.ibkr_terminal.reconcile import OrderReconciler
from src.ibkr_terminal.risk import RiskDenied
from test_orders import authorization, context, intent, ledger
from test_submission import FakeBroker
from test_order_events import event


class CancelBroker(FakeBroker):
    def __init__(self, *, cancel_timeout=False):
        super().__init__()
        self.cancels = []
        self.cancel_timeout = cancel_timeout

    def cancel(self, command):
        self.cancels.append(command)
        if self.cancel_timeout:
            raise TimeoutError('engineering cancellation receipt lost')


def prepare(db, broker):
    db.record_authorization(authorization())
    db.reserve(intent(), context(totalCash='1000'))
    executor = OrderExecutor(db, broker)
    executor.submit('paper:engineering', 'paper', 'intent-1', context(totalCash='1000'))
    return executor


def test_cancel_send_is_idempotent_and_is_not_broker_cancel_confirmation(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        fake = CancelBroker()
        executor = prepare(db, fake)
        for _ in range(2):
            row = executor.cancel('paper:engineering', 'paper', 'intent-1', 'cancel-1')
            assert row.cancelState == 'REQUESTED' and row.execution == 'CANCEL_PENDING'
        assert len(fake.cancels) == 1
        assert fake.cancels[0].identity == row.identity
        assert fake.cancels[0].permId == 901
        assert row.reservedCash == '601'
        rec = OrderReconciler(db, 'paper:engineering', 'paper', 1)
        rec.apply(event('cancel-ack', status='CANCELLED', filled='0', remaining='0'))
        assert db.get('paper:engineering', 'paper', 'intent-1').cancelState == 'ACKNOWLEDGED'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


def test_cancel_timeout_retains_hold_does_not_retry_and_keeps_tracking_fills(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        fake = CancelBroker(cancel_timeout=True)
        executor = prepare(db, fake)
        row = executor.cancel('paper:engineering', 'paper', 'intent-1', 'cancel-1')
        assert row.cancelState == 'UNKNOWN' and row.reservedCash == '601'
        executor.cancel('paper:engineering', 'paper', 'intent-1', 'cancel-1')
        executor.cancel('paper:engineering', 'paper', 'intent-1', 'different-request')
        assert len(fake.cancels) == 1
        rec = OrderReconciler(db, 'paper:engineering', 'paper', 1)
        rec.apply(event('filled-before-cancel', status='FILLED', filled='6', remaining='0'))
        row = db.get('paper:engineering', 'paper', 'intent-1')
        assert row.execution == 'FILLED' and row.cancelState == 'TOO_LATE'


def test_cancel_never_targets_foreign_client_or_non_fixture_transport(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        fake = CancelBroker()
        executor = prepare(db, fake)
        good_session = fake.session
        fake.session = lambda: good_session().model_copy(update={'clientId': 79})
        with pytest.raises(RiskDenied, match='BROKER_SESSION_SCOPE'):
            executor.cancel('paper:engineering', 'paper', 'intent-1', 'cancel-1')
        fake.source = 'ibkr'
        with pytest.raises(RiskDenied, match='BROKER_WRITE_DISABLED'):
            executor.cancel('paper:engineering', 'paper', 'intent-1', 'cancel-2')
        assert fake.cancels == []


def test_crash_after_cancel_claim_never_resends_on_restart(tmp_path):
    path = tmp_path / 'orders.db'
    fake = CancelBroker()
    with ledger(path) as db:
        prepare(db, fake)
        _, _, claimed = db.claim_cancel('paper:engineering', 'paper', 'intent-1', 'cancel-1', fake.session())
        assert claimed
    with ledger(path) as db:
        assert db.recover_inflight() == 1
        result = OrderExecutor(db, fake).cancel('paper:engineering', 'paper', 'intent-1', 'cancel-1')
        assert result.cancelState == 'UNKNOWN' and result.reconciliationRequired
        assert result.reservedCash == '601'
        assert fake.cancels == []


def test_immediate_broker_cancel_ack_is_not_overwritten_by_local_send_return(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        rec = OrderReconciler(db, 'paper:engineering', 'paper', 1)
        class ImmediateAck(CancelBroker):
            def cancel(self, command):
                with ledger(path) as observer:
                    assert observer.get('paper:engineering', 'paper', 'intent-1').cancelState == 'SUBMITTING'
                super().cancel(command)
                rec.apply(event('immediate-cancel-ack', status='CANCELLED', filled='0', remaining='0'))
        fake = ImmediateAck()
        executor = prepare(db, fake)
        result = executor.cancel('paper:engineering', 'paper', 'intent-1', 'cancel-1')
        assert result.cancelState == 'ACKNOWLEDGED' and result.execution == 'CANCELLED'
        assert len(fake.cancels) == 1 and result.reservedCash == '601'
