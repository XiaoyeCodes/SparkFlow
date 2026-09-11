"""Pure conversion to pinned ib_async objects; never calls an SDK method."""
from decimal import Decimal, localcontext
from typing import Literal

from pydantic import Field

from .identity import CancellationCommand, ModificationCommand, SubmissionCommand
from .risk import Amount, Identifier, OrderIntent, RiskDenied
from .schemas import Contract
from .session import AccountBinding


class ResolvedInstrument(Contract):
    # Must come from a trusted contract lookup; symbol is display-only.
    conId: int = Field(gt=0, strict=True)
    symbol: Identifier
    secType: Literal['STK']
    currency: Literal['USD']
    exchange: Identifier
    primaryExchange: str | None = None
    multiplier: Literal['1']
    minTick: Amount
    minQuantity: Literal['1']


def _scope(identity, intent, binding, instrument=None):
    identity = type(identity).model_validate(identity.model_dump())
    binding = AccountBinding.model_validate(binding.model_dump())
    intent = OrderIntent.model_validate(intent.model_dump())
    if (identity.accountKey, identity.mode, identity.clientId) != (intent.accountKey, intent.mode, binding.clientId):
        raise RiskDenied('BROKER_IDENTITY_SCOPE')
    if (binding.accountKey, binding.mode) != (intent.accountKey, intent.mode) or identity.sessionRevision > intent.sessionRevision:
        raise RiskDenied('BROKER_BINDING_SCOPE')
    if instrument:
        instrument = ResolvedInstrument.model_validate(instrument.model_dump())
        if instrument.conId != intent.conId:
            raise RiskDenied('CONTRACT_IDENTITY_SCOPE')
    return identity, intent, binding, instrument


def encode_order(command, binding, instrument):
    from ib_async import Contract as IbContract, Order
    if not isinstance(command, (SubmissionCommand, ModificationCommand)):
        raise RiskDenied('UNSUPPORTED_COMMAND')
    command = type(command).model_validate(command.model_dump())
    identity, intent, binding, instrument = _scope(command.identity, command.intent, binding, instrument)
    if intent.tif != 'DAY' or (intent.orderType == 'MKT' and isinstance(command, ModificationCommand)):
        raise RiskDenied('UNSUPPORTED_ORDER_POLICY')
    price, tick = Decimal(intent.limitPrice) if intent.limitPrice is not None else None, Decimal(instrument.minTick)
    with localcontext() as arithmetic:
        arithmetic.prec = 80
        if tick <= 0 or price is not None and (price <= 0 or price % tick) or Decimal(intent.quantity) % Decimal(instrument.minQuantity):
            raise RiskDenied('INVALID_ORDER_INCREMENT')
    exchange = 'OVERNIGHT' if intent.tradingSession == 'OVERNIGHT' else instrument.exchange
    native_contract = IbContract(conId=instrument.conId, symbol=instrument.symbol, secType=instrument.secType,
        currency=instrument.currency, exchange=exchange, primaryExchange=instrument.primaryExchange or '', multiplier='1')
    # Both broker-routed modes opt into eligible pre-market/after-hours sessions.
    native_order = Order(orderId=identity.orderId, clientId=identity.clientId, permId=command.permId if isinstance(command, ModificationCommand) else 0,
        account=binding.brokerAccount, orderRef=identity.orderRef, action=intent.side, totalQuantity=Decimal(intent.quantity),
        orderType=intent.orderType, tif='DAY', outsideRth=True, transmit=True,
        **({'lmtPrice': price} if price is not None else {}))
    return native_contract, native_order


def encode_cancel(command, binding):
    from ib_async import Order
    command = CancellationCommand.model_validate(command.model_dump())
    binding = AccountBinding.model_validate(binding.model_dump())
    identity = command.identity
    if (identity.accountKey, identity.mode, identity.clientId) != (binding.accountKey, binding.mode, binding.clientId):
        raise RiskDenied('BROKER_BINDING_SCOPE')
    return Order(orderId=identity.orderId, clientId=identity.clientId, permId=command.permId,
        account=binding.brokerAccount, orderRef=identity.orderRef)
