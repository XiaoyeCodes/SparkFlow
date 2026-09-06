import type { AccountMode, Snapshot } from './types';

export type RiskMetric = { value: string | null; unit: string; state: 'ready' | 'stale' | 'missing' | 'unavailable'; evidence: unknown[] };
export type RiskAnalysis = {
  accountKey: string; mode: AccountMode; snapshotId: string; testData: boolean; status: 'ready' | 'partial' | 'stale' | 'unavailable';
  metrics: { grossExposure: RiskMetric; netExposure: RiskMetric; largestPositionWeight: RiskMetric; marginUsage: RiskMetric };
  findings: { code: string; severity: string; explanation: string }[];
};
export type AiStatus = { sharingEnabled: boolean; activeGrant: null | { grantId: string; provider: string; model: string; fields: string[]; expiresAt: string; requestsRemaining: number }; modelCalls: false };
export type ReportMetadata = { reportHash: string; snapshotHash: string; snapshotId: string; accountKey: string; mode: AccountMode; generatedAt: string; status: string; testData: boolean; formats: ('json' | 'markdown' | 'html' | 'pdf')[] };
export type ReportJob = { jobId: string; accountKey: string; mode: AccountMode; snapshotId: string; state: 'PENDING' | 'RUNNING' | 'CANCEL_REQUESTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED'; createdAt: string; updatedAt: string; testData: boolean; reportHash: string | null; errorCode: string | null; workerThreadId: number | null };
export type ReportEvidenceBundle = { generatedAt: string; items: unknown[]; gaps: string[] };

const scope = (snapshot: Snapshot) => `mode=${snapshot.mode}&accountKey=${encodeURIComponent(snapshot.accountKey)}`;
async function json<T>(input: string, init: RequestInit & { signal: AbortSignal }): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || '本地分析服务不可用。');
  return response.json() as Promise<T>;
}

export async function loadAccountInsights(snapshot: Snapshot, signal: AbortSignal) {
  const query = scope(snapshot);
  const [risk, ai, reports] = await Promise.all([
    json<RiskAnalysis>(`/api/ibkr-terminal/analysis/risk?${query}`, { signal }),
    json<AiStatus>(`/api/ibkr-terminal/ai/status?${query}`, { signal }),
    json<ReportMetadata[]>(`/api/ibkr-terminal/reports?${query}`, { signal }),
  ]);
  if (risk.accountKey !== snapshot.accountKey || risk.mode !== snapshot.mode || risk.snapshotId !== snapshot.snapshotId) throw new Error('风险分析账户或快照身份不匹配。');
  if (reports.some(report => report.accountKey !== snapshot.accountKey || report.mode !== snapshot.mode)) throw new Error('报告列表账户身份不匹配。');
  return { risk, ai, reports };
}

export async function createLocalReport(snapshot: Snapshot, signal: AbortSignal, evidence?: ReportEvidenceBundle) {
  const report = await json<ReportMetadata>('/api/ibkr-terminal/reports', { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: snapshot.mode, accountKey: snapshot.accountKey, evidence }) });
  if (report.accountKey !== snapshot.accountKey || report.mode !== snapshot.mode || report.snapshotId !== snapshot.snapshotId) throw new Error('报告账户或快照身份不匹配。');
  return report;
}

function validReportJob(value: ReportJob, snapshot: Snapshot) {
  return /^report-job:[0-9a-f]{32}$/.test(value.jobId) && value.accountKey === snapshot.accountKey && value.mode === snapshot.mode
    && value.snapshotId === snapshot.snapshotId && ['PENDING', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(value.state)
    && (value.reportHash === null || /^[0-9a-f]{64}$/.test(value.reportHash));
}

export async function createReportJob(snapshot: Snapshot, signal: AbortSignal, evidence?: ReportEvidenceBundle) {
  const job = await json<ReportJob>('/api/ibkr-terminal/reports/jobs', { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: snapshot.mode, accountKey: snapshot.accountKey, evidence }) });
  if (!validReportJob(job, snapshot)) throw new Error('报告任务账户或快照身份不匹配。');
  return job;
}

export async function getReportJob(snapshot: Snapshot, jobId: string, signal: AbortSignal) {
  const job = await json<ReportJob>(`/api/ibkr-terminal/reports/jobs/${encodeURIComponent(jobId)}?${scope(snapshot)}`, { signal });
  if (!validReportJob(job, snapshot) || job.jobId !== jobId) throw new Error('报告任务账户或身份不匹配。');
  return job;
}

export async function cancelReportJob(snapshot: Snapshot, jobId: string, signal: AbortSignal) {
  const job = await json<ReportJob>(`/api/ibkr-terminal/reports/jobs/${encodeURIComponent(jobId)}/cancel`, { signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: snapshot.mode, accountKey: snapshot.accountKey }) });
  if (!validReportJob(job, snapshot) || job.jobId !== jobId) throw new Error('报告任务账户或身份不匹配。');
  return job;
}

export async function loadReports(snapshot: Snapshot, signal: AbortSignal) {
  const reports = await json<ReportMetadata[]>(`/api/ibkr-terminal/reports?${scope(snapshot)}`, { signal });
  if (reports.some(report => report.accountKey !== snapshot.accountKey || report.mode !== snapshot.mode)) throw new Error('报告列表账户身份不匹配。');
  return reports;
}

export function reportUrl(report: ReportMetadata, kind: ReportMetadata['formats'][number]) {
  return `/api/ibkr-terminal/reports/${report.reportHash}/${kind}?mode=${report.mode}&accountKey=${encodeURIComponent(report.accountKey)}`;
}
