import type { IncomingHttpHeaders } from 'node:http';

export function allowedLocalRequest(headers: IncomingHttpHeaders, port: number) {
  const host = `127.0.0.1:${port}`;
  return headers.host === host && (!headers.origin || headers.origin === `http://${host}`) && headers['sec-fetch-site'] !== 'cross-site';
}
