"""Display fields derived from confirmed broker execution records."""
from decimal import Decimal


def order_display(record, fills):
    identity = (record.permId, record.clientId, record.orderId)
    matched = [fill for fill in fills if None not in identity
        and (fill.permId, fill.clientId, fill.orderId) == identity]
    quantity = sum((Decimal(fill.quantity) for fill in matched), Decimal(0))
    average = (sum((Decimal(fill.quantity) * Decimal(fill.price) for fill in matched), Decimal(0)) / quantity
        if quantity > 0 and quantity == Decimal(record.filledQuantity) else None)
    return {**record.model_dump(mode='json'), 'averageFillPrice': format(average, 'f') if average is not None else None}
