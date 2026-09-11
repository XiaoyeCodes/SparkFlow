"""Engineering fixtures only. No broker connection, credentials or user limits."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json

import pytest

from src.ibkr_terminal.orders import OrderLedger, IntentConflict
from src.ibkr_terminal.risk import OrderIntent, Authorization, RiskContext, RiskDenied, intent_hash, legacy_intent_hash


NOW = datetime(2026, 9, 4, 14, 0, tzinfo=timezone.utc)


def intent(key='intent-1', **changes):
    data = dict(accountKey='paper:engineering', mode='paper', clientIntentId=key,
        conId=12, side='BUY', quantity='6', orderType='LMT', limitPrice='100', tif='DAY',
        strategyVersion='engineering-v1', authorizationId='fixture-auth', sessionRevision=1)
    data.update(changes)
    return OrderIntent.model_validate(data)


def authorization(**changes):
    data = dict(authorizationId='fixture-auth', accountKey='paper:engineering', mode='paper', sessionRevision=1,
        strategyVersion='engineering-v1', kind='automatic', source='fixture', consentHash='engineering-consent-only',
        conIds=[12], issuedAt=NOW - timedelta(minutes=1), expiresAt=NOW + timedelta(hours=1), confirmedIntentHash=None,
        limits=dict(maxOrderNotional='1000', maxTotalExposure='1000', maxSymbolWeight='1', maxDailyLoss='50',
            maxDailyOrders=10, maxOrdersPerMinute=10, maxQuoteAgeSeconds=10, maxAccountAgeSeconds=30,
            maxPriceDeviation='0.05', feeReserve='1'))
    data.update(changes)
    return Authorization.model_validate(data)


def context(**changes):
    data = dict(accountKey='paper:engineering', mode='paper', sessionRevision=1, snapshotId='engineering-snapshot',
        source='fixture', connected=True, reconciled=True, asOf=NOW, quoteAt=NOW, quoteState='realtime',
        conId=12, referencePrice='100', settledCash='1000', netLiquidation='1000', dailyLoss='0',
        holdings=[], currency='USD', baseCurrency='USD', market='US', secType='STK', multiplier='1',
        minTick='0.01', minQuantity='1', regularHours=True, halted=False, openOrdersComplete=True, externalOrders=[])
    data.update(changes)
    return RiskContext.model_validate(data)


def ledger(path):
    return OrderLedger(path, allow_fixtures=True, clock=lambda: NOW)


def test_duplicate_intent_survives_restart_and_body_conflict_does_not_mutate(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        db.record_authorization(authorization())
        first = db.reserve(intent(), context())
        assert first.submission == 'PERSISTED' and first.reservedCash == '601'
        assert db.reserve(intent(), context()) == first
        changed = intent().model_copy(update={'quantity': '7'})
        with pytest.raises(IntentConflict):
            db.reserve(changed, context())
        assert len(db.audit('paper:engineering')) == 2  # authorization and reservation
    with ledger(path) as db:
        assert db.reserve(intent(), context()) == first
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


def test_order_creation_time_is_persisted_and_legacy_rows_are_backfilled(tmp_path):
    current = [NOW]
    with OrderLedger(tmp_path / 'orders.db', allow_fixtures=True, clock=lambda: current[0]) as db:
        db.record_authorization(authorization())
        first = db.reserve(intent('older', quantity='1'), context())
        current[0] = NOW + timedelta(seconds=1)
        second = db.reserve(intent('newer', quantity='1'), context(asOf=current[0], quoteAt=current[0]))
        assert first.createdAt == NOW
        assert second.createdAt == current[0]
        with db.transaction():
            payload, = db._db.execute("SELECT payload FROM order_intents WHERE intent_id='older'").fetchone()
            value = json.loads(payload)
            value.pop('createdAt')
            db._db.execute("UPDATE order_intents SET payload=? WHERE intent_id='older'", (json.dumps(value),))
        rows = db._records('paper:engineering', 'paper')
        assert [row.intent.clientIntentId for row in rows] == ['older', 'newer']
        assert rows[0].createdAt == NOW and rows[1].createdAt == current[0]


def test_pre_session_field_order_hash_loads_only_as_default_extended_route(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        db.record_authorization(authorization())
        original = db.reserve(intent(), context())
        with db.transaction():
            payload, = db._db.execute("SELECT payload FROM order_intents WHERE intent_id='intent-1'").fetchone()
            value = json.loads(payload)
            value['intent'].pop('tradingSession')
            value['bodyHash'] = legacy_intent_hash(original.intent)
            db._db.execute("UPDATE order_intents SET payload=? WHERE intent_id='intent-1'", (json.dumps(value),))
    with ledger(path) as db:
        loaded = db.get('paper:engineering', 'paper', 'intent-1')
        assert loaded.intent.tradingSession == 'EXTENDED'
        assert loaded.bodyHash == legacy_intent_hash(loaded.intent)
        assert db.reserve(intent(), context()) == loaded
        with pytest.raises(IntentConflict):
            db.reserve(intent(tradingSession='OVERNIGHT'), context())


def test_independent_connections_atomically_share_cash_and_exposure(tmp_path):
    path = tmp_path / 'orders.db'
    with ledger(path) as db:
        db.record_authorization(authorization())
    def attempt(n):
        with ledger(path) as db:
            try:
                return db.reserve(intent(f'concurrent-{n}'), context()).submission
            except RiskDenied as error:
                return error.code
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(20)))
    assert results.count('PERSISTED') == 1
    assert results.count('INSUFFICIENT_CASH') == 19
    with ledger(path) as db:
        assert db.reservations('paper:engineering', 'paper')['cash'] == '601'


@pytest.mark.parametrize('changes,code', [
    ({'accountKey': 'paper:another'}, 'ACCOUNT_SCOPE'),
    ({'sessionRevision': 2}, 'SESSION_REVISION'),
    ({'quoteAt': NOW - timedelta(seconds=11)}, 'STALE_QUOTE'),
    ({'asOf': NOW - timedelta(seconds=31)}, 'STALE_ACCOUNT'),
    ({'quoteState': 'delayed'}, 'QUOTE_UNAVAILABLE'),
    ({'reconciled': False}, 'RECONCILIATION_REQUIRED'),
    ({'halted': True}, 'HALTED'),
    ({'dailyLoss': None}, 'MISSING_ACCOUNT_DATA'),
    ({'dailyLoss': '50'}, 'DAILY_LOSS_LIMIT'),
    ({'secType': 'OPT'}, 'UNSUPPORTED_CONTRACT'),
    ({'source': 'ibkr'}, 'SOURCE_MISMATCH'),
])
def test_fail_closed_risk_rejections_leave_no_reservation(tmp_path, changes, code):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        with pytest.raises(RiskDenied) as caught:
            db.reserve(intent(), context(**changes))
        assert caught.value.code == code
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'


def test_manual_consent_binds_exact_preview_and_revocation_is_immediate(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        manual = authorization(kind='manual', confirmedIntentHash=intent_hash(intent()))
        db.record_authorization(manual)
        changed = intent().model_copy(update={'quantity': '7'})
        with pytest.raises(RiskDenied, match='MANUAL_CONFIRMATION'):
            db.reserve(changed, context())
        db.revoke_authorization(manual.authorizationId)
        with pytest.raises(RiskDenied, match='AUTHORIZATION_REVOKED'):
            db.reserve(intent(), context())


def test_manual_paper_orders_ignore_strategy_throttles_but_keep_financial_reservations(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        first = intent('manual-1', quantity='1', limitPrice='50', authorizationId='manual-auth-1')
        limits = authorization().limits.model_copy(update={'maxTotalExposure': '1', 'maxSymbolWeight': '0.01',
            'maxDailyLoss': '1', 'maxDailyOrders': 1, 'maxOrdersPerMinute': 1, 'maxPriceDeviation': '0'})
        db.record_authorization(authorization(authorizationId='manual-auth-1', kind='manual',
            confirmedIntentHash=intent_hash(first), limits=limits))
        db.reserve(first, context(dailyLoss='999'))
        second = intent('manual-2', quantity='1', limitPrice='150', authorizationId='manual-auth-2')
        db.record_authorization(authorization(authorizationId='manual-auth-2', kind='manual',
            confirmedIntentHash=intent_hash(second), limits=limits))
        db.reserve(second, context(dailyLoss='999'))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '202'
        third = intent('manual-3', quantity='8', authorizationId='manual-auth-3')
        db.record_authorization(authorization(authorizationId='manual-auth-3', kind='manual',
            confirmedIntentHash=intent_hash(third), limits=limits))
        with pytest.raises(RiskDenied, match='INSUFFICIENT_CASH'):
            db.reserve(third, context(dailyLoss='999'))


def test_manual_paper_order_can_follow_unresolved_order_using_remaining_cash(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        db.reserve(intent(quantity='6'), context())
        with db.transaction():
            row = db.get('paper:engineering', 'paper', 'intent-1')
            db._replace(row.model_copy(update={'submission': 'UNKNOWN', 'reconciliationRequired': True}), 'TEST_UNKNOWN')
        next_intent = intent('manual-next', quantity='3', authorizationId='manual-next-auth')
        db.record_authorization(authorization(authorizationId='manual-next-auth', kind='manual',
            confirmedIntentHash=intent_hash(next_intent)))
        next_row = db.reserve(next_intent, context())
        assert next_row.submission == 'PERSISTED'
        assert db.reservations('paper:engineering', 'paper')['cash'] == '902'
        blocked = intent('manual-too-large', quantity='1', authorizationId='manual-large-auth')
        db.record_authorization(authorization(authorizationId='manual-large-auth', kind='manual',
            confirmedIntentHash=intent_hash(blocked)))
        with pytest.raises(RiskDenied, match='INSUFFICIENT_CASH'):
            db.reserve(blocked, context())


def test_paper_orders_allow_outside_rth_for_automatic_limits_and_manual_market_orders(tmp_path):
    order = intent(key='automatic-outside')
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        row = db.reserve(order, context(regularHours=False))
        assert row.submission == 'PERSISTED'
        assert row.intent.orderType == 'LMT' and row.intent.tif == 'DAY'
    market = intent(key='manual-market-outside', orderType='MKT', limitPrice=None)
    with ledger(tmp_path / 'market-orders.db') as db:
        db.record_authorization(authorization(kind='manual', confirmedIntentHash=intent_hash(market)))
        row = db.reserve(market, context(regularHours=False, referenceKind='broker-snapshot', quoteState='delayed'))
        assert row.submission == 'PERSISTED' and row.intent.orderType == 'MKT'


def test_live_orders_allow_outside_rth_and_single_order_limit_is_not_enforced(tmp_path):
    live_order = intent(key='live-outside', accountKey='live:engineering', mode='live', quantity='2')
    live_grant = authorization(accountKey='live:engineering', mode='live',
        limits={**authorization().limits.model_dump(), 'maxOrderNotional': '100'})
    live_context = context(accountKey='live:engineering', mode='live', regularHours=False)
    with ledger(tmp_path / 'live-orders.db') as db:
        db.record_authorization(live_grant)
        row = db.reserve(live_order, live_context)
        assert row.submission == 'PERSISTED' and row.reservedNotional == '200'


def test_sell_reserves_only_owned_whole_shares_and_never_finances_new_buys(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        sell = intent().model_copy(update={'side': 'SELL', 'quantity': '4'})
        holding = dict(conId=12, quantity='5', marketValue='500', currency='USD')
        db.reserve(sell, context(holdings=[holding]))
        with pytest.raises(RiskDenied, match='INSUFFICIENT_POSITION'):
            db.reserve(sell.model_copy(update={'clientIntentId': 'sell-2'}), context(holdings=[holding]))
        assert db.reservations('paper:engineering', 'paper')['quantity'] == {'12': '4'}


def test_production_ledger_rejects_engineering_authorization(tmp_path):
    with OrderLedger(tmp_path / 'orders.db') as db:
        with pytest.raises(RiskDenied, match='FIXTURE_DISABLED'):
            db.record_authorization(authorization())


def test_two_strategies_share_account_risk_and_persist_daily_count(tmp_path):
    path = tmp_path / 'orders.db'
    grant = authorization()
    limits = grant.limits.model_copy(update={'maxDailyOrders': 1})
    with ledger(path) as db:
        db.record_authorization(grant.model_copy(update={'limits': limits}))
        db.record_authorization(authorization(authorizationId='second-auth', strategyVersion='engineering-v2', limits=limits))
        db.reserve(intent(quantity='1'), context())
    with ledger(path) as db:
        with pytest.raises(RiskDenied, match='DAILY_ORDER_LIMIT'):
            db.reserve(intent('second', authorizationId='second-auth', strategyVersion='engineering-v2', quantity='1'), context())


@pytest.mark.parametrize('order_changes,context_changes,code', [
    ({'quantity': '0.5'}, {}, 'INVALID_ORDER_INCREMENT'),
    ({'limitPrice': '100.001'}, {}, 'INVALID_ORDER_INCREMENT'),
    ({'limitPrice': '120'}, {}, 'PRICE_DEVIATION'),
    ({'orderType': 'MKT', 'limitPrice': None}, {}, 'UNSUPPORTED_ORDER_POLICY'),
    ({'strategyVersion': 'unapproved'}, {}, 'STRATEGY_VERSION'),
    ({}, {'netLiquidation': '500'}, 'LEVERAGE_FORBIDDEN'),
])
def test_financial_constraints_cannot_be_bypassed_by_valid_transport_fields(tmp_path, order_changes, context_changes, code):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        with pytest.raises(RiskDenied, match=code):
            db.reserve(intent(**order_changes), context(**context_changes))
        assert db.reservations('paper:engineering', 'paper')['cash'] == '0'


def test_symbol_weight_includes_existing_positions_and_pending_buys(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        grant = authorization()
        db.record_authorization(grant.model_copy(update={'limits': grant.limits.model_copy(update={'maxSymbolWeight': '0.5'})}))
        state = context(holdings=[dict(conId=12, quantity='2', marketValue='200', currency='USD')])
        db.reserve(intent(quantity='2'), state)  # 200 held + 200 pending
        with pytest.raises(RiskDenied, match='SYMBOL_WEIGHT_LIMIT'):
            db.reserve(intent('next', quantity='2'), state)  # 600 / 1000, not 400 / 1000


def external_order(**changes):
    data = dict(accountKey='paper:engineering', conId=12, orderId=19, clientId=91, permId=400,
        side='BUY', remaining='6', limitPrice='100', currency='USD', orderType='LMT', state='CANCEL_PENDING', secType='STK', multiplier='1')
    data.update(changes)
    return data


def test_external_tws_cancel_pending_still_consumes_cash_and_held_shares(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        state = context(openOrdersComplete=True, externalOrders=[external_order()])
        with pytest.raises(RiskDenied, match='INSUFFICIENT_CASH'):
            db.reserve(intent(quantity='5'), state)
        state = context(openOrdersComplete=True, holdings=[dict(conId=12, quantity='5', marketValue='500', currency='USD')],
            externalOrders=[external_order(side='SELL', remaining='3')])
        with pytest.raises(RiskDenied, match='INSUFFICIENT_POSITION'):
            db.reserve(intent(side='SELL', quantity='3'), state)


def test_incomplete_external_order_evidence_cannot_mean_zero_pending_risk(tmp_path):
    with ledger(tmp_path / 'orders.db') as db:
        db.record_authorization(authorization())
        for state in [context(openOrdersComplete=False), context(openOrdersComplete=True, externalOrders=[external_order(remaining=None)]),
            context(openOrdersComplete=True, externalOrders=[external_order(orderType='MKT', limitPrice=None)])]:
            with pytest.raises(RiskDenied, match='EXTERNAL_ORDER_RISK_UNKNOWN'):
                db.reserve(intent(quantity='1'), state)
