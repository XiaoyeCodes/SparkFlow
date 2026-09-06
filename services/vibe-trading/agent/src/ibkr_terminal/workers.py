"""Durable bounded jobs for the declarative terminal backtest engine."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from threading import Condition, Event, RLock, get_ident
import time
from typing import Literal
from uuid import uuid4

from pydantic import AwareDatetime

from .backtests import BacktestArchive, BacktestBar, BacktestConfig, BacktestError, BacktestResult, StrategySignal, run_backtest
from .risk import Identifier, canonical
from .schemas import Contract
from .strategy import StrategyRecord


class JobError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class BacktestRequest(Contract):
    strategy: StrategyRecord
    config: BacktestConfig
    bars: tuple[BacktestBar, ...]
    signals: tuple[StrategySignal, ...]


class BacktestJob(Contract):
    jobId: Identifier
    state: Literal['PENDING', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED']
    createdAt: AwareDatetime
    updatedAt: AwareDatetime
    testData: bool
    runHash: str | None = None
    errorCode: str | None = None
    workerThreadId: int | None = None


class BacktestJobs:
    """Runs only the bounded declarative engine; it never imports strategy code."""

    terminal_states = {'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'}

    def __init__(self, path: Path, archive: BacktestArchive, *, max_workers=1, max_input_bytes=4 * 1024 * 1024,
        timeout_seconds=30.0, runner=run_backtest, clock=None):
        if max_workers < 1 or max_workers > 4 or max_input_bytes < 1 or timeout_seconds <= 0:
            raise ValueError('invalid worker limits')
        path.parent.mkdir(parents=True, exist_ok=True)
        self.archive = archive
        self.runner = runner
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.max_input_bytes = max_input_bytes
        self.timeout_seconds = timeout_seconds
        self.callerThreadId = get_ident()
        self._lock = RLock()
        self._condition = Condition(self._lock)
        self._db = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
        self._db.execute('PRAGMA journal_mode=WAL')
        self._db.execute('PRAGMA synchronous=FULL')
        with self.transaction():
            version = self._db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1):
                raise JobError('UNSUPPORTED_JOB_DATABASE')
            self._db.execute('''CREATE TABLE IF NOT EXISTS terminal_backtest_jobs (
                job_id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL,
                created_epoch REAL NOT NULL, updated_epoch REAL NOT NULL, test_data INTEGER NOT NULL,
                run_hash TEXT, error_code TEXT, worker_thread_id INTEGER)''')
            now = self.clock().timestamp()
            self._db.execute("UPDATE terminal_backtest_jobs SET state='INTERRUPTED',updated_epoch=?,error_code='PROCESS_RESTARTED' WHERE state IN ('PENDING','RUNNING','CANCEL_REQUESTED')", (now,))
            self._db.execute('PRAGMA user_version=1')
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix='ibkr-backtest')
        self._active = {}
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
        return BacktestJob(jobId=row[0], state=row[1], createdAt=datetime.fromtimestamp(row[2], timezone.utc),
            updatedAt=datetime.fromtimestamp(row[3], timezone.utc), testData=bool(row[4]), runHash=row[5],
            errorCode=row[6], workerThreadId=row[7])

    def _get_locked(self, job_id):
        row = self._db.execute('SELECT job_id,state,created_epoch,updated_epoch,test_data,run_hash,error_code,worker_thread_id FROM terminal_backtest_jobs WHERE job_id=?', (job_id,)).fetchone()
        if row is None:
            raise JobError('JOB_MISSING')
        return self._decode(row)

    def get(self, job_id):
        with self._lock:
            return self._get_locked(job_id)

    def list(self, limit=50):
        if not 1 <= limit <= 200:
            raise JobError('INVALID_LIMIT')
        with self._lock:
            rows = self._db.execute('''SELECT job_id,state,created_epoch,updated_epoch,test_data,run_hash,error_code,worker_thread_id
                FROM terminal_backtest_jobs ORDER BY created_epoch DESC,job_id LIMIT ?''', (limit,)).fetchall()
            return [self._decode(row) for row in rows]

    def _set(self, job_id, state, *, run_hash=None, error_code=None, worker_thread_id=None):
        with self.transaction():
            current = self._get_locked(job_id)
            if current.state in self.terminal_states:
                return current
            self._db.execute('''UPDATE terminal_backtest_jobs SET state=?,updated_epoch=?,run_hash=?,error_code=?,worker_thread_id=COALESCE(?,worker_thread_id) WHERE job_id=?''',
                (state, self.clock().timestamp(), run_hash, error_code, worker_thread_id, job_id))
            updated = self._get_locked(job_id)
            self._condition.notify_all()
            return updated

    def submit(self, strategy, config, bars, signals):
        if self._closed:
            raise JobError('WORKER_CLOSED')
        request = BacktestRequest(strategy=strategy, config=config, bars=tuple(bars), signals=tuple(signals))
        payload = canonical(request)
        if len(payload.encode('utf-8')) > self.max_input_bytes:
            raise JobError('INPUT_LIMIT_EXCEEDED')
        now = self.clock()
        job_id = f'backtest:{uuid4().hex}'
        test_data = request.strategy.definition.origin == 'fixture' or any(bar.source.startswith('fixture') for bar in request.bars)
        with self.transaction():
            self._db.execute('INSERT INTO terminal_backtest_jobs VALUES(?,?,?,?,?,?,?,?,NULL)',
                (job_id, payload, 'PENDING', now.timestamp(), now.timestamp(), int(test_data), None, None))
        cancelled = Event()
        with self._lock:
            future = self._executor.submit(self._run, job_id, request, cancelled)
            self._active[job_id] = (future, cancelled)
        return self.get(job_id)

    def _run(self, job_id, request, cancelled):
        self._set(job_id, 'RUNNING', worker_thread_id=get_ident())
        deadline = time.monotonic() + self.timeout_seconds

        def guard():
            if cancelled.is_set():
                raise JobError('JOB_CANCELLED')
            if time.monotonic() >= deadline:
                raise JobError('TIME_LIMIT_EXCEEDED')

        try:
            result: BacktestResult = self.runner(request.strategy, request.config, request.bars, request.signals,
                clock=self.clock, guard=guard)
            guard()
            self.archive.save(result, request.strategy, request.config, request.bars, request.signals, guard=guard)
            self._set(job_id, 'COMPLETED', run_hash=result.runHash)
        except JobError as error:
            self._set(job_id, 'CANCELLED' if error.code == 'JOB_CANCELLED' else 'FAILED', error_code=error.code)
        except BacktestError as error:
            self._set(job_id, 'FAILED', error_code=error.code)
        except BaseException:
            self._set(job_id, 'FAILED', error_code='INTERNAL_ERROR')
        finally:
            with self._lock:
                self._active.pop(job_id, None)
                self._condition.notify_all()

    def cancel(self, job_id):
        with self._lock:
            job = self._get_locked(job_id)
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
