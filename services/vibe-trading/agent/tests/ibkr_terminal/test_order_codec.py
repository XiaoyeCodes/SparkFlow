from decimal import Decimal

import pytest
from pydantic import ValidationError

from src.ibkr_terminal.broker import BrokerAck
from src.ibkr_terminal.identity import BrokerIdentity, SubmissionCommand, ModificationCommand, CancellationCommand
from src.ibkr_terminal.order_codec import ResolvedInstrument, encode_order, encode_cancel
from src.ibkr_terminal.session import AccountBinding
from src.ibkr_terminal.risk import RiskDenied
from test_orders import intent


def inputs():
    binding = AccountBinding(mode='paper', accountKey='paper:engineering', brokerAccount='TEST-ACCOUNT', confirmed=True, clientId=78)
    identity = BrokerIdentity(channelKey='engineering-gateway', accountKey=binding.accountKey, mode='paper', sessionRevision=1,
        clientId=78, orderId=71, orderRef='SF-' + 'a' * 24)
    instrument = ResolvedInstrument(conId=12, symbol='TEST', secType='STK', currency='USD', exchange='SMART', primaryExchange='NASDAQ',
        multiplier='1', minTick='0.01', minQuantity='1')
    return binding, identity, instrument


def test_native_sdk_serialization_keeps_account_decimal_and_identity_without_network(api_event_loop):
    async def scenario():
        from ib_async import IB
        binding, identity, instrument = inputs()
        command = SubmissionCommand(intent=intent(), identity=identity)
        contract, order = encode_order(command, binding, instrument)
        assert order.account == 'TEST-ACCOUNT' and order.orderRef == identity.orderRef
        assert order.totalQuantity == Decimal('6') and isinstance(order.lmtPrice, Decimal)
        assert order.outsideRth is False and order.tif == 'DAY'
        ib = IB()
        ib.wrapper.clientId = 78
        ib.client._serverVersion = 180
        packets = []
        ib.client.send = lambda *args, **kwargs: packets.append(args)
        trade = ib.placeOrder(contract, order)  # actual SDK; send intercepted, no connection
        assert len(packets) == 1
        assert packets[0][0] == 3 and 'TEST-ACCOUNT' in packets[0] and identity.orderRef in packets[0]
        assert Decimal('6') in packets[0]
        assert trade.orderStatus.status == 'PendingSubmit'
        assert trade.order.permId == 0
        with pytest.raises(ValidationError):
            BrokerAck(orderId=trade.order.orderId, clientId=trade.order.clientId, permId=trade.order.permId)
    api_event_loop.run_until_complete(scenario())


def test_amendment_and_cancel_encoding_keep_owned_ids_and_never_bind_external_orders():
    binding, identity, instrument = inputs()
    command = ModificationCommand(intent=intent(quantity='8'), identity=identity, permId=901, amendmentId='amend-1', expectedVersion=1)
    _, order = encode_order(command, binding, instrument)
    cancel = encode_cancel(CancellationCommand(identity=identity, permId=901, requestId='cancel-1'), binding)
    for native in (order, cancel):
        assert (native.orderId, native.clientId, native.permId, native.orderRef) == (71, 78, 901, identity.orderRef)
    assert order.totalQuantity == Decimal('8')


def test_codec_refuses_cross_account_contract_and_client_without_guessing_symbol():
    binding, identity, instrument = inputs()
    command = SubmissionCommand(intent=intent(), identity=identity)
    for bad_binding, bad_instrument in [(binding.model_copy(update={'accountKey': 'paper:other'}), instrument),
        (binding.model_copy(update={'clientId': 79}), instrument), (binding, instrument.model_copy(update={'conId': 99}))]:
        with pytest.raises(RiskDenied):
            encode_order(command, bad_binding, bad_instrument)


def test_codec_never_silently_rewrites_unsupported_order_policy():
    binding, identity, instrument = inputs()
    with pytest.raises(RiskDenied, match='UNSUPPORTED_ORDER_POLICY'):
        encode_order(SubmissionCommand(intent=intent(tif='GTC'), identity=identity), binding, instrument)
    with pytest.raises(RiskDenied, match='INVALID_ORDER_INCREMENT'):
        encode_order(SubmissionCommand(intent=intent(), identity=identity), binding, instrument.model_copy(update={'minTick': '0'}))
