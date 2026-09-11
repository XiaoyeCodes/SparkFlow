"""Fresh broker account proof releases only ledger-verified order reservations."""
import asyncio
from datetime import datetime,timezone
from decimal import Decimal
from uuid import uuid4
from .broker_views import decimal_text
from .reconcile import AccountProof
from .risk import RiskDenied


def account_checkpoint_stale(ledger,account_key,mode,session_revision,source):
    """Whether the newest durable account proof belongs to another SDK session."""
    with ledger._lock:
        row=ledger._db.execute('SELECT payload FROM order_account_proofs WHERE mode=? AND account_key=? ORDER BY rowid DESC LIMIT 1',
            (mode,account_key)).fetchone()
    if row is None:
        return False
    proof=AccountProof.model_validate_json(row[0])
    return proof.sessionRevision!=session_revision or proof.source!=source


class PaperAccountReconciliation:
    def __init__(self,connection,reconciler,*,clock=None):
        self.connection,self.rec=connection,reconciler
        self.clock=clock or (lambda:datetime.now(timezone.utc))
        self.lock=asyncio.Lock()

    def checkpoint_stale(self):
        c=self.connection
        return account_checkpoint_stale(self.rec.ledger,self.rec.account_key,self.rec.mode,self.rec.revision,
            'fixture' if c._fixture else 'ibkr')

    async def run(self):
        async with self.lock:
            # A fill/status can legitimately arrive while cash and positions are
            # being read. Re-read the complete proof a bounded number of times;
            # never reuse a mixed snapshot and never weaken the event barrier.
            for attempt in range(3):
                try:
                    return await self._run_once()
                except RiskDenied as error:
                    if error.code != 'EVENT_BARRIER_CHANGED' or attempt == 2:
                        raise
                    await asyncio.sleep(0)

    async def _run_once(self):
        c=self.connection
        if (c.binding.accountKey,c.binding.mode,c.session.revision)!=(self.rec.account_key,self.rec.mode,self.rec.revision):
            raise RiskDenied('ACCOUNT_PROOF_SCOPE')
        if not c.healthy() or c.reconciliation_blocked:
            raise RiskDenied('RECONCILIATION_REQUIRED')
        if not await c.reconcile():raise RiskDenied('RECONCILIATION_REQUIRED')
        # reqAllOpenOrders in reconcile() deliberately emits openOrder and
        # orderStatus callbacks. They belong to this proof, so sample the stable
        # event barrier after that refresh, not before it.
        barrier=self.rec.watermark()
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
                with self.rec.ledger.transaction():
                    halt = self.rec.db.execute('SELECT reason FROM order_integrity_halts WHERE mode=? AND account_key=?',
                        (self.rec.mode,self.rec.account_key)).fetchone()
                    if halt and halt[0] == 'SDK_SESSION_CHANGED':
                        from .audit import read_events, append_event
                        read_events(self.rec.db,self.rec.account_key)
                        self.rec.db.execute('DELETE FROM order_integrity_halts WHERE mode=? AND account_key=? AND reason=?',
                            (self.rec.mode,self.rec.account_key,'SDK_SESSION_CHANGED'))
                        append_event(self.rec.db,self.rec.account_key,'EMPTY_SESSION_HALT_RECOVERED',cash_at.isoformat(),
                            {'sessionRevision':self.rec.revision,'snapshotId':snapshot.snapshotId})
                return {'reconciledOrders':0,'detail':'无本系统订单；账户读取完成。'}
        proof=AccountProof(accountKey=snapshot.accountKey,mode=snapshot.mode,sessionRevision=snapshot.sessionRevision,
            source='fixture' if c._fixture else 'ibkr',snapshotId='account-proof:'+uuid4().hex,
            watermark=barrier,cashBalance=values[0],currency='USD',positions=positions,
            cashObservedAt=cash_at,positionsObservedAt=position_at)
        rows=self.rec.reconcile(proof)
        return {'reconciledOrders':len(rows),'proofId':proof.snapshotId,
            'detail':'券商状态、成交、手续费、现金与持仓已核对；预占按核对结果更新。'}
