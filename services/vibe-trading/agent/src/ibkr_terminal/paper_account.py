"""Fresh broker account proof releases only ledger-verified order reservations."""
import asyncio
from datetime import datetime,timezone
from decimal import Decimal
from uuid import uuid4
from .broker_views import decimal_text
from .reconcile import AccountProof
from .risk import RiskDenied


class PaperAccountReconciliation:
    def __init__(self,connection,reconciler,*,clock=None):
        self.connection,self.rec=connection,reconciler
        self.clock=clock or (lambda:datetime.now(timezone.utc))
        self.lock=asyncio.Lock()

    async def run(self):
        async with self.lock:
            c=self.connection
            if (c.binding.accountKey,c.binding.mode,c.session.revision)!=(self.rec.account_key,self.rec.mode,self.rec.revision):
                raise RiskDenied('ACCOUNT_PROOF_SCOPE')
            if not c.healthy() or c.reconciliation_blocked:
                raise RiskDenied('RECONCILIATION_REQUIRED')
            barrier=self.rec.watermark()
            if not await c.reconcile():raise RiskDenied('RECONCILIATION_REQUIRED')
            raw=await asyncio.wait_for(c._ib.reqAccountSnapshotAsync(c.binding.brokerAccount),4)
            portfolio_at=self.clock()
            summary=await asyncio.wait_for(c._ib.reqFreshSummaryAsync(),4)
            cash_at=self.clock()
            snapshot=c.session.snapshot()
            if not c.healthy() or snapshot.sessionRevision!=self.rec.revision or snapshot.state not in ('ready','empty') or snapshot.baseCurrency!='USD':
                raise RiskDenied('RECONCILIATION_REQUIRED')
            values=[decimal_text(row.value) for row in summary if row.account==c.binding.brokerAccount and row.tag=='TotalCashValue' and row.currency=='USD']
            if len(values)!=1 or values[0] is None or Decimal(values[0])<0:
                raise RiskDenied('MISSING_ACCOUNT_DATA')
            positions={}
            for row in raw['portfolio']:
                if row.account!=c.binding.brokerAccount:continue
                quantity=decimal_text(row.position)
                if row.contract.currency!='USD' or quantity is None or Decimal(quantity)<0 or row.contract.conId in positions:
                    raise RiskDenied('INCOMPLETE_HOLDINGS')
                positions[row.contract.conId]=quantity
            actual={row.conId:Decimal(row.quantity) for row in snapshot.positions if Decimal(row.quantity)}
            if {key:Decimal(value) for key,value in positions.items() if Decimal(value)}!=actual:
                raise RiskDenied('POSITION_MISMATCH')
            stamp=snapshot.provenance['positions'].requestCompletedAt
            if stamp is None:raise RiskDenied('RECONCILIATION_REQUIRED')
            position_at=min(portfolio_at,datetime.fromisoformat(stamp))
            if (cash_at-position_at).total_seconds()>30:
                raise RiskDenied('STALE_ACCOUNT_PROOF')
            with self.rec.ledger._lock:
                if not self.rec.ledger._records(self.rec.account_key,self.rec.mode):
                    return {'reconciledOrders':0,'detail':'无本系统订单；账户读取完成。'}
            proof=AccountProof(accountKey=snapshot.accountKey,mode=snapshot.mode,sessionRevision=snapshot.sessionRevision,
                source='fixture' if c._fixture else 'ibkr',snapshotId='account-proof:'+uuid4().hex,
                watermark=barrier,cashBalance=values[0],currency='USD',positions=positions,
                cashObservedAt=cash_at,positionsObservedAt=position_at)
            rows=self.rec.reconcile(proof)
            return {'reconciledOrders':len(rows),'proofId':proof.snapshotId,
                'detail':'券商状态、成交、手续费、现金与持仓已核对；预占按核对结果更新。'}
