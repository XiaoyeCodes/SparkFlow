"""Explicit broker-channel identity; no port/account-prefix inference."""
from typing import Literal

from pydantic import Field

from .risk import Amount, Identifier, OrderIntent
from .schemas import Contract


class BrokerSession(Contract):
    channelKey: Identifier
    source: Literal['fixture', 'ibkr']
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    sessionRevision: int = Field(gt=0, strict=True)
    clientId: int = Field(gt=0, strict=True)
    nextValidId: int = Field(gt=0, strict=True)
    ready: bool


class BrokerIdentity(Contract):
    channelKey: Identifier
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    sessionRevision: int = Field(gt=0, strict=True)
    clientId: int = Field(gt=0, strict=True)
    orderId: int = Field(gt=0, strict=True)
    orderRef: str = Field(pattern=r'^SF-[a-f0-9]{24}$')


class SubmissionCommand(Contract):
    intent: OrderIntent
    identity: BrokerIdentity


class CancellationCommand(Contract):
    identity: BrokerIdentity
    permId: int = Field(gt=0, strict=True)
    requestId: Identifier


class ModificationCommand(SubmissionCommand):
    permId: int = Field(gt=0, strict=True)
    amendmentId: Identifier
    expectedVersion: int = Field(gt=0, strict=True)


class ReadOrderEvidence(Contract):
    channelKey: Identifier
    source: Literal['fixture', 'ibkr']
    accountKey: Identifier
    mode: Literal['paper', 'live', 'backtest']
    sessionRevision: int = Field(gt=0, strict=True)
    clientId: int = Field(gt=0, strict=True)
    orderId: int = Field(gt=0, strict=True)
    orderRef: Identifier
    permId: int = Field(gt=0, strict=True)
    conId: int = Field(gt=0, strict=True)
    side: Literal['BUY', 'SELL']
    quantity: Amount
    orderType: Literal['LMT', 'MKT']
    limitPrice: Amount | None
    tif: Literal['DAY', 'GTC']
