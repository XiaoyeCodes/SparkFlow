from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event

import pytest

from src.ibkr_terminal.broker import BrokerAck, OrderExecutor
from src.ibkr_terminal.risk import RiskDenied
from src.ibkr_terminal.identity import BrokerSession
from test_orders import NOW, authorization, context, intent, ledger


class FakeBroker:
    source = 'fixture'

    def __init__(self, *, fail=False):
        self.calls = []
        self.fail = fail

    def session(self):
        return BrokerSession(channelKey='engineering-gateway', source=self.source, accountKey='paper:engineering', mode='paper', sessionRevision=1, clientId=78, nextValidId=71, ready=True)

    def submit(self, command):
        self.calls.append(command)
        if self.fail:
            raise TimeoutError('engineering: receipt lost after broker may have accepted')
        return BrokerAck(orderId=command.identity.orderId, clientId=command.identity.clientId, permId=901 + command.identity.orderId - 71)


def test_concurrent_duplicate_submission_calls_fake_broker_exactly_once(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        fake = FakeBroker()
        executor = OrderExecutor(db, fake)
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda _: executor.submit('paper:engineering', 'paper', 'intent-1', context()), range(20)))
        result = db.get('paper:engineering', 'paper', 'intent-1')
        assert len(fake.calls) == 1
        assert result.submission == 'ACKNOWLEDGED'
        assert (result.orderId, result.clientId, result.permId) == (71, 78, 901)
        assert result.reservedCash == '601'


def test_timeout_is_unknown_keeps_reservation_and_never_blindly_retries(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        fake = FakeBroker(fail=True)
        executor = OrderExecutor(db, fake)
        assert executor.submit('paper:engineering', 'paper', 'intent-1', context()).submission == 'UNKNOWN'
        assert executor.submit('paper:engineering', 'paper', 'intent-1', context()).submission == 'UNKNOWN'
        with pytest.raises(RiskDenied, match='UNRESOLVED_ORDER'):
            db.reserve(intent('next'), context())
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        assert len(fake.calls) == 1
    with ledger(path) as db:
        assert db.get('paper:engineering', 'paper', 'intent-1').submission == 'UNKNOWN'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


@pytest.mark.parametrize('reason', ['expired', 'revoked', 'stale'])
def test_submission_rechecks_current_authority_and_data_before_claim(tmp_path, reason):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        if reason == 'expired':
            db.clock = lambda: NOW + timedelta(hours=2)
        elif reason == 'revoked':
            db.revoke_authorization('fixture-auth')
        fake = FakeBroker()
        with pytest.raises(RiskDenied):
            OrderExecutor(db, fake).submit('paper:engineering', 'paper', 'intent-1', context(reconciled=reason != 'stale'))
        assert fake.calls == []


def test_real_broker_source_is_disabled_even_with_engineering_intent(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        fake = FakeBroker()
        fake.source = 'ibkr'
        with pytest.raises(RiskDenied, match='BROKER_WRITE_DISABLED'):
            OrderExecutor(db, fake).submit('paper:engineering', 'paper', 'intent-1', context())
        assert fake.calls == []


def test_inflight_duplicate_does_not_send_while_first_response_is_pending(tmp_path):
    entered, release = Event(), Event()
    class PendingBroker(FakeBroker):
        def submit(self, order):
            entered.set()
            assert release.wait(5)
            return super().submit(order)
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        fake = PendingBroker()
        executor = OrderExecutor(db, fake)
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(executor.submit, 'paper:engineering', 'paper', 'intent-1', context())
            try:
                assert entered.wait(5)
                second = executor.submit('paper:engineering', 'paper', 'intent-1', context())
                assert second.submission == 'SUBMITTING'
            finally:
                release.set()
            assert first.result().submission == 'ACKNOWLEDGED'
        assert len(fake.calls) == 1


def test_interrupted_claim_recovery_keeps_funds_and_never_calls_broker(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        assert db.claim_submission('paper:engineering', 'paper', 'intent-1', context(), channel=FakeBroker().session())[1]
    with ledger(path) as db:
        assert db.recover_inflight() == 1
        assert db.recover_inflight() == 0
        fake = FakeBroker()
        result = OrderExecutor(db, fake).submit('paper:engineering', 'paper', 'intent-1', context())
        assert result.submission == 'UNKNOWN'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        assert fake.calls == []


def test_unknown_response_records_failure_type_without_raw_broker_details(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        result = OrderExecutor(db, FakeBroker(fail=True)).submit('paper:engineering', 'paper', 'intent-1', context())
        assert result.lastError == 'TimeoutError'
        assert db.audit('paper:engineering')[-1]['details']['lastError'] == 'TimeoutError'
