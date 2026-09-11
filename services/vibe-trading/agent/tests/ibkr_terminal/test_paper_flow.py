import pytest
from src.ibkr_terminal.paper_flow import PaperOrderFlow
from src.ibkr_terminal.risk import RiskDenied
from test_native_dispatch import harness
from test_orders import ledger,NOW
from test_reviews import Source,draft
from decimal import Decimal
from src.ibkr_terminal.reconcile import OrderReconciler


def test_next_preview_keeps_reconciling_prior_order_reserved_and_continues(tmp_path,api_event_loop):
    from types import SimpleNamespace
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            source=Source(); calls=[]
            async def prepare(d):
                calls.append('prepare')
                return source.load(d)
            source.prepare=prepare; source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            preview=await flow.preview(draft(quantity='1'))
            flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            async def reconcile():
                calls.append('reconcile')
                raise RiskDenied('COMMISSION_PENDING')
            flow.account_reconciliation=SimpleNamespace(run=reconcile)
            calls.clear()
            next_preview = await flow.preview(draft(quantity='1'))
            assert next_preview.quantity == '1'
            assert calls == ['reconcile','prepare'] and len(packets)==1
    api_event_loop.run_until_complete(run())


def test_preview_refreshes_stale_account_checkpoint_before_risk_review(tmp_path,api_event_loop):
    from types import SimpleNamespace
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            with db.transaction():
                row=db.get('paper:engineering','paper','intent-1')
                db._replace(row.model_copy(update={'submission':'ACKNOWLEDGED','permId':901}),'TEST_ACK')
            source=Source();calls=[]
            async def prepare(d):
                calls.append('prepare')
                return source.load(d)
            async def reconcile():
                calls.append('reconcile')
            source.prepare=prepare;source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            flow.account_reconciliation=SimpleNamespace(checkpoint_stale=lambda:True,run=reconcile)
            await flow.preview(draft(quantity='1'))
            assert calls==['reconcile','prepare'] and packets==[]
    api_event_loop.run_until_complete(run())


@pytest.mark.parametrize('persistent',[False,True])
def test_preview_retries_checkpoint_race_once_without_looping_or_sending(tmp_path,api_event_loop,persistent):
    from types import SimpleNamespace
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            with db.transaction():
                row=db.get('paper:engineering','paper','intent-1')
                db._replace(row.model_copy(update={'submission':'ACKNOWLEDGED','permId':901}),'TEST_ACK')
            source=Source();calls=[]
            async def prepare(d):
                calls.append('prepare')
                return source.load(d)
            async def reconcile():
                calls.append('reconcile')
            source.prepare=prepare;source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            flow.account_reconciliation=SimpleNamespace(checkpoint_stale=lambda:False,run=reconcile)
            original=flow.reviews.preview
            attempts=0
            def preview(d):
                nonlocal attempts
                attempts+=1
                if persistent or attempts==1:
                    raise RiskDenied('STALE_ACCOUNT_CHECKPOINT')
                return original(d)
            flow.reviews.preview=preview
            if persistent:
                with pytest.raises(RiskDenied,match='STALE_ACCOUNT_CHECKPOINT'):
                    await flow.preview(draft(quantity='1'))
            else:
                await flow.preview(draft(quantity='1'))
            assert calls==['prepare','reconcile','prepare'] and attempts==2 and packets==[]
    api_event_loop.run_until_complete(run())


def test_market_order_reserves_cash_without_sending_a_limit_and_is_idempotent(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            source=Source()
            async def prepare(d): return source.load(d)
            source.prepare=prepare; source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            preview=await flow.preview(draft(quantity='1',orderType='MKT',limitPrice=None))
            assert preview.orderType=='MKT' and preview.limitPrice is None
            assert Decimal(preview.reservedCash)==Decimal('106')
            assert any('5%' in warning for warning in preview.warnings)
            source.current=source.current.model_copy(update={'referencePrice':'101'})
            row=flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            assert row.intent.limitPrice is None and row.intent.orderType=='MKT'
            assert Decimal(row.reservationPrice)==Decimal('106.05')
            assert Decimal(row.reservedCash)==Decimal('107.05')
            assert len(packets)==1 and b'MKT\x00' in packets[0] and b'LMT\x00' not in packets[0]
            again=flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            assert again.intent==row.intent and len(packets)==1
            rec=OrderReconciler(db,row.intent.accountKey,'paper',1)
            assert Decimal(rec._full_hold(row).reservedCash)==Decimal('107.05')
    api_event_loop.run_until_complete(run())


@pytest.mark.parametrize('change,code', [({'quoteState':'missing'},'QUOTE_UNAVAILABLE'),({'settledCash':'1'},'INSUFFICIENT_CASH')])
def test_market_order_preserves_session_quote_and_cash_checks(tmp_path,api_event_loop,change,code):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            source=Source(); source.current=source.current.model_copy(update=change)
            async def prepare(d): return source.load(d)
            source.prepare=prepare; source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            with pytest.raises(ValueError,match=code):
                await flow.preview(draft(quantity='1',orderType='MKT',limitPrice=None))
            assert packets==[]
    api_event_loop.run_until_complete(run())


def test_market_order_outside_rth_reaches_native_paper_order(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            source=Source();source.current=source.current.model_copy(update={'regularHours':False,'referenceKind':'broker-snapshot','quoteState':'delayed'})
            async def prepare(d): return source.load(d)
            source.prepare=prepare;source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            preview=await flow.preview(draft(quantity='1',orderType='MKT',limitPrice=None))
            row=flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            assert row.intent.orderType=='MKT' and len(packets)==1
    api_event_loop.run_until_complete(run())


def test_paper_confirmation_reaches_native_wire_once_with_bound_permission(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            source=Source()
            async def prepare(d): return source.load(d)
            source.prepare=prepare
            source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            preview=await flow.preview(draft(quantity='1'))
            assert not packets
            with pytest.raises(RiskDenied,match='EXPLICIT_CONFIRMATION_REQUIRED'):
                flow.confirm(preview.previewId,preview.bodyHash,explicit=False)
            row=flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            assert row.submission=='SUBMITTING' and len(packets)==1
            again=flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            assert again.intent==row.intent and len(packets)==1
            assert db._db.execute('SELECT count(*) FROM sdk_dispatch_permits').fetchone()[0]==1
    api_event_loop.run_until_complete(run())


def test_paper_flow_default_disabled_and_live_never_enabled(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,*_=values
            flow=PaperOrderFlow(dispatcher,Source(),clock=lambda:NOW)
            with pytest.raises(RiskDenied,match='PAPER_EXECUTION_DISABLED'):
                await flow.preview(draft())
            flow.enabled=True
            with pytest.raises(RiskDenied,match='PAPER_ACCOUNT_SCOPE'):
                await flow.preview(draft(accountKey='live:engineering',mode='live'))
            assert packets==[]
    api_event_loop.run_until_complete(run())


def test_new_quote_rechecks_risk_without_changing_confirmed_limit(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            source=Source()
            async def prepare(d): return source.load(d)
            source.prepare=prepare;source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            preview=await flow.preview(draft(quantity='1'))
            source.current=source.current.model_copy(update={'referencePrice':'100.01'})
            row=flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            assert row.intent.limitPrice=='100' and len(packets)==1
    api_event_loop.run_until_complete(run())


def test_new_account_risk_can_reject_previously_approved_preview(tmp_path,api_event_loop):
    async def run():
        with ledger(tmp_path/'orders.db') as db,harness(db) as values:
            dispatcher,sdk,packets,_,_,instrument=values
            source=Source()
            async def prepare(d): return source.load(d)
            source.prepare=prepare;source.instrument=instrument
            flow=PaperOrderFlow(dispatcher,source,enabled=True,clock=lambda:NOW)
            preview=await flow.preview(draft(quantity='1'))
            source.current=source.current.model_copy(update={'settledCash':'1'})
            with pytest.raises(ValueError,match='INSUFFICIENT_CASH'):
                flow.confirm(preview.previewId,preview.bodyHash,explicit=True)
            assert packets==[]
    api_event_loop.run_until_complete(run())
