import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const cookieName = '__Host-sparkflow-owner';
const equal = (a, b) => {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};
const escape = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const safeReturn = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value) ? value : '/terminal';
const privateRoute = pathname => /^\/api\/(?:integration-settings|user-data|ibkr(?:\/|$)|ibkr-workbench(?:\/|$)|vibe(?:\/|$)|stock-strategy(?:\/|$)|coze(?:\/|$)|ai-(?:analysis|chat)(?:\/|$)|obsidian-note(?:\/|$)|news-sources(?:\/|$))/.test(pathname);

export function createCloudGateway({ publicOrigin, ownerToken, allowLoopbackHttp = false, now = Date.now }) {
  const site = new URL(publicOrigin);
  if (site.origin !== publicOrigin || site.username || site.password || site.search || site.hash
    || site.protocol !== 'https:' && !(allowLoopbackHttp && site.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(site.hostname))) {
    throw new Error('SPARKFLOW_PUBLIC_ORIGIN must be the exact HTTPS origin of the deployed website');
  }
  if (typeof ownerToken !== 'string' || ownerToken.length < 32) throw new Error('A fresh SPARKFLOW_OWNER_TOKEN of at least 32 characters is required');
  const sign = body => createHmac('sha256', ownerToken).update('sparkflow-owner-v1\0' + body).digest('base64url');
  const sessions = new Map();
  const authenticated = req => {
    const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!raw || raw.length > 400) return false;
    const [body, signature, extra] = raw.split('.');
    if (!body || !signature || extra || !equal(sign(body), signature)) return false;
    try {
      const session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      return session.version === 1 && typeof session.nonce === 'string' && Number.isFinite(session.expiresAt)
        && session.expiresAt > now() && session.expiresAt <= now() + 8 * 3600_000;
    } catch { return false; }
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const html = (res, error, returnTo) => {
    res.writeHead(error ? 403 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SparkFlow 管理登录</title>
<style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#061011;color:#e0e9e4;font:16px/1.7 system-ui}main{width:min(420px,calc(100vw - 64px));padding:32px;border:1px solid #28433b}h1{font-size:26px}p{color:#9eb5aa}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;border:1px solid #3d6254;border-radius:5px;background:#0b1b17;color:inherit;font:inherit}button{background:#8ee7ca;color:#061011;font-weight:700;cursor:pointer}.error{color:#f59a91}a{color:#8ee7ca}</style>
<main><h1>SparkFlow 管理登录</h1><p>公共行情和资讯可直接阅读。修改设置、使用私有会话或连接账户需要管理登录。</p>${error ? '<p class="error">管理令牌无效，请检查后重试。</p>' : ''}
<form method="post" action="/_sparkflow/login"><label for="token">管理令牌</label><input id="token" name="token" type="password" required autocomplete="off" maxlength="256"><input type="hidden" name="return" value="${escape(returnTo)}"><button type="submit">登录</button></form><a href="/terminal">返回终端</a></main></html>`);
  };
  return async (req, res, next) => {
    const url = new URL(req.url || '/', publicOrigin);
    const origin = req.headers.origin;
    if (origin && origin !== site.origin) return json(res, 403, { error: 'origin_not_allowed', detail: '请从部署的 SparkFlow 页面访问' });
    // Never trust forwarding/identity headers supplied by a public client.
    delete req.headers['x-sparkflow-owner'];
    req.headers['x-forwarded-host'] = site.host;
    const isOwner = authenticated(req);
    const read = ['GET', 'HEAD'].includes(req.method || 'GET');
    if (req.method === 'OPTIONS') {
      res.writeHead(origin === site.origin ? 204 : 403, { 'Cache-Control': 'no-store' }); res.end(); return;
    }
    if (url.pathname === '/_sparkflow/health' && read) return json(res, 200, { ok: true, service: 'sparkflow-backend' });
    if (url.pathname === '/_sparkflow/session' && read) return json(res, 200, { authenticated: isOwner });
    if (url.pathname === '/_sparkflow/login') {
      const returnTo = safeReturn(url.searchParams.get('return'));
      if (req.method === 'GET') {
        if (isOwner) { res.writeHead(303, { Location: returnTo, 'Cache-Control': 'no-store' }); res.end(); }
        else html(res, false, returnTo);
        return;
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
      if (origin !== site.origin || !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) return json(res, 403, { error: 'invalid_login_origin' });
      const address = req.socket.remoteAddress || 'unknown';
      const attempts = sessions.get(address);
      if (attempts && attempts.until > now() && attempts.count >= 20) return json(res, 429, { error: 'login_rate_limited', detail: '尝试过于频繁，请稍后重试' });
      let body = '', bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 4096) return json(res, 413, { error: 'login_request_too_large' });
        body += chunk;
      }
      const fields = new URLSearchParams(body);
      if (!equal(fields.get('token') || '', ownerToken)) {
        if (sessions.size >= 1024) sessions.delete(sessions.keys().next().value);
        sessions.set(address, { until: now() + 15 * 60_000, count: attempts?.until > now() ? attempts.count + 1 : 1 });
        html(res, true, safeReturn(fields.get('return'))); return;
      }
      sessions.delete(address);
      const encoded = Buffer.from(JSON.stringify({ version: 1, expiresAt: now() + 8 * 3600_000, nonce: randomBytes(24).toString('base64url') })).toString('base64url');
      res.writeHead(303, { Location: safeReturn(fields.get('return')), 'Cache-Control': 'private, no-store',
        'Set-Cookie': `${cookieName}=${encoded}.${sign(encoded)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800` });
      res.end(); return;
    }
    if (url.pathname === '/_sparkflow/logout' && req.method === 'POST') {
      if (!isOwner || origin !== site.origin) return json(res, 403, { error: 'owner_login_required' });
      res.writeHead(303, { Location: '/terminal', 'Cache-Control': 'no-store', 'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` }); res.end(); return;
    }
    if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'backend_route_not_found' });
    if (!isOwner && read && url.pathname === '/api/integration-settings') {
      return json(res, 200, { ai: { provider: 'openai', apiKey: '', model: '', baseUrl: 'https://api.openai.com/v1', useProxy: false },
        heatmap: { china: 'sina', hongkong: 'sina', us: 'sina' } });
    }
    if ((!read || privateRoute(url.pathname)) && !isOwner) return json(res, 401, {
      error: 'owner_login_required', detail: '此操作需要管理登录，请先打开 /_sparkflow/login', loginUrl: '/_sparkflow/login' });
    if (!read && origin !== site.origin) return json(res, 403, { error: 'same_origin_required' });
    if (isOwner) {
      // The original single-user APIs retain their loopback checks. Normalize
      // only after the HTTPS site's owner session and mutation Origin passed.
      req.headers.host = `127.0.0.1:${req.socket.localPort}`;
      if (origin) req.headers.origin = `http://${req.headers.host}`;
    }
    next();
  };
}
