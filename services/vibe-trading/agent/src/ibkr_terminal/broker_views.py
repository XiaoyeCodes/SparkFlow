"""Deterministic, read-only IBKR views. Order ownership is never inferred."""
from datetime import datetime
from decimal import Decimal, InvalidOperation
from sys import float_info

from src.trading.connectors.ibkr.local import _obj_get, _contract_to_dict
from .schemas import OrderView, ExecutionView


def decimal_text(value):
    if value is None or value == '':
        return None
    try:
        number = Decimal(str(value))
        return format(number, 'f') if number.is_finite() and number != Decimal(str(float_info.max)) else None
    except InvalidOperation:
        return None


def order_view(trade, account_key):
    order, status = _obj_get(trade, 'order'), _obj_get(trade, 'orderStatus')
    contract = _contract_to_dict(_obj_get(trade, 'contract'))
    raw_status = str(_obj_get(status, 'status', ''))
    execution = {'PendingSubmit': 'PENDING', 'ApiPending': 'PENDING', 'PreSubmitted': 'OPEN', 'Submitted': 'OPEN',
        'PendingCancel': 'CANCEL_PENDING', 'ApiCancelled': 'CANCELLED', 'Cancelled': 'CANCELLED', 'Filled': 'FILLED', 'Inactive': 'INACTIVE'}.get(raw_status, 'UNKNOWN')
    filled, remaining = decimal_text(_obj_get(status, 'filled')), decimal_text(_obj_get(status, 'remaining'))
    if execution == 'OPEN' and filled is not None and Decimal(filled) > 0 and remaining is not None and Decimal(remaining) > 0:
        execution = 'PARTIALLY_FILLED'
    order_id, client_id, perm_id = (_obj_get(order, key) for key in ('orderId', 'clientId', 'permId'))
    return OrderView(accountKey=account_key, clientIntentId=f'external:{client_id}:{order_id}:{perm_id}',
        conId=contract['con_id'], quantity=decimal_text(_obj_get(order, 'totalQuantity')), filled=filled, remaining=remaining,
        submission='ACKNOWLEDGED', execution=execution, managed=False, orderId=order_id, clientId=client_id, permId=perm_id,
        brokerStatus=raw_status, symbol=contract['symbol'], currency=contract['currency'], side=_obj_get(order, 'action'),
        limitPrice=decimal_text(_obj_get(order, 'lmtPrice')) if _obj_get(order, 'orderType') == 'LMT' else None)


def execution_view(fill, account_key):
    execution = _obj_get(fill, 'execution')
    contract = _contract_to_dict(_obj_get(fill, 'contract'))
    report = _obj_get(fill, 'commissionReport')
    timestamp = _obj_get(execution, 'time')
    # Never invent a timezone for a broker timestamp that did not specify one.
    timestamp = timestamp.isoformat() if isinstance(timestamp, datetime) and timestamp.tzinfo is not None else None
    exec_id = _obj_get(execution, 'execId')
    commission = decimal_text(_obj_get(report, 'commission')) if _obj_get(report, 'execId') == exec_id else None
    return ExecutionView(accountKey=account_key, execId=exec_id, conId=contract['con_id'], symbol=contract['symbol'], currency=contract['currency'],
        orderId=_obj_get(execution, 'orderId'), clientId=_obj_get(execution, 'clientId'), permId=_obj_get(execution, 'permId'), side=_obj_get(execution, 'side'),
        quantity=decimal_text(_obj_get(execution, 'shares')), price=decimal_text(_obj_get(execution, 'price')), executedAt=timestamp,
        commission=commission, commissionCurrency=_obj_get(report, 'currency') if commission is not None else None)
