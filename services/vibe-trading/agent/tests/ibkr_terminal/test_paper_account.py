from types import SimpleNamespace as NS
from datetime import timedelta
import pytest
from src.ibkr_terminal.paper_account import PaperAccountReconciliation
from src.ibkr_terminal.risk import RiskDenied
from test_orders import ledger,NOW
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


def connection(rec,*,cash='900.5',quantity='1',during=None):
    snapshot=NS(accountKey=rec.account_key,mode='paper',sessionRevision=1,state='ready',baseCurrency='USD',
        positions=[NS(conId=12,quantity=quantity)],provenance={'positions':NS(requestCompletedAt=(NOW+timedelta(seconds=1)).isoformat())})
    class SDK:
        async def reqAccountSnapshotAsync(self,account):
            return {'portfolio':[NS(account=account,contract=NS(conId=12,currency='USD'),position=quantity)]}
        async def reqFreshSummaryAsync(self):
            if during:during()
            return [NS(account='BROKER-ENGINEERING',tag='TotalCashValue',currency='USD',value=cash)]
    async def reconcile():return True
    return NS(_ib=SDK(),_fixture=True,binding=NS(brokerAccount='BROKER-ENGINEERING',accountKey=rec.account_key,mode='paper'),
        session=NS(revision=1,snapshot=lambda:snapshot),healthy=lambda:True,reconciliation_blocked=False,reconcile=reconcile)


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


@pytest.mark.parametrize('problem',['cash','position','event'])
def test_conflicting_or_racing_account_proof_keeps_all_reservations(problem,tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders') as db:
            rec=setup(db)
            rec.apply(event('cancelled',status='CANCELLED',filled='0',remaining='0'))
            db.clock=lambda:NOW+timedelta(seconds=2)
            during=(lambda:rec.apply(event('late',status='CANCELLED',filled='0',remaining='0'))) if problem=='event' else None
            conn=connection(rec,cash='999' if problem=='cash' else '1000',quantity='1' if problem=='position' else '0',during=during)
            with pytest.raises(RiskDenied):await PaperAccountReconciliation(conn,rec,clock=db.clock).run()
            assert db.reservations(rec.account_key,'paper')['cash']=='601'
    api_event_loop.run_until_complete(run())
