from types import SimpleNamespace
from src.ibkr_terminal.paper_views import order_display


def test_average_price_uses_matching_execution_quantities_only():
    record = SimpleNamespace(permId=100, clientId=5, orderId=2, filledQuantity='10', model_dump=lambda **_: {'filledQuantity':'10'})
    fills = [SimpleNamespace(permId=100, clientId=5, orderId=2, quantity='4', price='250'),
        SimpleNamespace(permId=100, clientId=5, orderId=2, quantity='6', price='251'),
        SimpleNamespace(permId=999, clientId=5, orderId=2, quantity='5', price='1')]
    assert order_display(record, fills)['averageFillPrice'] == '250.6'
    assert order_display(record, fills[:1])['averageFillPrice'] is None
    record.permId = None
    assert order_display(record, fills)['averageFillPrice'] is None
