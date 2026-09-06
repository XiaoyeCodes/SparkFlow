"""Durable background report jobs isolated from all order execution paths."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import json
import sqlite3
from threading import Condition, Event, RLock, get_ident
import time
from typing import Literal
from uuid import uuid4

from pydantic import AwareDatetime

from .reports import LocalReportStore, ReportError, ReportEvidenceBundle
from .risk import Identifier
from .schemas import Contract, Snapshot


class ReportJobError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class ReportJob(Contract):
    jobId: Identifier
    mode: Literal['paper', 'live']
    accountKey: str
    snapshotId: str
    state: Literal['PENDING', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED']
    createdAt: AwareDatetime
    updatedAt: AwareDatetime
    testData: bool
    reportHash: str | None = None
    errorCode: str | None = None
    workerThreadId: int | None = None


class ReportJobs:
    terminal_states = {'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'}

    def __init__(self, path: Path, reports: LocalReportStore, *, max_workers=1, timeout_seconds=30.0, clock=None):
        if max_workers < 1 or max_workers > 2 or timeout_seconds <= 0:
            raise ValueError('invalid report worker limits')
        path.parent.mkdir(parents=True, exist_ok=True)
        self.reports = reports
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.timeout_seconds = timeout_seconds
        self._lock = RLock()
        self._condition = Condition(self._lock)
        self._db = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
        self._db.execute('PRAGMA journal_mode=WAL')
        self._db.execute('PRAGMA synchronous=FULL')
        with self.transaction():
            version = self._db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1):
                raise ReportJobError('UNSUPPORTED_REPORT_JOB_DATABASE')
            self._db.execute('''CREATE TABLE IF NOT EXISTS terminal_report_jobs (
                job_id TEXT PRIMARY KEY,payload TEXT NOT NULL,mode TEXT NOT NULL,account_key TEXT NOT NULL,snapshot_id TEXT NOT NULL,
                state TEXT NOT NULL,created_epoch REAL NOT NULL,updated_epoch REAL NOT NULL,test_data INTEGER NOT NULL,
                report_hash TEXT,error_code TEXT,worker_thread_id INTEGER)''')
            self._db.execute("UPDATE terminal_report_jobs SET state='INTERRUPTED',updated_epoch=?,error_code='PROCESS_RESTARTED' WHERE state IN ('PENDING','RUNNING','CANCEL_REQUESTED')", (self.clock().timestamp(),))
            self._db.execute('PRAGMA user_version=1')
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix='ibkr-report')
        self._active: dict[str, tuple[object, Event]] = {}
        self._closed = False

    @contextmanager
    def transaction(self):
        with self._lock:
            self._db.execute('BEGIN IMMEDIATE')
            try:
                yield
            except BaseException:
                self._db.rollback()
                raise
            else:
                self._db.commit()

    @staticmethod
    def _decode(row):
        return ReportJob(jobId=row[0], mode=row[1], accountKey=row[2], snapshotId=row[3], state=row[4],
            createdAt=datetime.fromtimestamp(row[5], timezone.utc), updatedAt=datetime.fromtimestamp(row[6], timezone.utc),
            testData=bool(row[7]), reportHash=row[8], errorCode=row[9], workerThreadId=row[10])

    def _get_locked(self, job_id):
        row = self._db.execute('''SELECT job_id,mode,account_key,snapshot_id,state,created_epoch,updated_epoch,test_data,report_hash,error_code,worker_thread_id
            FROM terminal_report_jobs WHERE job_id=?''', (job_id,)).fetchone()
        if row is None:
            raise ReportJobError('JOB_MISSING')
        return self._decode(row)

    @staticmethod
    def _scope(job, mode, account_key):
        if job.mode != mode or job.accountKey != account_key:
            raise ReportJobError('JOB_SCOPE_MISMATCH')
        return job

    def get(self, job_id, *, mode, account_key):
        with self._lock:
            return self._scope(self._get_locked(job_id), mode, account_key)

    def list(self, mode, account_key, limit=50):
        if not 1 <= limit <= 200:
            raise ReportJobError('INVALID_LIMIT')
        with self._lock:
            rows = self._db.execute('''SELECT job_id,mode,account_key,snapshot_id,state,created_epoch,updated_epoch,test_data,report_hash,error_code,worker_thread_id
                FROM terminal_report_jobs WHERE mode=? AND account_key=? ORDER BY created_epoch DESC,job_id LIMIT ?''', (mode, account_key, limit)).fetchall()
            return [self._decode(row) for row in rows]

    def _set(self, job_id, state, *, report_hash=None, error_code=None, worker_thread_id=None):
        with self.transaction():
            current = self._get_locked(job_id)
            if current.state in self.terminal_states:
                return current
            self._db.execute('''UPDATE terminal_report_jobs SET state=?,updated_epoch=?,report_hash=?,error_code=?,worker_thread_id=COALESCE(?,worker_thread_id) WHERE job_id=?''',
                (state, self.clock().timestamp(), report_hash, error_code, worker_thread_id, job_id))
            updated = self._get_locked(job_id)
            self._condition.notify_all()
            return updated

    def submit(self, snapshot: Snapshot, evidence: ReportEvidenceBundle | None = None):
        if self._closed:
            raise ReportJobError('WORKER_CLOSED')
        snapshot = Snapshot.model_validate(snapshot.model_dump())
        evidence = ReportEvidenceBundle.model_validate(evidence.model_dump()) if evidence is not None else None
        now = self.clock()
        job_id = f'report-job:{uuid4().hex}'
        payload = json.dumps({'snapshot': snapshot.model_dump(mode='json'),
            'evidence': evidence.model_dump(mode='json') if evidence is not None else None}, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        with self.transaction():
            self._db.execute('INSERT INTO terminal_report_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)',
                (job_id, payload, snapshot.mode, snapshot.accountKey, snapshot.snapshotId,
                    'PENDING', now.timestamp(), now.timestamp(), int(snapshot.testData), None, None))
        cancelled = Event()
        with self._lock:
            future = self._executor.submit(self._run, job_id, snapshot, evidence, cancelled)
            self._active[job_id] = (future, cancelled)
        return self.get(job_id, mode=snapshot.mode, account_key=snapshot.accountKey)

    def _run(self, job_id, snapshot, evidence, cancelled):
        self._set(job_id, 'RUNNING', worker_thread_id=get_ident())
        deadline = time.monotonic() + self.timeout_seconds

        def guard():
            if cancelled.is_set():
                raise ReportJobError('JOB_CANCELLED')
            if time.monotonic() >= deadline:
                raise ReportJobError('TIME_LIMIT_EXCEEDED')

        try:
            report = self.reports.create(snapshot, evidence=evidence, guard=guard)
            guard()
            self._set(job_id, 'COMPLETED', report_hash=report.reportHash)
        except ReportJobError as error:
            self._set(job_id, 'CANCELLED' if error.code == 'JOB_CANCELLED' else 'FAILED', error_code=error.code)
        except ReportError as error:
            self._set(job_id, 'FAILED', error_code=error.code)
        except BaseException:
            self._set(job_id, 'FAILED', error_code='INTERNAL_ERROR')
        finally:
            with self._lock:
                self._active.pop(job_id, None)
                self._condition.notify_all()

    def cancel(self, job_id, *, mode, account_key):
        with self._lock:
            job = self._scope(self._get_locked(job_id), mode, account_key)
            if job.state in self.terminal_states:
                return job
            active = self._active.get(job_id)
            if active:
                future, cancelled = active
                cancelled.set()
                if future.cancel():
                    return self._set(job_id, 'CANCELLED', error_code='JOB_CANCELLED')
            return self._set(job_id, 'CANCEL_REQUESTED', error_code='JOB_CANCELLED')

    def wait(self, job_id, timeout=None):
        deadline = None if timeout is None else time.monotonic() + timeout
        with self._condition:
            while True:
                job = self._get_locked(job_id)
                if job.state in self.terminal_states:
                    return job
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    raise TimeoutError(job_id)
                self._condition.wait(remaining)

    def close(self):
        if self._closed:
            return
        self._closed = True
        with self._lock:
            for _, cancelled in self._active.values():
                cancelled.set()
        self._executor.shutdown(wait=True, cancel_futures=True)
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
