from datetime import timedelta

import pytest

from src.ibkr_terminal.reviews import DraftOrder, OrderReviewService, PreviewInput, PreviewScope, ReviewBlocked
from test_orders import NOW, context, ledger


class Source:
    def __init__(self):
        self.current = context(totalCash='1000')

    def load(self, draft):
        limits = dict(maxOrderNotional='1000', maxTotalExposure='1000', maxSymbolWeight='1', maxDailyLoss='50',
            maxDailyOrders=10, maxOrdersPerMinute=10, maxQuoteAgeSeconds=10, maxAccountAgeSeconds=30,
            maxPriceDeviation='0.05', feeReserve='1')
        scope = PreviewScope(source='fixture', accountKey='paper:engineering', mode='paper', sessionRevision=1,
            strategyVersion='manual-order-v1', conIds=[12], issuedAt=NOW - timedelta(minutes=1),
            expiresAt=NOW + timedelta(hours=1), consentReference='engineering-risk-profile', limits=limits)
        return PreviewInput(context=self.current, scope=scope, symbol='TEST', currency='USD')


def draft(**changes):
    data = dict(accountKey='paper:engineering', mode='paper', conId=12, side='BUY', quantity='6',
        orderType='LMT', limitPrice='100', tif='DAY')
    data.update(changes)
    return DraftOrder.model_validate(data)


def test_preview_is_side_effect_free_and_confirm_persists_exact_intent_once(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        service = OrderReviewService(db, Source(), clock=lambda: NOW)
        preview = service.preview(draft())
        assert preview.testData and preview.reservedCash == '601'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'
        assert db.audit('paper:engineering') == []
        confirmed = service.confirm(preview.previewId, preview.bodyHash, explicit=True)
        assert confirmed.submission == 'PERSISTED' and confirmed.intent.quantity == '6'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'
        assert service.confirm(preview.previewId, preview.bodyHash, explicit=True) == confirmed
        assert len([row for row in db.audit('paper:engineering') if row['kind'] == 'INTENT_RESERVED']) == 1


def test_confirmation_rejects_changed_body_missing_explicit_action_and_expired_preview(tmp_path):
    now = [NOW]
    with ledger(tmp_path / 'orders.db') as db:
        service = OrderReviewService(db, Source(), clock=lambda: now[0], ttl_seconds=120)
        preview = service.preview(draft())
        for body_hash, explicit, code in [('wrong-hash', True, 'PREVIEW_BODY_CHANGED'), (preview.bodyHash, False, 'EXPLICIT_CONFIRMATION_REQUIRED')]:
            with pytest.raises(ReviewBlocked, match=code):
                service.confirm(preview.previewId, body_hash, explicit=explicit)
        now[0] += timedelta(seconds=121)
        with pytest.raises(ReviewBlocked, match='PREVIEW_EXPIRED'):
            service.confirm(preview.previewId, preview.bodyHash, explicit=True)
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'


@pytest.mark.parametrize('changed,code', [
    ({'snapshotId': 'new-snapshot'}, 'PREVIEW_SOURCE_CHANGED'),
    ({'quoteAt': NOW - timedelta(seconds=11)}, 'PREVIEW_SOURCE_CHANGED'),
    ({'settledCash': '500'}, 'PREVIEW_SOURCE_CHANGED'),
])
def test_source_change_requires_a_new_preview(tmp_path, changed, code):
    source = Source()
    with ledger(tmp_path / 'orders.db') as db:
        service = OrderReviewService(db, source, clock=lambda: NOW)
        preview = service.preview(draft())
        source.current = source.current.model_copy(update=changed)
        with pytest.raises(ReviewBlocked, match=code):
            service.confirm(preview.previewId, preview.bodyHash, explicit=True)
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'


def test_missing_or_real_write_source_is_not_replaced_with_fixture(tmp_path):
    class Missing:
        def load(self, draft):
            raise ReviewBlocked('MISSING_QUOTE_AND_RISK_PROFILE')
    with ledger(tmp_path / 'orders.db') as db:
        with pytest.raises(ReviewBlocked, match='MISSING_QUOTE'):
            OrderReviewService(db, Missing(), clock=lambda: NOW).preview(draft())
        assert db.audit('paper:engineering') == []


def test_draft_cannot_supply_context_authorization_or_other_account_rows():
    with pytest.raises(ValueError):
        DraftOrder.model_validate({**draft().model_dump(), 'settledCash': '999999', 'authorizationId': 'self-approved'})
    with pytest.raises(ValueError):
        draft(accountKey='live:engineering')
