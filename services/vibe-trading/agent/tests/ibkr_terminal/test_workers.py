import time
from threading import Event

import pytest

from src.ibkr_terminal.backtests import BacktestArchive, run_backtest
from src.ibkr_terminal.workers import BacktestJobs, JobError
from test_backtest_archive import package
from test_backtests import NOW


def test_job_returns_immediately_runs_off_thread_and_archives_result(tmp_path):
    item, settings, bars, signals, result = package(tmp_path)
    with BacktestArchive(tmp_path / 'archive.sqlite') as archive, BacktestJobs(tmp_path / 'jobs.sqlite', archive, clock=lambda: NOW) as jobs:
        started = time.monotonic()
        job = jobs.submit(item, settings, bars, signals)
        assert time.monotonic() - started < 0.1
        done = jobs.wait(job.jobId, timeout=2)
        assert done.state == 'COMPLETED' and done.runHash == result.runHash
        assert archive.get(done.runHash).result == result
        assert done.workerThreadId != jobs.callerThreadId


def test_running_job_can_be_cancelled_without_publishing_a_partial_run(tmp_path):
    item, settings, bars, signals, _ = package(tmp_path)
    entered = Event()

    def slow(strategy, config, bars, signals, *, clock, guard):
        entered.set()
        while True:
            guard()
            time.sleep(0.005)

    with BacktestArchive(tmp_path / 'archive.sqlite') as archive, BacktestJobs(tmp_path / 'jobs.sqlite', archive, runner=slow) as jobs:
        job = jobs.submit(item, settings, bars, signals)
        assert entered.wait(1)
        jobs.cancel(job.jobId)
        assert jobs.wait(job.jobId, timeout=2).state == 'CANCELLED'
        assert archive.list() == []


def test_time_and_input_limits_fail_closed_with_stable_codes(tmp_path):
    item, settings, bars, signals, _ = package(tmp_path)

    def over_time(strategy, config, bars, signals, *, clock, guard):
        while True:
            guard()
            time.sleep(0.005)

    with BacktestArchive(tmp_path / 'archive.sqlite') as archive, BacktestJobs(tmp_path / 'jobs.sqlite', archive, runner=over_time, timeout_seconds=0.02) as jobs:
        failed = jobs.wait(jobs.submit(item, settings, bars, signals).jobId, timeout=2)
        assert failed.state == 'FAILED' and failed.errorCode == 'TIME_LIMIT_EXCEEDED'
    with BacktestArchive(tmp_path / 'other-archive.sqlite') as archive, BacktestJobs(tmp_path / 'small.sqlite', archive, max_input_bytes=64) as jobs:
        with pytest.raises(JobError, match='INPUT_LIMIT_EXCEEDED'):
            jobs.submit(item, settings, bars, signals)


def test_restart_marks_unfinished_rows_interrupted_instead_of_replaying(tmp_path):
    path = tmp_path / 'jobs.sqlite'
    item, settings, bars, signals, _ = package(tmp_path)
    with BacktestArchive(tmp_path / 'archive.sqlite') as archive, BacktestJobs(path, archive, clock=lambda: NOW) as jobs:
        completed = jobs.wait(jobs.submit(item, settings, bars, signals).jobId, timeout=2)
        jobs._db.execute('''INSERT INTO terminal_backtest_jobs
            SELECT 'unfinished',payload,'RUNNING',created_epoch,updated_epoch,test_data,NULL,NULL,NULL
            FROM terminal_backtest_jobs WHERE job_id=?''', (completed.jobId,))
    with BacktestArchive(tmp_path / 'archive.sqlite') as archive, BacktestJobs(path, archive) as restarted:
        job = restarted.get('unfinished')
        assert job.state == 'INTERRUPTED' and job.errorCode == 'PROCESS_RESTARTED'
        assert len(archive.list()) == 1
