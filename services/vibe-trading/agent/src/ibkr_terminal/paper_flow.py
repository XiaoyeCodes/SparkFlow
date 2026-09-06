"""Manual paper confirmation -> durable risk claim -> native SDK hand-off."""
from datetime import datetime,timedelta,timezone
import hashlib
from uuid import uuid4
from .identity import SubmissionCommand
from .native_dispatch import DispatchPermit,binding_hash,command_hash
from .reviews import OrderReviewService,StoredPreview
from .risk import RiskDenied,canonical


class PaperOrderFlow:
    def __init__(self,dispatcher,source,*,enabled=False,clock=None):
        self.dispatcher,self.source=dispatcher,source
        self.ledger=dispatcher.ledger
        self.enabled=enabled
        self.clock=clock or (lambda:datetime.now(timezone.utc))
        self.reviews=OrderReviewService(self.ledger,source,clock=self.clock,ttl_seconds=30,refresh_risk_on_confirm=True,broker_submission=True)

    def _scope(self,account,mode):
        if self.enabled is not True:
            raise RiskDenied('PAPER_EXECUTION_DISABLED')
        binding=self.dispatcher.binding
        if mode!='paper' or binding.mode!='paper' or account!=binding.accountKey:
            raise RiskDenied('PAPER_ACCOUNT_SCOPE')

    async def preview(self,draft):
        self._scope(draft.accountKey,draft.mode)
        await self.source.prepare(draft)
        self._scope(draft.accountKey,draft.mode)
        return self.reviews.preview(draft)

    def _permit(self,command,source,*,purpose,grant=None):
        now=self.clock()
        binding=self.dispatcher.binding
        return DispatchPermit(permitId='manual-dispatch:'+uuid4().hex,commandHash=command_hash(command),
            bindingHash=binding_hash(binding),channelKey=self.dispatcher.channel_key,accountKey=binding.accountKey,
            mode='paper',sessionRevision=self.dispatcher.current_revision(),source=source,purpose=purpose,
            authorizationHash=hashlib.sha256(canonical(grant).encode()).hexdigest() if grant else None,
            issuedAt=now,expiresAt=min(grant.expiresAt,now+timedelta(seconds=10)) if grant else now+timedelta(seconds=10),
            consentReference='manual-confirmation:'+command_hash(command))

    def confirm(self,preview_id,body_hash,*,explicit):
        if explicit is not True:
            raise RiskDenied('EXPLICIT_CONFIRMATION_REQUIRED')
        stored=self.ledger.load_preview(preview_id)
        if stored is None or stored[2]!=body_hash:
            raise RiskDenied('PREVIEW_BODY_CHANGED')
        data=StoredPreview.model_validate_json(stored[3])
        self._scope(data.draft.accountKey,data.draft.mode)
        # A retry after hand-off reads the original record; it cannot create
        # another authorization, command, or permit (even after preview expiry).
        if stored[5]:
            row=self.ledger.get(data.draft.accountKey,data.draft.mode,stored[5])
            if row is not None:
                return row
        self.dispatcher.session()  # fail before reserving if disconnected/queued
        row=self.reviews.confirm(preview_id,body_hash,explicit=True)
        context=self.source.load(data.draft).context
        row,claimed=self.ledger.claim_submission(row.intent.accountKey,'paper',row.intent.clientIntentId,
            context,channel=self.dispatcher.session())
        if not claimed:
            return row
        command=SubmissionCommand(intent=row.intent,identity=row.identity)
        try:
            grant=self.ledger._grant(row.intent)
            permit=self._permit(command,row.source,purpose='submit',grant=grant)
            self.dispatcher.record_permit(permit)
            self.dispatcher.dispatch(command,permit.permitId,instrument=self.source.instrument,context=context)
        except BaseException as error:
            self.ledger.finish_submission(row.intent.accountKey,'paper',row.intent.clientIntentId,
                reason=error.code if isinstance(error,RiskDenied) else type(error).__name__)
            raise
        return self.ledger.get(row.intent.accountKey,'paper',row.intent.clientIntentId)

    def cancel(self,intent_id,body_hash,*,explicit):
        if explicit is not True:
            raise RiskDenied('EXPLICIT_CONFIRMATION_REQUIRED')
        binding=self.dispatcher.binding
        if binding.mode!='paper':
            raise RiskDenied('PAPER_ACCOUNT_SCOPE')
        row=self.ledger.get(binding.accountKey,'paper',intent_id)
        if row is None or row.bodyHash!=body_hash:
            raise RiskDenied('ORDER_IDENTITY_REQUIRED')
        row,command,claimed=self.ledger.claim_cancel(binding.accountKey,'paper',intent_id,
            'manual-cancel:'+body_hash,self.dispatcher.session())
        if claimed:
            try:
                permit=self._permit(command,row.source,purpose='cancel')
                self.dispatcher.record_permit(permit)
                self.dispatcher.cancel(command,permit.permitId)
            except BaseException as error:
                self.ledger.finish_cancel(binding.accountKey,'paper',intent_id,error=type(error).__name__)
                raise
        return self.ledger.get(binding.accountKey,'paper',intent_id)

    def close(self):
        self.enabled=False
        self.dispatcher.close()
        self.source.close()
