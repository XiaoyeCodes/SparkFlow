import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { emptySnapshot } from '../src/lib/ibkr/store.ts';
import { digest, numeric } from './ibkrWorkbenchCore.ts';
import type { AccountSnapshot, Holding } from '../src/lib/ibkr/workbenchTypes.ts';

export const IBKR_MCP_URL = 'https://api.ibkr.com/v1/api/mcp-public';
type Secrets = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; state?: string; pendingAt?: number; redirect?: string; expiresAt?: number; consentId?: string };
type Tool = { name: string; description?: string; inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }; annotations?: { readOnlyHint?: boolean } };
export async function privateDirectory(dir: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const identity = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    await promisify(execFile)('icacls.exe', [dir, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`], { windowsHide: true });
  }
}
async function protect(text: string, decrypt = false): Promise<string> {
  if (process.platform !== 'win32') return text;
  const code = `Add-Type -AssemblyName System.Security; $inputText=[Console]::In.ReadToEnd(); $bytes=${decrypt ? '[Convert]::FromBase64String($inputText)' : '[Text.Encoding]::UTF8.GetBytes($inputText)'}; $result=[Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt ? '[Text.Encoding]::UTF8.GetString($result)' : '[Convert]::ToBase64String($result)'});`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume();
    child.on('error', () => reject(new Error('CREDENTIAL_STORAGE_UNAVAILABLE')));
    child.on('close', status => status === 0 ? resolve(output) : reject(new Error('CREDENTIAL_STORAGE_UNAVAILABLE')));
    child.stdin.end(text);
  });
}
export async function atomicReplace(source:string,target:string,replace=rename) {
  for(let attempt=0;;attempt++)try{await replace(source,target);return;}catch(e:any){
    // Windows readers/virus scanners can hold the destination briefly. Never unlink it.
    if(!['EPERM','EBUSY'].includes(e.code)||attempt>=5)throw e;
    await new Promise(resolve=>setTimeout(resolve,30*2**attempt));
  }
}
export async function atomicJson(file: string, data: unknown) {
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
  await atomicReplace(temporary, file);
}
const unpack = (result: any): any => {
  if (result.isError) throw new Error('MCP_TOOL_READ_FAILED');
  if (result.structuredContent) return result.structuredContent;
  const texts = (result.content ?? []).filter((x: any) => x.type === 'text').map((x: any) => x.text);
  for (const text of texts) { try { return JSON.parse(text); } catch { /* Structured account data is mandatory. */ } }
  throw new Error('MCP_TOOL_RESPONSE_NOT_JSON');
};
const accountKey = (id: string) => `live:${digest(id).slice(0, 20)}`;
const boundTools = ['get_account_summary', 'get_account_positions', 'get_account_balances'] as const;
function toolKind(tool: Tool): 'accounts' | 'positions' | 'summary' | null {
  // Only verified read-only tools; a description cannot authorize a broker write.
  if (tool.annotations?.readOnlyHint !== true || /create|submit|place|modify|delete|cancel|instruction|order/i.test(tool.name)) return null;
  const name = tool.name.replace(/[^a-z]/gi, '').toLowerCase();
  if (/positions/.test(name)) return 'positions';
  if (/accountsummary|portfoliosummary/.test(name)) return 'summary';
  if (/accounts$|listaccounts|getaccounts/.test(name)) return 'accounts';
  return null;
}
export function normalizeMcpSnapshot(id: string, positionsPayload: unknown, summaryPayload: unknown, now = new Date()): AccountSnapshot {
  const positions: any = positionsPayload;
  const rows: any = Array.isArray(positions) ? positions : positions?.positions ?? positions?.data?.positions ?? positions?.data;
  if (!Array.isArray(rows)) throw new Error('MCP_POSITIONS_SCHEMA_UNSUPPORTED');
  const summary: any = summaryPayload;
  const data = summary?.summary ?? summary?.data ?? summary;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('MCP_SUMMARY_SCHEMA_UNSUPPORTED');
  const field = (...names: string[]) => { for (const name of names) { if (data[name] !== undefined) return data[name]; } return null; };
  const decimal = (v: any): string | null => { const n = numeric(v?.amount ?? v?.value ?? v); return n === null ? null : String(n); };
  const declared = [positions?.accountId, positions?.account, data.accountId, data.account].filter(x => typeof x === 'string');
  if (declared.some(value => value !== id) || rows.some((p: any) => (p.accountId ?? p.acctId ?? p.account) && (p.accountId ?? p.acctId ?? p.account) !== id)) throw new Error('MCP_ACCOUNT_IDENTITY_MISMATCH');
  const nav = field('netLiquidation', 'netliquidation', 'NetLiquidation');
  const currency = String(data.baseCurrency ?? data.currency ?? nav?.currency ?? '');
  const snapshot: AccountSnapshot = { ...emptySnapshot('live'), accountKey: accountKey(id), asOf: now.toISOString(), snapshotId: '', connection: 'connected', state: rows.length ? 'ready' : 'empty', baseCurrency: /^[A-Z]{3}$/.test(currency) ? currency : null, missing: [], detail: 'IBKR 官方 MCP · 只读账户快照', positions: [], metrics: {
    netLiquidation: decimal(nav), unrealizedPnl: decimal(field('unrealizedPnl', 'unrealizedpnl', 'UnrealizedPnL')),
    buyingPower: decimal(field('buyingPower', 'buyingpower', 'BuyingPower')), maintenanceMargin: decimal(field('maintenanceMargin', 'maintmarginreq', 'MaintMarginReq')),
  } };
  snapshot.positions = rows.map((p: any): Holding => {
    const conId = Number(p.conId ?? p.conid), quantity = decimal(p.quantity ?? p.position);
    const symbol = String(p.symbol ?? p.ticker ?? ((p.assetClass ?? p.assetType ?? p.secType) === 'STK' ? p.contractDesc : '') ?? '');
    if (!Number.isSafeInteger(conId) || conId <= 0 || quantity === null || !symbol || !/^[A-Z]{3}$/.test(String(p.currency))) throw new Error('MCP_POSITION_FIELDS_MISSING');
    return { accountKey: snapshot.accountKey, conId, symbol, currency: p.currency, quantity, averageCost: decimal(p.averageCost ?? p.avgCost), marketValue: decimal(p.marketValue ?? p.mktValue), unrealizedPnl: decimal(p.unrealizedPnl), assetType: String(p.assetType ?? p.assetClass ?? p.secType ?? 'UNKNOWN'), exchange: String(p.exchange ?? p.primaryExchange ?? ''), name: String(p.name ?? p.contractDesc ?? symbol) };
  });
  if (new Set(snapshot.positions.map(p => p.conId)).size !== snapshot.positions.length) throw new Error('MCP_DUPLICATE_CONTRACT');
  const cash = field('cash', 'cashBalances');
  if (Array.isArray(cash)) snapshot.cash = cash.filter((v: any) => /^[A-Z]{3}$/.test(v.currency) && decimal(v.amount) !== null).map((v: any) => ({ currency: v.currency, amount: decimal(v.amount)! }));
  else { const amount = decimal(field('totalcashvalue', 'TotalCashValue', 'cashBalance')); if (amount !== null && snapshot.baseCurrency) snapshot.cash = [{ currency: snapshot.baseCurrency, amount }]; }
  for (const [key, value] of Object.entries(snapshot.metrics)) if (value === null) snapshot.missing.push(key);
  if (!snapshot.baseCurrency) snapshot.missing.push('baseCurrency');
  if (!snapshot.cash.length) snapshot.missing.push('cash');
  snapshot.snapshotId = digest({ ...snapshot, asOf: null });
  snapshot.provenance = { account: { source: 'IBKR MCP', observedAt: snapshot.asOf, requestCompletedAt: snapshot.asOf, brokerAsOf: null } };
  return snapshot;
}

// Official MCP tools are scoped by OAuth consent, with no account-list tool or account argument.
// This is a local consent identifier, never a claimed broker account number.
export function normalizeBoundMcpSnapshot(scope: string, positions: any, summary: any, balances: any, now = new Date()): AccountSnapshot {
  if (!Array.isArray(positions?.positions) || !summary || typeof summary !== 'object' || Array.isArray(summary)
    || !Array.isArray(balances?.balances)) throw new Error('MCP_BOUND_SCHEMA_UNSUPPORTED');
  for (const response of [positions, summary, balances]) {
    if (response.nextCursor || response.next_page || response.hasMore) throw new Error('MCP_PAGINATION_UNSUPPORTED');
  }
  // An unexpected identity-bearing response requires a new explicit account adapter.
  for (const row of [positions, summary, balances, ...positions.positions, ...balances.balances]) {
    if (!row || typeof row !== 'object') throw new Error('MCP_BOUND_SCHEMA_UNSUPPORTED');
    if (['accountId', 'account_id', 'acctId', 'account', 'accounts'].some(key => row[key] !== undefined)) throw new Error('MCP_BOUND_IDENTITY_UNSUPPORTED');
  }
  const currencies = new Set<string>();
  for (const row of balances.balances) {
    if (typeof row.currency !== 'string' || !/^(BASE|[A-Z]{3})$/.test(row.currency) || currencies.has(row.currency)
      || numeric(row.cash_balance) === null) throw new Error('MCP_BALANCES_SCHEMA_UNSUPPORTED');
    currencies.add(row.currency);
  }
  const aggregate = balances.balances.find((row: any) => row.currency === 'BASE');
  const result = normalizeMcpSnapshot(scope, positions.positions.map((row: any) => ({
    conId: row.contract_id, symbol: row.contract_description, quantity: row.position, currency: row.currency,
    averageCost: row.average_price, marketValue: row.market_value, unrealizedPnl: row.unrealized_pnl,
    assetType: row.asset_class, name: row.contract_description,
  })), {
    currency: summary.currency, netLiquidation: summary.net_liquidation, buyingPower: summary.buying_power,
    maintenanceMargin: summary.maintenance_margin, unrealizedPnl: aggregate?.unrealized_pnl,
    // BASE is an aggregate; adding it to currency rows would double-count cash.
    cash: balances.balances.filter((row: any) => row.currency !== 'BASE').map((row: any) => ({ currency: row.currency, amount: row.cash_balance })),
  }, now);
  result.missing.push('brokerAccountId');
  result.detail = 'IBKR 当前授权账户 · 账号未由接口提供，请与券商持仓核对。';
  result.snapshotId = digest({ ...result, snapshotId: '', asOf: null, provenance: undefined });
  return result;
}

export class IbkrMcp {
  private secret: Secrets = {};
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  private tools: Tool[] = [];
  private ids: string[] = [];
  private busy?: Promise<void>;
  private interactive = false;
  private saves = Promise.resolve();
  authorizationUrl?: string;
  state = 'unconfigured';
  detail = '连接 IBKR 后读取真实持仓。';
  private file: string;
  constructor(private directory: string) { this.file = path.join(directory, 'mcp-credentials.json'); }
  async load() {
    await privateDirectory(this.directory);
    try { this.secret = JSON.parse(await protect(await readFile(this.file, 'utf8'), true));
      if (this.secret.tokens && !this.secret.consentId) { this.secret.consentId = randomBytes(20).toString('hex'); await this.save(); }
      this.state = this.secret.tokens ? 'disconnected' : 'unconfigured';
      if (this.secret.tokens) this.detail = 'IBKR 授权已保存，等待同步当前账户。'; }
    catch (e: any) { if (e.code !== 'ENOENT') { this.state = 'error'; this.detail = '凭据存储无法读取，请重新授权。'; } }
  }
  private async save() {
    const value = JSON.stringify(this.secret);
    const operation = this.saves.then(async () => { const temp = this.file + '.tmp'; await writeFile(temp, await protect(value), { mode: 0o600 }); await rename(temp, this.file); });
    this.saves = operation.catch(() => {}); return operation;
  }
  private provider(): OAuthClientProvider {
    return {
      redirectUrl: this.secret.redirect,
      clientMetadata: { client_name: 'SparkFlow Account Workbench', redirect_uris: this.secret.redirect ? [this.secret.redirect] : [], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'mcp.read account-ids' },
      state: () => { this.secret.state = randomBytes(32).toString('hex'); this.secret.pendingAt = Date.now(); return this.secret.state; },
      clientInformation: () => this.secret.client,
      saveClientInformation: async value => { this.secret.client = value; await this.save(); },
      tokens: () => this.secret.tokens,
      saveTokens: async value => { this.secret.tokens = value; this.secret.consentId ??= randomBytes(20).toString('hex'); this.secret.expiresAt = value.expires_in ? Date.now() + value.expires_in * 1000 : undefined; await this.save(); },
      redirectToAuthorization: async url => { this.authorizationUrl = url.href; this.state = 'authorization-required'; await this.save(); },
      saveCodeVerifier: async value => { this.secret.verifier = value; await this.save(); },
      codeVerifier: () => { if (!this.secret.verifier) throw new Error('OAUTH_VERIFIER_MISSING'); return this.secret.verifier; },
      invalidateCredentials: async scope => { if (scope === 'tokens' || scope === 'all') this.secret.tokens = undefined; if (scope === 'client' || scope === 'all') this.secret.client = undefined; if (scope === 'verifier' || scope === 'all') this.secret.verifier = undefined; await this.save(); },
    };
  }
  private async open() {
    await this.client?.close().catch(() => {});
    this.client = new Client({ name: 'sparkflow-account-workbench', version: '1.0.0' });
    this.transport = new StreamableHTTPClientTransport(new URL(IBKR_MCP_URL), { authProvider: this.provider(), fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }) });
    await this.client.connect(this.transport);
    this.tools = []; let cursor: string | undefined;
    for (let page = 0; page < 10; page++) { const result = await this.client.listTools({ cursor }); this.tools.push(...result.tools); cursor = result.nextCursor; if (!cursor) break; }
    if (cursor) throw new Error('MCP_TOOLS_PAGINATION_LIMIT');
    this.state = 'connected'; this.detail = 'MCP 已连接，正在核对账户读取能力。';
  }
  async begin(origin: string) {
    if (this.busy || this.interactive) throw new Error('MCP_OPERATION_IN_PROGRESS');
    this.interactive = true;
    this.secret.redirect = `${origin}/api/ibkr-workbench/oauth/callback`; this.authorizationUrl = undefined;
    try { await this.open(); await this.discoverAccounts(); } catch (e) { if (!this.authorizationUrl) { this.state = 'error'; this.detail = e instanceof Error && /^MCP_[A-Z_]+$/.test(e.message) ? e.message : 'IBKR OAuth 初始化失败：请检查网络或客户端注册支持。'; } } finally { this.interactive = false; }
    return { authorizationUrl: this.authorizationUrl, ...this.status() };
  }
  async callback(state: string, code: string) {
    if (this.busy || this.interactive) throw new Error('MCP_OPERATION_IN_PROGRESS');
    const expected = this.secret.state;
    if (!expected || !state || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) || Date.now() - (this.secret.pendingAt ?? 0) > 600000) throw new Error('OAUTH_STATE_INVALID');
    this.interactive = true;
    try { this.secret.state = undefined; this.secret.consentId = randomBytes(20).toString('hex'); this.ids = []; await this.save();
      if (!this.transport) this.transport = new StreamableHTTPClientTransport(new URL(IBKR_MCP_URL), { authProvider: this.provider(), fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) }) });
      await this.transport.finishAuth(code); this.authorizationUrl = undefined; await this.open(); await this.discoverAccounts();
    } catch (e) {
      this.state = 'error'; this.detail = e instanceof Error && /^MCP_[A-Z_]+$/.test(e.message) ? e.message : 'MCP_OAUTH_CALLBACK_FAILED';
      throw new Error(this.detail);
    } finally { this.interactive = false; }
  }
  private selectedTool(kind: 'accounts' | 'positions' | 'summary') {
    const candidates = this.tools.filter(t => toolKind(t) === kind);
    if (candidates.length !== 1) throw new Error(`MCP_${kind.toUpperCase()}_TOOL_UNSUPPORTED`);
    return candidates[0];
  }
  private boundProfile() {
    return boundTools.every(name => {
      const matches = this.tools.filter(t => t.name === name);
      const tool = matches[0];
      return matches.length === 1 && tool.annotations?.readOnlyHint === true && tool.inputSchema.type === 'object'
        && !Object.keys(tool.inputSchema.properties ?? {}).length && !tool.inputSchema.required?.length;
    });
  }
  private async boundCall(name: typeof boundTools[number]) {
    if (!this.boundProfile()) throw new Error('MCP_BOUND_TOOLS_UNSUPPORTED');
    return unpack(await this.client!.callTool({ name, arguments: {} }));
  }
  private async call(kind: 'accounts' | 'positions' | 'summary', id?: string) {
    const tool = this.selectedTool(kind); const args: Record<string, unknown> = {};
    for (const [key] of Object.entries(tool.inputSchema.properties ?? {})) {
      if (['accountId', 'account_id', 'account', 'acctId'].includes(key) && id) args[key] = id;
      else if (['pageId', 'page', 'page_id'].includes(key)) args[key] = 0;
      else if ((tool.inputSchema.required ?? []).includes(key)) throw new Error('MCP_TOOL_ARGUMENT_UNSUPPORTED');
    }
    if (id && !Object.values(args).includes(id)) throw new Error('MCP_TOOL_ACCOUNT_SCOPE_UNSUPPORTED');
    const results: any[] = []; const seenPages = new Set<string>(); let raw: any;
    for (let page = 0; page < 100; page++) {
      raw = unpack(await this.client!.callTool({ name: tool.name, arguments: args }));
      if (id && [raw?.accountId, raw?.account, raw?.acctId].some(value => typeof value === 'string' && value !== id)) throw new Error('MCP_ACCOUNT_IDENTITY_MISMATCH');
      if (kind !== 'positions') return raw;
      const rows = Array.isArray(raw) ? raw : raw.positions ?? raw.data?.positions ?? raw.data;
      if (!Array.isArray(rows)) throw new Error('MCP_POSITIONS_SCHEMA_UNSUPPORTED');
      if (rows.length && seenPages.has(digest(rows))) throw new Error('MCP_PAGINATION_REPEATED');
      if (rows.length) seenPages.add(digest(rows));
      results.push(...rows);
      const pageKey = Object.keys(args).find(key => ['pageId', 'page', 'page_id'].includes(key));
      if (raw.nextCursor || raw.next_page || raw.hasMore && !pageKey) throw new Error('MCP_PAGINATION_UNSUPPORTED');
      if (!pageKey || rows.length === 0) return { accountId: id, positions: results };
      args[pageKey] = page + 1;
    }
    throw new Error('MCP_PAGINATION_LIMIT');
  }
  async performance(key: string) {
    if(this.interactive)throw new Error('MCP_OPERATION_IN_PROGRESS');
    while(this.busy)await this.busy;
    let result:any;
    this.busy=(async()=>{
      if (!this.client || this.state !== 'connected') await this.open();
      if (!this.ids.length) await this.discoverAccounts();
      if (!this.boundProfile() || !this.ids.some(id => accountKey(id) === key)) throw new Error('MCP_HISTORY_ACCOUNT_UNSUPPORTED');
      const matches=this.tools.filter(t=>t.name==='get_pa_performance_all_periods'),tool=matches[0];
      if(matches.length!==1||tool.annotations?.readOnlyHint!==true||Object.keys(tool.inputSchema.properties??{}).length||tool.inputSchema.required?.length)throw new Error('MCP_HISTORY_TOOL_UNSUPPORTED');
      result={data:unpack(await this.client!.callTool({name:tool.name,arguments:{}})),description:tool.description};
    })();
    try{await this.busy;return result;}finally{this.busy=undefined;}
  }
  private async discoverAccounts() {
    if (this.boundProfile()) {
      if (!this.secret.consentId) throw new Error('MCP_CONSENT_ID_MISSING');
      this.ids = [`consent-${this.secret.consentId}`];
      this.detail = 'IBKR 已授权，正在读取授权账户；接口不提供账号或账户切换。';
      return;
    }
    const raw = await this.call('accounts'); const rows = Array.isArray(raw) ? raw : raw.accounts ?? raw.data;
    if (!Array.isArray(rows)) throw new Error('MCP_ACCOUNTS_SCHEMA_UNSUPPORTED');
    this.ids = rows.map((v: any) => typeof v === 'string' ? v : v.accountId ?? v.id ?? v.account).filter((id: unknown): id is string => typeof id === 'string' && /^[A-Z0-9-]{3,40}$/i.test(id));
    if (!this.ids.length) throw new Error('MCP_NO_AUTHORIZED_ACCOUNTS');
    this.detail = '账户已授权，请核对所选账户。';
  }
  async snapshot(key?: string): Promise<AccountSnapshot> {
    if (this.interactive) throw new Error('MCP_OPERATION_IN_PROGRESS');
    if (!this.secret.tokens) throw new Error('MCP_AUTHORIZATION_REQUIRED');
    if (this.busy) await this.busy;
    let result: AccountSnapshot | undefined;
    this.busy = (async () => {
      try {
        if (!this.client || this.state !== 'connected') await this.open();
        if (!this.ids.length) await this.discoverAccounts();
        const id = key ? this.ids.find(id => accountKey(id) === key) : this.ids.length === 1 ? this.ids[0] : undefined;
        if (!id) throw new Error('MCP_SELECT_ACCOUNT');
        if (this.boundProfile()) {
          const positions = await this.boundCall('get_account_positions');
          const summary = await this.boundCall('get_account_summary');
          const balances = await this.boundCall('get_account_balances');
          result = normalizeBoundMcpSnapshot(id, positions, summary, balances);
        } else {
          const positions = await this.call('positions', id); const summary = await this.call('summary', id);
          result = normalizeMcpSnapshot(id, positions, summary);
        }
        this.detail = this.boundProfile() ? '真实持仓与摘要已同步；账号未由接口提供，请与 IBKR 持仓核对。' : '真实持仓与摘要读取成功；最后同步时间见账户卡片。';
      } catch (e) {
        this.state = this.authorizationUrl ? 'authorization-required' : 'error';
        this.detail = e instanceof Error && /^MCP_[A-Z_]+$/.test(e.message) ? e.message : 'MCP_READ_FAILED';
        throw new Error(this.detail);
      }
    })();
    try { await this.busy; return result!; } finally { this.busy = undefined; }
  }
  status() { return { state: this.state, authorized: Boolean(this.secret.tokens), detail: this.detail, tools: this.tools.map(t => ({ name: t.name, description: (t.description ?? '').slice(0, 3000), annotations:t.annotations, inputSchema: t.inputSchema })), accounts: this.ids.map(id => ({ key: accountKey(id), label: id.startsWith('consent-') ? 'IBKR 当前授权账户（账号未提供）' : `IBKR •••${id.slice(-4)}` })) }; }
  async disconnect() {
    if (this.interactive) throw new Error('MCP_OPERATION_IN_PROGRESS');
    if (this.busy) await this.busy.catch(() => {});
    // Revoke when supported; local credential deletion is guaranteed even if IBKR is unavailable.
    let revoked = false;
    try {
      const token = this.secret.tokens?.refresh_token ?? this.secret.tokens?.access_token;
      if (token) { const body = new URLSearchParams({ token, client_id: this.secret.client?.client_id ?? '' });
        const r = await fetch('https://api.ibkr.com/oauth2/api/v1/token/revoke', { method: 'POST', body, signal: AbortSignal.timeout(8000) }); revoked = r.ok; }
    } catch { /* Surface remote revocation status separately. */ }
    await this.close(); await this.saves; this.secret = {}; this.ids = []; this.tools = []; this.authorizationUrl = undefined;
    await unlink(this.file).catch((e: any) => { if (e.code !== 'ENOENT') throw e; });
    this.state = 'unconfigured'; this.detail = revoked ? '已撤销授权并清除本地凭据。' : '已清除本地凭据；请在 IBKR Manage Third-Party Consents 核对撤销状态。';
  }
  async close() { await this.client?.close().catch(() => {}); this.client = undefined; }
}
