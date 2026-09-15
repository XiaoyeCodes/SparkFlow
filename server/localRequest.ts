import type { IncomingHttpHeaders } from 'node:http';

export function allowedLocalRequest(headers: IncomingHttpHeaders, port: number) {
  const host = `127.0.0.1:${port}`;
  return headers.host === host && (!headers.origin || headers.origin === `http://${host}`) && headers['sec-fetch-site'] !== 'cross-site';
}

/** Public, read-only endpoints may be served behind a reverse proxy or CDN.
 * Browser requests still have to be same-origin; server/CDN requests commonly
 * omit Origin and Sec-Fetch-* and are safe for allowlisted GET handlers.
 */
export function allowedPublicReadRequest(headers: IncomingHttpHeaders) {
  if (headers['sec-fetch-site'] === 'cross-site') return false;
  if (!headers.origin) return true;
  const forwardedHost = String(headers['x-forwarded-host'] || '').split(',')[0].trim();
  const requestHost = forwardedHost || headers.host || '';
  try {
    const origin = new URL(headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === requestHost;
  } catch { return false; }
}
