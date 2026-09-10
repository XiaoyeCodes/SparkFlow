"""Display fields derived from confirmed broker execution records."""
from decimal import Decimal


def order_display(record, fills, ledger=None):
    identity = (record.permId, record.clientId, record.orderId)
    matched = [fill for fill in fills if None not in identity
        and (fill.permId, fill.clientId, fill.orderId) == identity]
    quantity = sum((Decimal(fill.quantity) for fill in matched), Decimal(0))
    average = (sum((Decimal(fill.quantity) * Decimal(fill.price) for fill in matched), Decimal(0)) / quantity
        if quantity > 0 and quantity == Decimal(record.filledQuantity) else None)
    dispatch_state = None
    if ledger is not None and record.identity is not None:
        from .identity import SubmissionCommand
        from .native_dispatch import command_hash
        digest = command_hash(SubmissionCommand(intent=record.intent, identity=record.identity))
        with ledger._lock:
            attempt = ledger._db.execute('SELECT state FROM sdk_dispatch_attempts WHERE command_hash=? AND account_key=? AND mode=?',
                (digest, record.intent.accountKey, record.intent.mode)).fetchone()
        dispatch_state = attempt[0] if attempt else None
    return {**record.model_dump(mode='json'), 'averageFillPrice': format(average, 'f') if average is not None else None,
        'dispatchState': dispatch_state}
