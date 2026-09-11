from types import SimpleNamespace as NS
from datetime import timedelta
import pytest
from src.ibkr_terminal.paper_account import PaperAccountReconciliation
from src.ibkr_terminal.risk import RiskDenied
from test_orders import ledger,NOW,intent,context
from test_order_events import setup,event,fill,fee


@pytest.mark.parametrize('reason,recovered',[('SDK_SESSION_CHANGED',True),('CONFLICTING_TERMINAL_STATUS',False)])
def test_empty_session_halt_recovers_only_after_completed_account_proof(tmp_path,api_event_loop,reason,recovered):
    from src.ibkr_terminal.reconcile import OrderReconciler
    async def run():
        with ledger(tmp_path/'orders') as db:
            rec=OrderReconciler(db,'paper:engineering','paper',1)
            db._db.execute('INSERT INTO order_integrity_halts VALUES(?,?,?)',('paper','paper:engineering',reason))
            conn=connection(rec,quantity='0')
            conn.session.snapshot().snapshotId='verified-snapshot'
            await PaperAccountReconciliation(conn,rec,clock=lambda:NOW+timedelta(seconds=2)).run()
            assert (db._db.execute('SELECT 1 FROM order_integrity_halts').fetchone() is None)==recovered
            assert any(e['kind']=='EMPTY_SESSION_HALT_RECOVERED' for e in db.audit('paper:engineering'))==recovered
    api_event_loop.run_until_complete(run())


def connection(rec,*,cash='900.5',quantity='1',during=None,during_reconcile=None):
    snapshot=NS(accountKey=rec.account_key,mode='paper',sessionRevision=rec.revision,state='ready',baseCurrency='USD',
        positions=[NS(conId=12,quantity=quantity)],provenance={'positions':NS(requestCompletedAt=(NOW+timedelta(seconds=1)).isoformat())})
    class SDK:
        async def reqAccountSnapshotAsync(self,account):
            return {'portfolio':[NS(account=account,contract=NS(conId=12,currency='USD'),position=quantity)]}
        async def reqFreshSummaryAsync(self):
            if during:during()
            return [NS(account='BROKER-ENGINEERING',tag='TotalCashValue',currency='USD',value=cash)]
    async def reconcile():
        if during_reconcile:during_reconcile()
        return True
    return NS(_ib=SDK(),_fixture=True,binding=NS(brokerAccount='BROKER-ENGINEERING',accountKey=rec.account_key,mode='paper'),
        session=NS(revision=rec.revision,snapshot=lambda:snapshot),healthy=lambda:True,reconciliation_blocked=False,reconcile=reconcile)


def test_completed_cancel_releases_hold_only_after_fresh_broker_cash_and_positions(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders') as db:
            rec=setup(db)
            rec.apply(fill('fill','EX-1','1','99'))
            rec.apply(fee('fee','EX-1','0.5'))
            rec.apply(event('cancelled',status='CANCELLED',filled='1',remaining='0'))
            db.clock=lambda:NOW+timedelta(seconds=2)
            bridge=PaperAccountReconciliation(connection(rec),rec,clock=db.clock)
            assert db.reservations(rec.account_key,'paper')['cash']=='601'
            result=await bridge.run()
            assert result['reconciledOrders']==1
            assert db.reservations(rec.account_key,'paper')['cash']=='0'
            assert not db.get(rec.account_key,'paper','intent-1').reconciliationRequired
    api_event_loop.run_until_complete(run())


@pytest.mark.parametrize('problem',['cash','position'])
def test_conflicting_or_racing_account_proof_keeps_all_reservations(problem,tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders') as db:
            rec=setup(db)
            rec.apply(event('cancelled',status='CANCELLED',filled='0',remaining='0'))
            db.clock=lambda:NOW+timedelta(seconds=2)
            conn=connection(rec,cash='999' if problem=='cash' else '1000',quantity='1' if problem=='position' else '0')
            with pytest.raises(RiskDenied):await PaperAccountReconciliation(conn,rec,clock=db.clock).run()
            assert db.reservations(rec.account_key,'paper')['cash']=='601'
    api_event_loop.run_until_complete(run())


def test_event_during_account_read_retries_complete_proof_and_succeeds(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders') as db:
            rec=setup(db)
            rec.apply(event('cancelled',status='CANCELLED',filled='0',remaining='0'))
            db.clock=lambda:NOW+timedelta(seconds=2)
            calls=0
            def during():
                nonlocal calls
                calls+=1
                if calls==1:
                    rec.apply(event('late-once',status='CANCELLED',filled='0',remaining='0'))
            result=await PaperAccountReconciliation(connection(rec,cash='1000',quantity='0',during=during),rec,clock=db.clock).run()
            assert calls==2 and result['reconciledOrders']==1
            assert db.reservations(rec.account_key,'paper')['cash']=='0'
    api_event_loop.run_until_complete(run())


def test_persistent_event_barrier_race_stops_after_three_full_reads(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders') as db:
            rec=setup(db)
            rec.apply(event('cancelled',status='CANCELLED',filled='0',remaining='0'))
            db.clock=lambda:NOW+timedelta(seconds=2)
            calls=0
            def during():
                nonlocal calls
                calls+=1
                rec.apply(event(f'late-{calls}',status='CANCELLED',filled='0',remaining='0'))
            bridge=PaperAccountReconciliation(connection(rec,cash='1000',quantity='0',during=during),rec,clock=db.clock)
            with pytest.raises(RiskDenied,match='EVENT_BARRIER_CHANGED'):
                await bridge.run()
            assert calls==3 and db.reservations(rec.account_key,'paper')['cash']=='601'
    api_event_loop.run_until_complete(run())


def test_open_order_refresh_precedes_barrier_and_allows_next_reservation(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders') as db:
            rec=setup(db)
            db.clock=lambda:NOW+timedelta(seconds=2)
            calls=0
            def during_reconcile():
                nonlocal calls
                calls+=1
                rec.apply(event('refresh-open',status='OPEN',filled='0',remaining='6'))
            bridge=PaperAccountReconciliation(connection(rec,cash='1000',quantity='0',during_reconcile=during_reconcile),rec,clock=db.clock)
            result=await bridge.run()
            open_order=db.get(rec.account_key,'paper','intent-1')
            assert calls==1 and result['reconciledOrders']==1
            assert open_order.execution=='OPEN' and not open_order.reconciliationRequired
            assert open_order.reservedCash=='601'
            db.reserve(intent('next',quantity='1'),context(snapshotId='next-read',asOf=NOW+timedelta(seconds=1),
                totalCash='1000',settledCash='1000'))
            assert db.get(rec.account_key,'paper','next').submission=='PERSISTED'
    api_event_loop.run_until_complete(run())
