const reportFile = /^\/api\/ibkr-terminal\/reports\/[0-9a-f]{64}\/(?:json|markdown|html|pdf)$/;
const reportJob = /^\/api\/ibkr-terminal\/reports\/jobs\/report-job(?:%3A|:)[0-9a-f]{32}$/i;
const reportJobCancel = /^\/api\/ibkr-terminal\/reports\/jobs\/report-job(?:%3A|:)[0-9a-f]{32}\/cancel$/i;

/** Local report generation and hash-scoped downloads; no external publication. */
export function allowedIbkrAccountReportRequest(method: string | undefined, pathname: string) {
  if (pathname === '/api/ibkr-terminal/reports') return method === 'GET' || method === 'POST';
  if (pathname === '/api/ibkr-terminal/reports/jobs') return method === 'GET' || method === 'POST';
  if (reportJob.test(pathname)) return method === 'GET';
  if (reportJobCancel.test(pathname)) return method === 'POST';
  return method === 'GET' && reportFile.test(pathname);
}
