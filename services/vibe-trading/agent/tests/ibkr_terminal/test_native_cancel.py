from datetime import timedelta
import asyncio
import sqlite3
import pytest
from ib_async import OrderState
from src.ibkr_terminal.native_dispatch import command_hash
from src.ibkr_terminal.order_codec import encode_order
from src.ibkr_terminal.risk import RiskDenied
from test_native_dispatch import harness
from test_orders import ledger, NOW


def cancel_input(db, values):
    dispatcher, sdk, packets, submit, permit, instrument = values
    c, o = encode_order(submit, dispatcher.binding, instrument)
    o.permId = 901
    sdk.wrapper.openOrder(submit.identity.orderId, c, o, OrderState(status='Submitted'))
    row, command, claimed = db.claim_cancel(submit.intent.accountKey, 'paper', submit.intent.clientIntentId,
        'native-cancel-1', dispatcher.session())
    assert claimed
    permit = permit.model_copy(update={'permitId':'cancel-permit', 'commandHash':command_hash(command),
        'purpose':'cancel', 'authorizationHash':None})
    dispatcher.record_permit(permit)
    return command, permit


def test_native_cancel_is_durable_once_and_waits_for_broker_ack(tmp_path, api_event_loop):
    async def run():
        path = tmp_path/'orders.db'
        with ledger(path) as db, harness(db) as values:
            dispatcher, sdk, packets, *_ = values
            command, permit = cancel_input(db, values)
            def capture(payload):
                with sqlite3.connect(path) as other:
                    assert other.execute('SELECT state FROM sdk_dispatch_attempts').fetchone()[0]=='WRITING'
                packets.append(payload)
            sdk.client.conn.sendMsg = capture
            for _ in range(2):
                assert dispatcher.cancel(command, permit.permitId).state == 'SENT'
            assert len(packets)==1 and packets[0][4:].decode().split('\0')[0]=='4'
            row=db.get('paper:engineering','paper','intent-1')
            assert row.cancelState=='REQUESTED' and row.execution=='CANCEL_PENDING'
            assert row.reservedCash=='601'
            sdk.wrapper.orderStatus(71,'Cancelled',0,0,0,901,0,0,78,'')
            assert db.get('paper:engineering','paper','intent-1').cancelState=='ACKNOWLEDGED'
    api_event_loop.run_until_complete(run())


@pytest.mark.parametrize('failure',['expired','revoked','wrong_account','wrong_request','wrong_purpose','filled','disconnected'])
def test_cancel_rechecks_permission_and_ownership(tmp_path,api_event_loop,failure):
    async def run():
        with ledger(tmp_path/'orders.db') as db, harness(db) as values:
            dispatcher,sdk,packets,*_=values
            command,permit=cancel_input(db,values)
            if failure=='expired': dispatcher.clock=lambda: NOW+timedelta(minutes=1)
            if failure=='revoked': dispatcher.revoke_permit(permit.permitId)
            if failure=='wrong_account': sdk.client._accounts=['OTHER']
            if failure=='wrong_request': command=command.model_copy(update={'requestId':'other'})
            if failure=='wrong_purpose':
                permit=permit.model_copy(update={'permitId':'wrong','purpose':'submit','authorizationHash':'a'*64})
                dispatcher.record_permit(permit)
            if failure=='filled': sdk.wrapper.orderStatus(71,'Filled',6,0,100,901,0,100,78,'')
            if failure=='disconnected': sdk.client._apiReady=False
            with pytest.raises(RiskDenied): dispatcher.cancel(command,permit.permitId)
            assert packets==[]
    api_event_loop.run_until_complete(run())


def test_cancel_timeout_and_restart_never_resend(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db,ack_timeout_seconds=0.01) as values:
            dispatcher,sdk,packets,*_=values
            command,permit=cancel_input(db,values)
            dispatcher.cancel(command,permit.permitId)
            await asyncio.sleep(0.03)
            row=db.get('paper:engineering','paper','intent-1')
            assert row.cancelState=='UNKNOWN' and row.reconciliationRequired
            assert dispatcher.cancel(command,permit.permitId).state=='UNKNOWN'
            assert len(packets)==1
    api_event_loop.run_until_complete(run())


def test_cancel_transport_loss_keeps_reservation(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,*_=values
            command,permit=cancel_input(db,values)
            def lost(payload):
                packets.append(payload)
                raise TimeoutError('wire handed off')
            sdk.client.conn.sendMsg=lost
            assert dispatcher.cancel(command,permit.permitId).state=='UNKNOWN'
            assert dispatcher.cancel(command,permit.permitId).state=='UNKNOWN'
            assert len(packets)==1 and db.get('paper:engineering','paper','intent-1').reservedCash=='601'
    api_event_loop.run_until_complete(run())


def test_recovery_updates_native_cancel_receipt(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,*_=values
            command,permit=cancel_input(db,values)
            dispatcher.cancel(command,permit.permitId)
            assert db.recover_inflight()==1
            assert db.get('paper:engineering','paper','intent-1').cancelState=='UNKNOWN'
            assert dispatcher.cancel(command,permit.permitId).state=='UNKNOWN'
            assert len(packets)==1
    api_event_loop.run_until_complete(run())


def test_expired_new_risk_grant_does_not_prevent_explicit_cancel(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,*_=values
            command,permit=cancel_input(db,values)
            db.revoke_authorization('fixture-auth')
            assert dispatcher.cancel(command,permit.permitId).state=='SENT'
            assert len(packets)==1
    api_event_loop.run_until_complete(run())


def test_cancel_rechecks_expiry_during_sdk_serialization(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,*_=values
            command,permit=cancel_input(db,values)
            original=sdk.client.cancelOrder
            def delayed(*args):
                dispatcher.clock=lambda:NOW+timedelta(minutes=1)
                return original(*args)
            sdk.client.cancelOrder=delayed
            with pytest.raises(RiskDenied,match='DISPATCH_PERMIT_EXPIRED'):
                dispatcher.cancel(command,permit.permitId)
            assert packets==[] and db.get('paper:engineering','paper','intent-1').cancelState=='UNKNOWN'
    api_event_loop.run_until_complete(run())
