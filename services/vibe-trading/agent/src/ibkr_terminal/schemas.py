"""Version 1 wire contracts. Money stays decimal text; missing is never zero."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

DecimalText = Annotated[str, StringConstraints(strict=True, pattern=r'^-?(0|[1-9][0-9]*)(\.[0-9]+)?$')]
Mode = Literal['paper', 'live', 'backtest']
DataState = Literal['loading', 'ready', 'empty', 'error', 'stale', 'permission-required']


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)


class Capabilities(Contract):
    # Read contracts never grant write or AI-sharing authority.
    placeOrders: Literal[False] = False
    shareWithAi: Literal[False] = False


class Metrics(Contract):
    netLiquidation: DecimalText | None = None
    unrealizedPnl: DecimalText | None = None
    buyingPower: DecimalText | None = None
    maintenanceMargin: DecimalText | None = None


class CashBalance(Contract):
    currency: str
    amount: DecimalText


class Position(Contract):
    accountKey: str
    conId: int = Field(gt=0)
    symbol: str
    currency: str
    quantity: DecimalText
    averageCost: DecimalText | None = None
    marketValue: DecimalText | None = None
    assetType: str | None = None
    exchange: str | None = None
    name: str | None = None
    unrealizedPnl: DecimalText | None = None


class Quote(Contract):
    conId: int = Field(gt=0)
    state: Literal['realtime', 'delayed', 'frozen', 'disconnected', 'missing']
    price: DecimalText | None
    asOf: str | None
    source: str


class OrderView(Contract):
    accountKey: str
    clientIntentId: str
    conId: int = Field(gt=0)
    quantity: DecimalText
    filled: DecimalText | None
    remaining: DecimalText | None
    submission: Literal['PERSISTED', 'SUBMITTING', 'ACKNOWLEDGED', 'UNKNOWN', 'RECONCILING', 'DENIED']
    execution: Literal['PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'REJECTED', 'INACTIVE', 'UNKNOWN']
    managed: bool
    orderId: int | None = None
    clientId: int | None = None
    permId: int | None = None
    brokerStatus: str | None = None
    symbol: str | None = None
    currency: str | None = None
    side: str | None = None
    limitPrice: DecimalText | None = None


class ExecutionView(Contract):
    accountKey: str
    execId: str
    conId: int = Field(gt=0)
    symbol: str
    currency: str
    orderId: int
    clientId: int
    permId: int
    side: str
    quantity: DecimalText
    price: DecimalText
    executedAt: str | None
    commission: DecimalText | None
    commissionCurrency: str | None


class SourceStamp(Contract):
    source: str
    observedAt: str | None = None
    brokerAsOf: str | None = None
    requestCompletedAt: str | None = None


class Snapshot(Contract):
    schemaVersion: Literal[1]
    snapshotId: str
    accountKey: str
    mode: Mode
    sessionRevision: int = Field(ge=0)
    sequence: int = Field(ge=0)
    source: Literal['ibkr', 'fixture']
    testData: bool
    asOf: str | None
    connection: Literal['unconfigured', 'connecting', 'connected', 'disconnected', 'reconciling', 'error']
    state: DataState
    baseCurrency: str | None
    metrics: Metrics
    cash: tuple[CashBalance, ...]
    positions: tuple[Position, ...]
    orders: tuple[OrderView, ...]
    quotes: tuple[Quote, ...]
    capabilities: Capabilities
    missing: tuple[str, ...]
    detail: str
    executions: tuple[ExecutionView, ...] = ()
    provenance: dict[str, SourceStamp] = Field(default_factory=dict)

    @model_validator(mode='after')
    def isolate_account_and_source(self):
        if not self.accountKey.startswith(f'{self.mode}:'):
            raise ValueError('accountKey must belong to mode namespace')
        if (self.source == 'fixture') != self.testData:
            raise ValueError('fixture data must be explicitly marked; IBKR data cannot be a fixture')
        if any(row.accountKey != self.accountKey for row in (*self.positions, *self.orders, *self.executions)):
            raise ValueError('cross-account row rejected')
        return self
