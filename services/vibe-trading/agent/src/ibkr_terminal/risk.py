"""Decimal, fail-closed pre-trade checks. No broker or authorization IO.

The existing live gate's expiry, halt, instrument, funding and exposure
semantics are retained. Its float/lookup/submit sequence is not suitable for
atomic IBKR reservations, so this pure decision runs inside the ledger lock.
"""
import hashlib
import json
from datetime import datetime
from decimal import Decimal, localcontext
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from .schemas import Contract

Amount = Annotated[str, StringConstraints(strict=True, max_length=38, pattern=r'^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$')]
Identifier = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128)]


class RiskDenied(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class OrderIntent(Contract):
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    clientIntentId: Identifier
    conId: int = Field(gt=0, strict=True)
    side: Literal['BUY', 'SELL']
    quantity: Amount
    orderType: Literal['LMT', 'MKT']
    limitPrice: Amount | None
    tif: Literal['DAY', 'GTC']
    strategyVersion: Identifier
    authorizationId: Identifier
    sessionRevision: int = Field(ge=1, strict=True)

    @model_validator(mode='after')
    def valid_order(self):
        if not self.accountKey.startswith(f'{self.mode}:') or Decimal(self.quantity) <= 0:
            raise ValueError('invalid namespace or quantity')
        if self.orderType == 'LMT' and (self.limitPrice is None or Decimal(self.limitPrice) <= 0):
            raise ValueError('positive limitPrice required')
        if self.orderType == 'MKT' and self.limitPrice is not None:
            raise ValueError('market order cannot carry a limit')
        return self


class RiskLimits(Contract):
    maxOrderNotional: Amount
    maxTotalExposure: Amount
    maxSymbolWeight: Amount
    maxDailyLoss: Amount
    maxDailyOrders: int = Field(gt=0, strict=True)
    maxOrdersPerMinute: int = Field(gt=0, strict=True)
    maxQuoteAgeSeconds: int = Field(gt=0, strict=True)
    maxAccountAgeSeconds: int = Field(gt=0, strict=True)
    maxPriceDeviation: Amount
    feeReserve: Amount

    @model_validator(mode='after')
    def valid_limits(self):
        for field in ('maxOrderNotional', 'maxTotalExposure', 'maxDailyLoss'):
            if Decimal(getattr(self, field)) <= 0:
                raise ValueError('positive risk limit required')
        if not 0 < Decimal(self.maxSymbolWeight) <= 1 or not 0 <= Decimal(self.maxPriceDeviation) <= 1:
            raise ValueError('invalid risk ratio')
        return self


class Authorization(Contract):
    authorizationId: Identifier
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    sessionRevision: int = Field(ge=1, strict=True)
    strategyVersion: Identifier
    kind: Literal['manual', 'automatic']
    source: Literal['fixture', 'user']
    consentHash: Identifier
    conIds: tuple[int, ...] = Field(min_length=1)
    issuedAt: AwareDatetime
    expiresAt: AwareDatetime
    confirmedIntentHash: str | None
    limits: RiskLimits
    purpose: Literal['new_order', 'amend_order'] = 'new_order'

    @model_validator(mode='after')
    def valid_authorization(self):
        if not self.accountKey.startswith(f'{self.mode}:') or self.expiresAt <= self.issuedAt:
            raise ValueError('invalid authorization scope or expiry')
        if any(con_id <= 0 for con_id in self.conIds) or len(set(self.conIds)) != len(self.conIds):
            raise ValueError('invalid contract whitelist')
        if self.kind == 'manual' and not self.confirmedIntentHash:
            raise ValueError('manual intent hash required')
        return self


class Holding(Contract):
    conId: int = Field(gt=0, strict=True)
    quantity: Amount
    marketValue: Amount
    currency: str


class ExternalOrderRisk(Contract):
    accountKey: Identifier
    conId: int = Field(gt=0, strict=True)
    orderId: int = Field(strict=True)
    clientId: int = Field(ge=0, strict=True)
    permId: int = Field(gt=0, strict=True)
    side: Literal['BUY', 'SELL']
    remaining: Amount | None
    limitPrice: Amount | None
    currency: str
    orderType: str
    state: Literal['OPEN', 'CANCEL_PENDING', 'UNKNOWN']
    secType: str | None = None
    multiplier: Amount | None = None


class RiskContext(Contract):
    # Trusted, source-backed service input, never accepted from a browser body.
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    sessionRevision: int = Field(ge=1, strict=True)
    snapshotId: Identifier
    source: Literal['fixture', 'ibkr']
    connected: bool
    reconciled: bool
    asOf: AwareDatetime
    quoteAt: AwareDatetime
    quoteState: Literal['realtime', 'delayed', 'frozen', 'disconnected', 'missing']
    conId: int = Field(gt=0, strict=True)
    referencePrice: Amount | None
    settledCash: Amount | None
    totalCash: Amount | None = None  # separate from settled/available funds
    netLiquidation: Amount | None
    dailyLoss: Amount | None
    holdings: tuple[Holding, ...]
    currency: str
    baseCurrency: str
    market: str
    secType: str
    multiplier: Amount
    minTick: Amount
    minQuantity: Amount
    regularHours: bool
    halted: bool
    openOrdersComplete: bool = False
    externalOrders: tuple[ExternalOrderRisk, ...] = ()


def canonical(model):
    return json.dumps(model.model_dump(mode='json'), sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def intent_hash(intent: OrderIntent):
    return hashlib.sha256(canonical(intent).encode()).hexdigest()


def reservation_price(intent, context):
    # A market reservation is an estimate, never a price sent to the broker.
    return Decimal(intent.limitPrice) if intent.orderType == 'LMT' else Decimal(context.referencePrice) * Decimal('1.05')


def check_risk(intent, grant, context, reserved, *, now: datetime, daily_count: int, minute_count: int,
    purpose='new_order', confirmation_hash=None, filled_quantity='0'):
    def require(condition, code):
        if not condition:
            raise RiskDenied(code)

    require(intent.accountKey == grant.accountKey == context.accountKey and intent.mode == grant.mode == context.mode, 'ACCOUNT_SCOPE')
    require(intent.sessionRevision == grant.sessionRevision == context.sessionRevision, 'SESSION_REVISION')
    require((grant.source == 'fixture') == (context.source == 'fixture'), 'SOURCE_MISMATCH')
    require(grant.purpose == purpose, 'AUTHORIZATION_PURPOSE')
    require(grant.issuedAt <= now < grant.expiresAt, 'AUTHORIZATION_EXPIRED')
    require(intent.strategyVersion == grant.strategyVersion, 'STRATEGY_VERSION')
    require(grant.kind != 'manual' or grant.confirmedIntentHash == (confirmation_hash or intent_hash(intent)), 'MANUAL_CONFIRMATION')
    require(intent.conId == context.conId and intent.conId in grant.conIds, 'CONTRACT_SCOPE')
    require(context.connected and context.reconciled, 'RECONCILIATION_REQUIRED')
    require(not context.halted, 'HALTED')
    require(context.regularHours, 'OUTSIDE_RTH')
    require(context.openOrdersComplete, 'EXTERNAL_ORDER_RISK_UNKNOWN')
    require(context.quoteState == 'realtime', 'QUOTE_UNAVAILABLE')
    limits = grant.limits
    require(0 <= (now - context.quoteAt).total_seconds() <= limits.maxQuoteAgeSeconds, 'STALE_QUOTE')
    require(0 <= (now - context.asOf).total_seconds() <= limits.maxAccountAgeSeconds, 'STALE_ACCOUNT')
    require(all(getattr(context, name) is not None for name in ('settledCash', 'netLiquidation', 'dailyLoss', 'referencePrice')), 'MISSING_ACCOUNT_DATA')
    require(context.market == 'US' and context.secType == 'STK' and context.currency == context.baseCurrency == 'USD' and Decimal(context.multiplier) == 1, 'UNSUPPORTED_CONTRACT')
    require(intent.tif == 'DAY' and (intent.orderType == 'LMT' or
        intent.orderType == 'MKT' and intent.mode == 'paper' and grant.kind == 'manual' and purpose == 'new_order'), 'UNSUPPORTED_ORDER_POLICY')
    require(len({row.conId for row in context.holdings}) == len(context.holdings) and all(row.currency == 'USD' for row in context.holdings), 'INCOMPLETE_HOLDINGS')
    with localcontext() as arithmetic:
        arithmetic.prec = 80
        reserved = {**reserved, 'quantity': dict(reserved['quantity']), 'symbols': dict(reserved['symbols'])}
        identities = set()
        for external in context.externalOrders:
            require(external.accountKey == intent.accountKey, 'EXTERNAL_ORDER_SCOPE')
            identity = (external.orderId, external.clientId, external.permId)
            require(identity not in identities, 'EXTERNAL_ORDER_RISK_UNKNOWN')
            identities.add(identity)
            require(external.remaining is not None and external.limitPrice is not None and external.orderType == 'LMT'
                and external.state in ('OPEN', 'CANCEL_PENDING') and external.currency == 'USD'
                and external.secType == 'STK' and external.multiplier is not None and Decimal(external.multiplier) == 1, 'EXTERNAL_ORDER_RISK_UNKNOWN')
            require(Decimal(external.limitPrice) > 0, 'EXTERNAL_ORDER_RISK_UNKNOWN')
            pending = Decimal(external.remaining) * Decimal(external.limitPrice) if external.side == 'BUY' else Decimal(0)
            reserved['cash'] = str(Decimal(reserved['cash']) + pending + Decimal(limits.feeReserve))
            reserved['notional'] = str(Decimal(reserved['notional']) + pending)
            key = str(external.conId)
            reserved['symbols'][key] = str(Decimal(reserved['symbols'].get(key, '0')) + pending)
            if external.side == 'SELL':
                reserved['quantity'][key] = str(Decimal(reserved['quantity'].get(key, '0')) + Decimal(external.remaining))
        quantity, price = Decimal(intent.quantity), reservation_price(intent, context)
        remaining_quantity = quantity - Decimal(filled_quantity)
        require(remaining_quantity > 0, 'QUANTITY_NOT_ABOVE_FILLED')
        tick, step = Decimal(context.minTick), Decimal(context.minQuantity)
        require(tick > 0 and step >= 1 and step == step.to_integral_value(), 'INVALID_CONTRACT_RULES')
        require(quantity == quantity.to_integral_value() and quantity % step == 0 and (intent.orderType == 'MKT' or price % tick == 0), 'INVALID_ORDER_INCREMENT')
        reference = Decimal(context.referencePrice)
        require(reference > 0 and (intent.orderType == 'MKT' or abs(price - reference) <= reference * Decimal(limits.maxPriceDeviation)), 'PRICE_DEVIATION')
        require(Decimal(context.dailyLoss) < Decimal(limits.maxDailyLoss), 'DAILY_LOSS_LIMIT')
        require(daily_count < limits.maxDailyOrders, 'DAILY_ORDER_LIMIT')
        require(minute_count < limits.maxOrdersPerMinute, 'ORDER_FREQUENCY_LIMIT')
        notional, fee = quantity * price, Decimal(limits.feeReserve)
        require(notional <= Decimal(limits.maxOrderNotional), 'ORDER_NOTIONAL_LIMIT')
        pending_notional = remaining_quantity * price
        cash = (pending_notional if intent.side == 'BUY' else Decimal(0)) + fee
        require(Decimal(context.settledCash) >= Decimal(reserved['cash']) + cash, 'INSUFFICIENT_CASH')
        holding = next((row for row in context.holdings if row.conId == intent.conId), None)
        if intent.side == 'SELL':
            available = Decimal(holding.quantity) if holding else Decimal(0)
            require(available >= remaining_quantity + Decimal(reserved['quantity'].get(str(intent.conId), '0')), 'INSUFFICIENT_POSITION')
        else:
            exposure = sum((Decimal(row.marketValue) for row in context.holdings), Decimal(0))
            total = exposure + Decimal(reserved['notional']) + pending_notional
            net = Decimal(context.netLiquidation)
            require(net > 0 and total <= net, 'LEVERAGE_FORBIDDEN')
            require(total <= Decimal(limits.maxTotalExposure), 'TOTAL_EXPOSURE_LIMIT')
            symbol_value = Decimal(holding.marketValue) if holding else Decimal(0)
            symbol_value += Decimal(reserved['symbols'].get(str(intent.conId), '0')) + pending_notional
            require(symbol_value <= net * Decimal(limits.maxSymbolWeight), 'SYMBOL_WEIGHT_LIMIT')
        return {'cash': format(cash, 'f'), 'notional': format(pending_notional if intent.side == 'BUY' else Decimal(0), 'f'),
            'quantity': format(remaining_quantity, 'f') if intent.side == 'SELL' else '0'}
