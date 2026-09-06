"""Pure whitelist signal evaluation shared by backtest and paper adapters."""
from datetime import timezone
from decimal import Decimal, localcontext
from hashlib import sha256

from pydantic import AwareDatetime, Field

from .risk import Amount, canonical
from .schemas import Contract
from .strategy import StrategyRecord


class SignalCoreError(ValueError):
    pass


class SignalObservation(Contract):
    conId: int = Field(gt=0, strict=True)
    observedAt: AwareDatetime
    close: Amount

    def positive_price(self):
        return Decimal(self.close) > 0


class TargetSignal(Contract):
    conId: int = Field(gt=0, strict=True)
    observedAt: AwareDatetime
    targetQuantity: Amount
    reason: str


def generate_target_signals(strategy: StrategyRecord, observations):
    """Evaluate a stored structured strategy without imports, eval, or future rows."""
    strategy = StrategyRecord.model_validate(strategy.model_dump())
    rows = tuple(SignalObservation.model_validate(row.model_dump()) for row in observations)
    if strategy.strategyHash != sha256(canonical(strategy.definition).encode()).hexdigest():
        raise SignalCoreError('STRATEGY_HASH_INVALID')
    if len(strategy.definition.universe) != 1:
        raise SignalCoreError('MULTI_ASSET_NOT_VERIFIED')
    con_id = strategy.definition.universe[0]
    if any(row.conId != con_id for row in rows):
        raise SignalCoreError('UNIVERSE_SCOPE')
    times = [row.observedAt.astimezone(timezone.utc) for row in rows]
    if any(left >= right for left, right in zip(times, times[1:])):
        raise SignalCoreError('OBSERVATIONS_NOT_STRICTLY_ORDERED')
    if any(not row.positive_price() for row in rows):
        raise SignalCoreError('INVALID_PRICE')

    spec = strategy.definition.signal
    target_quantity = strategy.definition.positionSizing.targetQuantity
    current_target = '0'
    decisions = []
    with localcontext() as arithmetic:
        arithmetic.prec = 80
        closes = [Decimal(row.close) for row in rows]
        for index, row in enumerate(rows):
            if index + 1 < spec.slowWindow:
                continue
            fast = sum(closes[index + 1 - spec.fastWindow:index + 1], Decimal(0)) / Decimal(spec.fastWindow)
            slow = sum(closes[index + 1 - spec.slowWindow:index + 1], Decimal(0)) / Decimal(spec.slowWindow)
            target = target_quantity if fast > slow else '0'
            if target == current_target:
                continue
            reason = 'SMA_FAST_ABOVE_SLOW' if target != '0' else 'SMA_FAST_AT_OR_BELOW_SLOW'
            decisions.append(TargetSignal(conId=con_id, observedAt=row.observedAt.astimezone(timezone.utc),
                targetQuantity=target, reason=reason))
            current_target = target
    return tuple(decisions)
