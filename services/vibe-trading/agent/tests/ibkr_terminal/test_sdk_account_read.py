import asyncio
import pytest
from ib_async import Contract
from src.ibkr_terminal.sdk import ObservedIB


def test_fresh_account_read_requires_matching_end_and_discards_old_portfolio(api_event_loop):
    async def run():
        ib=ObservedIB()
        class Client:
            def isConnected(self): return False
            def reqAccountUpdates(self, subscribe, account):
                if subscribe:
                    ib.wrapper.updateAccountValue('NetLiquidation','1000','USD','TEST')
                    ib.wrapper.accountDownloadEnd('OTHER')
                    assert not ib.wrapper._futures['accountValues'].done()
                    ib.wrapper.accountDownloadEnd('TEST')
        ib.client=Client()
        ib.wrapper.updatePortfolio(Contract(conId=12),1,100,100,100,0,0,'TEST')
        result=await ib.reqAccountSnapshotAsync('TEST')
        assert result['portfolio']==[]
        assert [(r.tag,r.value) for r in result['values']]==[('NetLiquidation','1000')]
    api_event_loop.run_until_complete(run())


def test_account_read_timeout_does_not_return_partial_rows(api_event_loop):
    async def run():
        ib=ObservedIB()
        class Client:
            def isConnected(self): return False
            def reqAccountUpdates(self,subscribe,account):
                if subscribe: ib.wrapper.updateAccountValue('NetLiquidation','1000','USD',account)
        ib.client=Client()
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(ib.reqAccountSnapshotAsync('TEST'),0.01)
        assert ib.wrapper.account_read is None
    api_event_loop.run_until_complete(run())


def test_fresh_summary_has_request_scope_and_always_cancels_subscription(api_event_loop):
    async def run():
        ib=ObservedIB();calls=[]
        class Client:
            def isConnected(self): return False
            def getReqId(self): return 90
            def reqAccountSummary(self,req_id,group,tags):
                calls.append(('request',req_id))
                ib.wrapper.accountSummary(89,'TEST','SettledCash','9999','USD')
                ib.wrapper.accountSummary(req_id,'TEST','SettledCash','50','USD')
                ib.wrapper.accountSummaryEnd(req_id)
            def cancelAccountSummary(self,req_id): calls.append(('cancel',req_id))
        ib.client=Client()
        rows=await ib.reqFreshSummaryAsync()
        assert [(r.tag,r.value) for r in rows]==[('SettledCash','50')]
        assert calls==[('request',90),('cancel',90)]
    api_event_loop.run_until_complete(run())
