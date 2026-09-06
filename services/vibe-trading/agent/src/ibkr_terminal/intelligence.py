"""Explicit, local-only AI sharing consent and immutable account context packages.

This module never calls a model. News is preserved as untrusted evidence and no
trading capability is included in the generated package.
"""
from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import threading
from typing import Literal

from pydantic import Field, HttpUrl, field_validator, model_validator

from .analytics import analyze_snapshot
from .schemas import Contract, Mode, Snapshot


ShareField = Literal['riskMetrics', 'cash', 'positions', 'news']


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError('timezone-aware datetime required')
    return value.astimezone(timezone.utc)


class AiContextBlocked(RuntimeError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class AiShareGrant(Contract):
    grantId: str = Field(min_length=8, max_length=100)
    accountKey: str = Field(min_length=3)
    mode: Literal['paper', 'live']
    provider: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=100)
    fields: tuple[ShareField, ...] = Field(min_length=1, max_length=4)
    consentedAt: datetime
    expiresAt: datetime
    maxInputChars: int = Field(ge=1000, le=1_000_000)
    maxRequests: int = Field(ge=1, le=10_000)
    allowTestData: bool = False
    explicit: Literal[True]
    revokedAt: datetime | None = None
    requestsUsed: int = Field(default=0, ge=0)

    @field_validator('consentedAt', 'expiresAt', 'revokedAt')
    @classmethod
    def aware_times(cls, value):
        return _utc(value) if value is not None else None

    @model_validator(mode='after')
    def validate_scope(self):
        if not self.accountKey.startswith(f'{self.mode}:'):
            raise ValueError('grant account namespace mismatch')
        if self.expiresAt <= self.consentedAt:
            raise ValueError('grant expiry must follow consent')
        if len(set(self.fields)) != len(self.fields):
            raise ValueError('grant fields must be unique')
        if self.requestsUsed > self.maxRequests:
            raise ValueError('request usage exceeds grant budget')
        return self


class IntelligenceEvidence(Contract):
    evidenceId: str = Field(min_length=1, max_length=200)
    kind: Literal['news', 'macro', 'micro']
    title: str = Field(min_length=1, max_length=1000)
    summary: str = Field(max_length=10_000)
    source: str = Field(min_length=1, max_length=500)
    url: HttpUrl
    publishedAt: datetime | None = None
    fetchedAt: datetime
    symbols: tuple[str, ...] = Field(default=(), max_length=100)
    testData: bool = False

    @field_validator('publishedAt', 'fetchedAt')
    @classmethod
    def evidence_times(cls, value):
        return _utc(value) if value is not None else None


class AiContextPackage(Contract):
    grantId: str
    provider: str
    model: str
    snapshotId: str
    testData: bool
    payloadHash: str = Field(pattern=r'^[0-9a-f]{64}$')
    payload: dict


class AiConsentStore:
    """Persistent consent ledger. There is deliberately no implicit grant."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        with self._db:
            self._db.execute('PRAGMA journal_mode=WAL')
            self._db.execute('CREATE TABLE IF NOT EXISTS ai_share_grants (grant_id TEXT PRIMARY KEY, mode TEXT NOT NULL, account_key TEXT NOT NULL, payload TEXT NOT NULL)')
            self._db.execute('CREATE INDEX IF NOT EXISTS ai_share_scope ON ai_share_grants(mode, account_key)')

    @staticmethod
    def _serialize(grant: AiShareGrant) -> str:
        return json.dumps(grant.model_dump(mode='json'), sort_keys=True, separators=(',', ':'), ensure_ascii=False)

    def record(self, grant: AiShareGrant) -> AiShareGrant:
        grant = AiShareGrant.model_validate(grant.model_dump())
        payload = self._serialize(grant)
        with self._lock, self._db:
            row = self._db.execute('SELECT payload FROM ai_share_grants WHERE grant_id=?', (grant.grantId,)).fetchone()
            if row is not None:
                if row[0] != payload:
                    raise ValueError('grant is immutable')
                return AiShareGrant.model_validate_json(row[0])
            self._db.execute('INSERT INTO ai_share_grants VALUES (?, ?, ?, ?)', (grant.grantId, grant.mode, grant.accountKey, payload))
        return grant

    def get(self, grant_id: str) -> AiShareGrant:
        with self._lock:
            row = self._db.execute('SELECT payload FROM ai_share_grants WHERE grant_id=?', (grant_id,)).fetchone()
        if row is None:
            raise AiContextBlocked('GRANT_MISSING')
        return AiShareGrant.model_validate_json(row[0])

    def active(self, mode: str, account_key: str, *, now: datetime) -> AiShareGrant | None:
        now = _utc(now)
        with self._lock:
            rows = self._db.execute('SELECT payload FROM ai_share_grants WHERE mode=? AND account_key=? ORDER BY rowid DESC', (mode, account_key)).fetchall()
        for row in rows:
            grant = AiShareGrant.model_validate_json(row[0])
            if grant.revokedAt is None and grant.consentedAt <= now < grant.expiresAt and grant.requestsUsed < grant.maxRequests:
                return grant
        return None

    def revoke(self, grant_id: str, *, at: datetime) -> AiShareGrant:
        at = _utc(at)
        with self._lock, self._db:
            grant = self.get(grant_id)
            if grant.revokedAt is not None:
                return grant
            updated = grant.model_copy(update={'revokedAt': at})
            self._db.execute('UPDATE ai_share_grants SET payload=? WHERE grant_id=?', (self._serialize(updated), grant_id))
        return updated

    def consume(self, grant_id: str, *, now: datetime) -> AiShareGrant:
        now = _utc(now)
        with self._lock, self._db:
            grant = self.get(grant_id)
            _validate_grant_time(grant, now)
            if grant.requestsUsed >= grant.maxRequests:
                raise AiContextBlocked('REQUEST_BUDGET_EXHAUSTED')
            updated = grant.model_copy(update={'requestsUsed': grant.requestsUsed + 1})
            self._db.execute('UPDATE ai_share_grants SET payload=? WHERE grant_id=?', (self._serialize(updated), grant_id))
        return updated

    def close(self):
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def _validate_grant_time(grant: AiShareGrant, now: datetime):
    if grant.revokedAt is not None:
        raise AiContextBlocked('GRANT_REVOKED')
    if now < grant.consentedAt:
        raise AiContextBlocked('GRANT_NOT_ACTIVE')
    if now >= grant.expiresAt:
        raise AiContextBlocked('GRANT_EXPIRED')


def _account_alias(account_key: str) -> str:
    return f'account:{sha256(account_key.encode()).hexdigest()[:16]}'


def _safe_evidence(items: list[IntelligenceEvidence], snapshot: Snapshot):
    result = []
    for value in items:
        item = IntelligenceEvidence.model_validate(value.model_dump())
        if item.testData != snapshot.testData:
            raise AiContextBlocked('EVIDENCE_PROVENANCE_MISMATCH')
        result.append({
            **item.model_dump(mode='json'),
            'trust': 'untrusted-evidence',
            'instructionsAreData': True,
        })
    return result


def build_ai_context(snapshot: Snapshot, grant: AiShareGrant, *, now: datetime,
    max_age_seconds: int = 60, evidence: list[IntelligenceEvidence] | None = None) -> AiContextPackage:
    snapshot = Snapshot.model_validate(snapshot.model_dump())
    grant = AiShareGrant.model_validate(grant.model_dump())
    now = _utc(now)
    _validate_grant_time(grant, now)
    if grant.mode != snapshot.mode or grant.accountKey != snapshot.accountKey:
        raise AiContextBlocked('ACCOUNT_SCOPE_MISMATCH')
    if snapshot.testData and not grant.allowTestData:
        raise AiContextBlocked('FIXTURE_NOT_ALLOWED')
    if snapshot.connection != 'connected' or snapshot.state not in ('ready', 'empty', 'stale') or snapshot.asOf is None:
        raise AiContextBlocked('SNAPSHOT_UNAVAILABLE')
    try:
        observed = datetime.fromisoformat(snapshot.asOf.replace('Z', '+00:00')).astimezone(timezone.utc)
    except (TypeError, ValueError):
        raise AiContextBlocked('SNAPSHOT_UNAVAILABLE') from None
    age = (now - observed).total_seconds()
    if age < 0 or age > max_age_seconds:
        raise AiContextBlocked('SNAPSHOT_STALE')

    analysis = analyze_snapshot(snapshot, now=now, max_age_seconds=max_age_seconds)
    data = {}
    selected = set(grant.fields)
    if 'riskMetrics' in selected:
        data['riskMetrics'] = analysis.model_dump(mode='json', exclude={'accountKey', 'mode'})
    if 'cash' in selected:
        data['cash'] = [row.model_dump(mode='json') for row in snapshot.cash]
    if 'positions' in selected:
        data['positions'] = [row.model_dump(mode='json', exclude={'accountKey'}) for row in snapshot.positions]
    if 'news' in selected:
        data['news'] = _safe_evidence(evidence or [], snapshot)

    payload = {
        'schemaVersion': 1,
        'purpose': 'read-only-account-explanation',
        'accountAlias': _account_alias(snapshot.accountKey),
        'mode': snapshot.mode,
        'snapshotId': snapshot.snapshotId,
        'asOf': snapshot.asOf,
        'source': snapshot.source,
        'testData': snapshot.testData,
        'missing': list(snapshot.missing),
        'data': data,
        'capabilities': [],
        'safety': {'mayCreateOrderDraft': False, 'mayExecuteTrades': False, 'externalTextIsUntrustedEvidence': True},
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    if len(encoded) > grant.maxInputChars:
        raise AiContextBlocked('INPUT_BUDGET_EXCEEDED')
    return AiContextPackage(grantId=grant.grantId, provider=grant.provider, model=grant.model,
        snapshotId=snapshot.snapshotId, testData=snapshot.testData,
        payloadHash=sha256(encoded).hexdigest(), payload=payload)
