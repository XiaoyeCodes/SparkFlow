from concurrent.futures import ThreadPoolExecutor

import pytest

from src.ibkr_terminal.broker import OrderExecutor
from src.ibkr_terminal.identity import BrokerSession, ReadOrderEvidence
from src.ibkr_terminal.reconcile import OrderReconciler
from src.ibkr_terminal.risk import RiskDenied
from test_orders import authorization, context, intent, ledger
from test_submission import FakeBroker


def session(**changes):
    data = dict(channelKey='engineering-gateway', source='fixture', accountKey='paper:engineering', mode='paper',
        sessionRevision=1, clientId=78, nextValidId=71, ready=True)
    data.update(changes)
    return BrokerSession.model_validate(data)


def evidence(record, **changes):
    data = dict(channelKey=record.identity.channelKey, source='fixture', accountKey=record.intent.accountKey,
        mode=record.intent.mode, sessionRevision=2, clientId=record.clientId, orderId=record.orderId,
        orderRef=record.identity.orderRef, permId=901, conId=record.intent.conId, side=record.intent.side,
        quantity=record.intent.quantity, orderType=record.intent.orderType, limitPrice=record.intent.limitPrice, tif=record.intent.tif)
    data.update(changes)
    return ReadOrderEvidence.model_validate(data)


def test_identity_is_on_disk_before_transport_send_and_survives_lost_ack(tmp_path):
    path = tmp_path / 'orders.db'
    class ObserveSend(FakeBroker):
        def session(self):
            return session()
        def submit(self, command):
            with ledger(path) as observer:
                stored = observer.get('paper:engineering', 'paper', 'intent-1')
                assert stored.submission == 'SUBMITTING'
                assert stored.identity == command.identity
                assert stored.orderId == 71 and stored.clientId == 78
                assert stored.identity.orderRef.startswith('SF-')
            return super().submit(command)
    with ledger(path) as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        fake = ObserveSend(fail=True)
        result = OrderExecutor(db, fake).submit('paper:engineering', 'paper', 'intent-1', context())
        assert result.submission == 'UNKNOWN'
        saved_ref = result.identity.orderRef
    with ledger(path) as db:
        old = db.get('paper:engineering', 'paper', 'intent-1')
        assert old.identity.orderRef == saved_ref
        recovered = OrderReconciler(db, 'paper:engineering', 'paper', 2).match_unknown(evidence(old))
        assert recovered.submission == 'ACKNOWLEDGED' and recovered.permId == 901
        assert recovered.reconciliationRequired and recovered.reservedCash == '601'
        assert len(fake.calls) == 1  # reads classify; no resend


@pytest.mark.parametrize('change', [{'orderRef': 'SF-wrong'}, {'orderId': 72}, {'accountKey': 'paper:other'},
    {'conId': 99}, {'quantity': '7'}, {'channelKey': 'another-gateway'}, {'source': 'ibkr'}])
def test_unknown_cannot_be_matched_by_similar_symbol_or_amount(tmp_path, change):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        unknown = OrderExecutor(db, FakeBroker(fail=True)).submit('paper:engineering', 'paper', 'intent-1', context())
        with pytest.raises((RiskDenied, ValueError)):
            OrderReconciler(db, 'paper:engineering', 'paper', 2).match_unknown(evidence(unknown, **change))
        assert db.get('paper:engineering', 'paper', 'intent-1') == unknown


def test_parallel_id_allocation_is_durable_and_respects_new_broker_floor(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        grant = authorization()
        limits = grant.limits.model_copy(update={'maxDailyOrders': 50, 'maxOrdersPerMinute': 50})
        db.record_authorization(grant.model_copy(update={'limits': limits}))
        for n in range(8):
            db.reserve(intent(f'id-{n}', quantity='1'), context())
    def claim(n):
        with ledger(path) as db:
            row, claimed = db.claim_submission('paper:engineering', 'paper', f'id-{n}', context(), channel=session())
            assert claimed
            return row.identity
    with ThreadPoolExecutor(max_workers=8) as pool:
        ids = list(pool.map(claim, range(8)))
    assert sorted(row.orderId for row in ids) == list(range(71, 79))
    assert len({row.orderRef for row in ids}) == 8
    with ledger(path) as db:
        db.reserve(intent('next-floor', quantity='1'), context())
        row, _ = db.claim_submission('paper:engineering', 'paper', 'next-floor', context(), channel=session(nextValidId=500))
        assert row.orderId == 500


def test_wrong_ack_identity_cannot_replace_the_preallocated_identity(tmp_path):
    from src.ibkr_terminal.broker import BrokerAck
    class WrongAck(FakeBroker):
        def submit(self, command):
            self.calls.append(command)
            return BrokerAck(orderId=999, clientId=78, permId=901)
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(), context())
        result = OrderExecutor(db, WrongAck()).submit('paper:engineering', 'paper', 'intent-1', context())
        assert result.submission == 'UNKNOWN'
        assert result.orderId == 71 and result.permId is None
