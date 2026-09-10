"""Server-owned order previews and explicit local confirmation.

Previewing evaluates the same risk function used by submission but does not
create an authorization or reserve funds. Confirmation only persists an exact
intent; broker transport remains a separate, disabled boundary.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
from typing import Literal, Protocol
from uuid import uuid4

from pydantic import AwareDatetime, Field, model_validator

from .orders import OrderLedger, OrderRecord
from .risk import Amount, Authorization, Identifier, OrderIntent, RiskContext, RiskDenied, RiskLimits, canonical, intent_hash
from .schemas import Contract


class ReviewBlocked(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class DraftOrder(Contract):
    """The complete browser-writable order contract."""

    accountKey: Identifier
    mode: Literal['paper', 'live']
    conId: int = Field(gt=0, strict=True)
    side: Literal['BUY', 'SELL']
    quantity: Amount
    orderType: Literal['LMT', 'MKT']
    limitPrice: Amount | None = None
    tif: Literal['DAY']

    @model_validator(mode='after')
    def valid_scope(self):
        if not self.accountKey.startswith(f'{self.mode}:'):
            raise ValueError('invalid account namespace')
        if self.orderType == 'LMT' and (self.limitPrice is None or Decimal(self.limitPrice) <= 0):
            raise ValueError('positive limit price required')
        if self.orderType == 'MKT' and (self.mode != 'paper' or self.limitPrice is not None):
            raise ValueError('market orders require paper mode and no limit price')
        return self


class PreviewScope(Contract):
    """Trusted policy selected by the server for this account and contract."""

    source: Literal['fixture', 'user']
    accountKey: Identifier
    mode: Literal['paper', 'live']
    sessionRevision: int = Field(ge=1, strict=True)
    strategyVersion: Identifier
    conIds: tuple[int, ...] = Field(min_length=1)
    issuedAt: AwareDatetime
    expiresAt: AwareDatetime
    consentReference: Identifier
    limits: RiskLimits


class PreviewInput(Contract):
    context: RiskContext
    scope: PreviewScope
    symbol: Identifier
    currency: Identifier


class OrderPreview(Contract):
    previewId: Identifier
    bodyHash: str
    expiresAt: AwareDatetime
    accountKey: Identifier
    mode: Literal['paper', 'live']
    conId: int
    symbol: Identifier
    currency: Identifier
    side: Literal['BUY', 'SELL']
    quantity: Amount
    orderType: Literal['LMT', 'MKT']
    limitPrice: Amount | None
    tif: Literal['DAY']
    snapshotId: Identifier
    reservedCash: Amount
    reservedNotional: Amount
    reservedQuantity: Amount
    testData: bool
    warnings: tuple[str, ...]


class PreviewConfirmation(Contract):
    bodyHash: str = Field(min_length=64, max_length=64, pattern=r'^[0-9a-f]{64}$')
    explicit: bool


class StoredPreview(Contract):
    draft: DraftOrder
    sourceInput: PreviewInput
    intent: OrderIntent
    authorization: Authorization
    preview: OrderPreview


class PreviewSource(Protocol):
    def load(self, draft: DraftOrder) -> PreviewInput: ...


class OrderReviewService:
    def __init__(self, ledger: OrderLedger, source: PreviewSource, *, clock=None, ttl_seconds=120, refresh_risk_on_confirm=False, broker_submission=False):
        self.ledger = ledger
        self.source = source
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.ttl_seconds = ttl_seconds
        self.refresh_risk_on_confirm = refresh_risk_on_confirm
        self.broker_submission = broker_submission

    @staticmethod
    def _blocked(error):
        if isinstance(error, ReviewBlocked):
            return error
        if isinstance(error, RiskDenied):
            return ReviewBlocked(error.code)
        return error

    def _load(self, draft):
        try:
            loaded = self.source.load(draft)
            return PreviewInput.model_validate(loaded.model_dump())
        except (ReviewBlocked, RiskDenied) as error:
            raise self._blocked(error) from error

    @staticmethod
    def _validate_source(draft, loaded, now):
        scope, context = loaded.scope, loaded.context
        if (scope.accountKey, scope.mode, scope.sessionRevision) != (draft.accountKey, draft.mode, context.sessionRevision):
            raise ReviewBlocked('PREVIEW_SCOPE_MISMATCH')
        if (context.accountKey, context.mode, context.conId) != (draft.accountKey, draft.mode, draft.conId):
            raise ReviewBlocked('PREVIEW_SCOPE_MISMATCH')
        if draft.conId not in scope.conIds or scope.expiresAt <= now or scope.issuedAt > now:
            raise ReviewBlocked('PREVIEW_SCOPE_MISMATCH')
        if loaded.currency != context.currency:
            raise ReviewBlocked('PREVIEW_SCOPE_MISMATCH')

    def preview(self, draft: DraftOrder):
        draft = DraftOrder.model_validate(draft.model_dump())
        now = self.clock()
        loaded = self._load(draft)
        self._validate_source(draft, loaded, now)
        preview_id = f'preview:{uuid4().hex}'
        authorization_id = f'manual-auth:{uuid4().hex}'
        intent = OrderIntent(accountKey=draft.accountKey, mode=draft.mode, clientIntentId=f'manual:{uuid4().hex}',
            conId=draft.conId, side=draft.side, quantity=draft.quantity, orderType=draft.orderType,
            limitPrice=draft.limitPrice, tif=draft.tif, strategyVersion=loaded.scope.strategyVersion,
            authorizationId=authorization_id, sessionRevision=loaded.scope.sessionRevision)
        body_hash = intent_hash(intent)
        consent_hash = hashlib.sha256(f'{loaded.scope.consentReference}:{preview_id}:{body_hash}'.encode()).hexdigest()
        grant = Authorization(authorizationId=authorization_id, accountKey=draft.accountKey, mode=draft.mode,
            sessionRevision=loaded.scope.sessionRevision, strategyVersion=loaded.scope.strategyVersion,
            kind='manual', source=loaded.scope.source, consentHash=consent_hash, conIds=loaded.scope.conIds,
            issuedAt=loaded.scope.issuedAt, expiresAt=loaded.scope.expiresAt,
            confirmedIntentHash=body_hash, limits=loaded.scope.limits, purpose='new_order')
        try:
            reserved = self.ledger.dry_run(intent, grant, loaded.context, now=now)
        except RiskDenied as error:
            raise ReviewBlocked(error.code) from error
        expires_at = min(loaded.scope.expiresAt, now + timedelta(seconds=self.ttl_seconds))
        preview = OrderPreview(previewId=preview_id, bodyHash=body_hash, expiresAt=expires_at,
            accountKey=draft.accountKey, mode=draft.mode, conId=draft.conId, symbol=loaded.symbol,
            currency=loaded.currency, side=draft.side, quantity=draft.quantity, orderType=draft.orderType,
            limitPrice=draft.limitPrice, tif=draft.tif, snapshotId=loaded.context.snapshotId,
            reservedCash=reserved['cash'], reservedNotional=reserved['notional'],
            reservedQuantity=reserved['quantity'], testData=loaded.scope.source == 'fixture',
            warnings=(('工程测试数据；不得视为 IBKR 账户事实。',) if loaded.scope.source == 'fixture' else ())
                + (('市价单按实际成交价结算；现金按参考价加 5% 预留，这不是成交价格上限。',) if draft.orderType == 'MKT' else ())
                + (('确认后会向当前 IBKR 模拟账户发送此笔订单；成交由券商回报确认。',) if self.broker_submission
                    else ('确认仅在本地持久化；券商提交仍保持禁用。',)))
        stored = StoredPreview(draft=draft, sourceInput=loaded, intent=intent, authorization=grant, preview=preview)
        self.ledger.save_preview(preview_id, draft.accountKey, draft.mode, body_hash, canonical(stored), expires_at.timestamp())
        return preview

    def confirm(self, preview_id: str, body_hash: str, *, explicit: bool) -> OrderRecord:
        if not explicit:
            raise ReviewBlocked('EXPLICIT_CONFIRMATION_REQUIRED')
        row = self.ledger.load_preview(preview_id)
        if row is None:
            raise ReviewBlocked('PREVIEW_MISSING')
        if row[2] != body_hash:
            raise ReviewBlocked('PREVIEW_BODY_CHANGED')
        now = self.clock()
        if now.timestamp() >= row[4]:
            raise ReviewBlocked('PREVIEW_EXPIRED')
        stored = StoredPreview.model_validate_json(row[3])
        current = self._load(stored.draft)
        self._validate_source(stored.draft, current, now)
        same_policy = (canonical(current.scope) == canonical(stored.sourceInput.scope)
            and current.symbol == stored.sourceInput.symbol and current.currency == stored.sourceInput.currency)
        if (not same_policy or not self.refresh_risk_on_confirm and canonical(current) != canonical(stored.sourceInput)):
            raise ReviewBlocked('PREVIEW_SOURCE_CHANGED')
        try:
            return self.ledger.confirm_preview(preview_id, body_hash, stored.authorization,
                stored.intent, current.context, now=now)
        except RiskDenied as error:
            raise ReviewBlocked(error.code) from error
