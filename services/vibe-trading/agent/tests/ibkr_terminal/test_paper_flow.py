import pytest
from src.ibkr_terminal.paper_flow import PaperOrderFlow
from src.ibkr_terminal.risk import RiskDenied
from test_native_dispatch import harness
from test_orders import ledger,NOW
from test_reviews import Source,draft


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
