import time
from threading import Event, get_ident

from src.ibkr_terminal.report_jobs import ReportJobs
from src.ibkr_terminal.reports import LocalReportStore
from test_analytics import NOW, snapshot


def test_report_job_returns_immediately_runs_off_thread_and_publishes(tmp_path):
    reports = LocalReportStore(tmp_path / 'reports', clock=lambda: NOW)
    with ReportJobs(tmp_path / 'jobs.sqlite', reports, clock=lambda: NOW) as jobs:
        started = time.monotonic()
        job = jobs.submit(snapshot())
        assert time.monotonic() - started < 0.1
        done = jobs.wait(job.jobId, timeout=5)
        assert done.state == 'COMPLETED' and done.reportHash
        assert done.workerThreadId != get_ident()
        assert reports.file(done.reportHash, 'pdf', 'paper', 'paper:engineering').is_file()


def test_cancelled_running_job_does_not_publish_a_report(tmp_path):
    entered, release = Event(), Event()

    class SlowStore:
        def create(self, value, *, evidence=None, guard):
            entered.set()
            while not release.wait(0.005):
                guard()

    with ReportJobs(tmp_path / 'jobs.sqlite', SlowStore()) as jobs:
        job = jobs.submit(snapshot())
        assert entered.wait(1)
        jobs.cancel(job.jobId, mode='paper', account_key='paper:engineering')
        done = jobs.wait(job.jobId, timeout=2)
        release.set()
        assert done.state == 'CANCELLED' and done.reportHash is None and done.errorCode == 'JOB_CANCELLED'


def test_restart_interrupts_unfinished_jobs_and_scope_is_enforced(tmp_path):
    path = tmp_path / 'jobs.sqlite'
    reports = LocalReportStore(tmp_path / 'reports', clock=lambda: NOW)
    with ReportJobs(path, reports, clock=lambda: NOW) as jobs:
        done = jobs.wait(jobs.submit(snapshot()).jobId, timeout=5)
        jobs._db.execute('''INSERT INTO terminal_report_jobs
            SELECT 'report-job:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',payload,mode,account_key,snapshot_id,'RUNNING',created_epoch,updated_epoch,test_data,NULL,NULL,NULL
            FROM terminal_report_jobs WHERE job_id=?''', (done.jobId,))
    with ReportJobs(path, reports) as restarted:
        interrupted = restarted.get('report-job:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mode='paper', account_key='paper:engineering')
        assert interrupted.state == 'INTERRUPTED' and interrupted.errorCode == 'PROCESS_RESTARTED'
        try:
            restarted.get(interrupted.jobId, mode='paper', account_key='paper:other')
        except ValueError as error:
            assert str(error) == 'JOB_SCOPE_MISMATCH'
        else:
            raise AssertionError('cross-account report job was visible')
