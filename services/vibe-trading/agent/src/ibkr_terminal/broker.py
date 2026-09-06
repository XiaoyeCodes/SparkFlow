"""Submission orchestration. Real broker dispatch remains disabled in P3.1.

There is no SDK import here. Only explicitly injected engineering transports
may run; fake implementations live in tests, never in a production fallback.
"""
from typing import Protocol

from pydantic import Field

from .risk import RiskDenied
from .schemas import Contract
from .identity import BrokerSession, SubmissionCommand, CancellationCommand, ModificationCommand


class BrokerAck(Contract):
    orderId: int = Field(ge=0, strict=True)
    clientId: int = Field(gt=0, strict=True)
    permId: int = Field(gt=0, strict=True)


class BrokerTransport(Protocol):
    source: str

    def session(self) -> BrokerSession: ...

    def submit(self, command: SubmissionCommand) -> BrokerAck: ...

    def cancel(self, command: CancellationCommand) -> None: ...

    def modify(self, command: ModificationCommand) -> None: ...


class OrderExecutor:
    def __init__(self, ledger, broker: BrokerTransport):
        self.ledger, self.broker = ledger, broker

    def submit(self, account_key, mode, intent_id, context):
        # Real paper also requires its own later consent and adapter. A label
        # on an account or context can never turn this gate on.
        record = self.ledger.get(account_key, mode, intent_id)
        if not self.ledger.allow_fixtures or self.broker.source != 'fixture' or record is None or record.source != 'fixture':
            raise RiskDenied('BROKER_WRITE_DISABLED')
        if record.submission != 'PERSISTED':
            return record
        record, claimed = self.ledger.claim_submission(account_key, mode, intent_id, context, channel=self.broker.session())
        if not claimed:
            return record
        try:
            ack = self.broker.submit(SubmissionCommand(intent=record.intent, identity=record.identity))
            ack = BrokerAck.model_validate(ack.model_dump())
            return self.ledger.finish_submission(account_key, mode, intent_id, ack=ack)
        except Exception as error:
            # Even a transport error before receiving an ack may follow a
            # successful send. Persist UNKNOWN and retain all reservations.
            return self.ledger.finish_submission(account_key, mode, intent_id, reason=error.code if isinstance(error, RiskDenied) else type(error).__name__)
        except BaseException as error:
            self.ledger.finish_submission(account_key, mode, intent_id, reason=type(error).__name__)
            raise

    def cancel(self, account_key, mode, intent_id, request_id):
        record = self.ledger.get(account_key, mode, intent_id)
        if not self.ledger.allow_fixtures or self.broker.source != 'fixture' or record is None or record.source != 'fixture':
            raise RiskDenied('BROKER_WRITE_DISABLED')
        if record.cancelState not in ('NONE', 'PERSISTED'):
            return record
        record, command, claimed = self.ledger.claim_cancel(account_key, mode, intent_id, request_id, self.broker.session())
        if not claimed:
            return record
        try:
            self.broker.cancel(command)
        except Exception as error:
            return self.ledger.finish_cancel(account_key, mode, intent_id, error=type(error).__name__)
        except BaseException as error:
            self.ledger.finish_cancel(account_key, mode, intent_id, error=type(error).__name__)
            raise
        return self.ledger.finish_cancel(account_key, mode, intent_id)
