import { BRIEF_PROMPT_VERSION, briefInput, briefPrompt, briefSchedule, validateBrief } from './ibkrBrief.ts';
import { scheduleWindow } from './ibkrSchedules.ts';
import { accountSchedules } from '../src/lib/ibkr/accountSchedules.ts';
import { prepareBriefResearch } from './ibkrBriefResearch.ts';
import type { DailyBrief, DailyBriefStatus } from '../src/lib/ibkr/workbenchTypes.ts';
import { CompanyLogos, CompanyLogoImages } from './ibkrCompanyLogos.ts';
import { reportMarkdown } from '../src/lib/ibkr/workbenchReport.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { readFile, open, unlink, access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IbkrMcp, atomicJson } from './ibkrMcp.ts';
import { IbkrMarket, type JsonFetcher } from './ibkrMarket.ts';
import { EastmoneyTicketQuotes, mergeBrokerTicketQuote } from './ibkrEastmoneyTicket.ts';
import { searchStocks } from './ibkrStockSearch.ts';
import { TicketHistories } from './ibkrTicketHistory.ts';
import { IbkrProfiles, type ProfileBatchFetcher } from './ibkrProfiles.ts';
import { createIbkrAi } from './ibkrAi.ts';
import { accountRisk, defaults, digest, newYorkClock, preferencesSchema } from './ibkrWorkbenchCore.ts';
import { createResearch, runResearch, researchFailure, type ResearchCheckpoint } from './ibkrResearch.ts';
import { portfolioMetrics, localPerformance, gatewayPerformance, comparePerformance, normalizePerformance, simulatePlan, planSchema } from './ibkrPortfolio.ts';
import type { AdjustmentPlan, PortfolioPerformance, PerformancePoint } from '../src/lib/ibkr/workbenchTypes.ts';
import { emptySnapshot } from '../src/lib/ibkr/store.ts';
import { validSnapshot } from '../src/lib/ibkr/events.ts';
import { allowedLocalRequest } from './localRequest.ts';
import { startSparkFlowBridge, discoverSparkFlowGateway } from './ibkrGatewayBridge.ts';
import type { AccountSnapshot, Alert, AnalysisJob, AnalysisReport, Evidence, MarketQuote, PaperQuote, Preferences, WorkbenchState, AiModel } from '../src/lib/ibkr/workbenchTypes.ts';

type BriefAttempt = { id: string; sessionDate: string | null; state: 'running' | 'completed' | 'failed'; startedAt: string; detail?: string; error?: string };
type AccountRecord = { scheduleRuns?: Record<string, { at: string; error?: string }>; scheduleEffectiveAt?: Partial<Record<'brief' | 'analysis', string>>; briefs?: DailyBrief[]; briefAttempt?: BriefAttempt; snapshot: AccountSnapshot; preferences: Preferences; grant?: { fingerprint: string; at: string }; alerts: Alert[]; reports: AnalysisReport[]; jobs: AnalysisJob[]; usage: { at: string; kind: string }[]; lastDaily?: string; dailyAttempt?: { date: string; at: number }; lastEventSignature?: string; peakNav?: number; research?: Record<string, ResearchCheckpoint>; plans?: AdjustmentPlan[]; history?: PerformancePoint[]; performance?: PortfolioPerformance };
type GatewayMode = 'live' | 'paper';
type GatewayBridgeStarter = typeof startSparkFlowBridge;
type Saved = { version: 1; source: 'mcp' | 'gateway'; gatewayMode?: GatewayMode; selectedKey?: string; records: Record<string, AccountRecord> };
const safeUrl = (url: unknown) => { try { const u = new URL(String(url)); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const decimalAmount = z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/);
const paperLimitsSchema = z.object({
  maxOrderNotional: decimalAmount.nullish(),
  maxTotalExposure: decimalAmount,
  maxSymbolWeight: decimalAmount,
  maxDailyLoss: decimalAmount,
  maxDailyOrders: z.number().int().positive(),
  maxOrdersPerMinute: z.number().int().positive(),
  maxQuoteAgeSeconds: z.number().int().min(1).max(10),
  maxAccountAgeSeconds: z.number().int().min(1).max(30),
  maxPriceDeviation: decimalAmount,
  feeReserve: decimalAmount,
}).strict();
const paperConfigureSchema = z.object({ conIds: z.array(z.number().int().positive()).min(1).max(20), expiresAt: z.string().datetime({ offset: true }), limits: paperLimitsSchema, explicit: z.literal(true) }).strict();
const paperPreviewSchema = z.union([
  z.object({ conId: z.number().int().positive(), side: z.enum(['BUY', 'SELL']), quantity: decimalAmount, limitPrice: decimalAmount, orderType: z.literal('LMT').optional() }).strict(),
  z.object({ conId: z.number().int().positive(), side: z.enum(['BUY', 'SELL']), quantity: decimalAmount, orderType: z.literal('MKT') }).strict(),
]);
const paperConfirmSchema = z.object({ previewId: z.string().min(1).max(128), bodyHash: z.string().regex(/^[a-f0-9]{64}$/), explicit: z.literal(true) }).strict();
const paperCancelSchema = z.object({ intentId: z.string().min(1).max(128), bodyHash: z.string().regex(/^[a-f0-9]{64}$/), explicit: z.literal(true) }).strict();
const strategyIdSchema = z.string().min(1).max(128).regex(/^user:[A-Za-z0-9][A-Za-z0-9:_-]*$/);
const strategyVersionSchema = z.string().max(32).regex(/^[0-9]+\.[0-9]+\.[0-9]+$/);
const strategyDefinitionSchema = z.object({
  strategyId: strategyIdSchema, version: strategyVersionSchema, origin: z.literal('user'), name: z.string().min(1).max(128),
  universe: z.array(z.number().int().positive()).length(1), barInterval: z.enum(['1D', '1h']),
  entryRule: z.string().min(1).max(2000), exitRule: z.string().min(1).max(2000),
  parameters: z.record(z.string().min(1).max(128), z.string().min(1).max(128)),
  signal: z.object({ kind: z.literal('sma_cross'), priceField: z.literal('close'), fastWindow: z.number().int().min(1).max(100), slowWindow: z.number().int().min(2).max(500), entryWhen: z.literal('FAST_ABOVE_SLOW'), exitWhen: z.literal('FAST_AT_OR_BELOW_SLOW') }).strict(),
  positionSizing: z.object({ kind: z.literal('fixed_quantity'), targetQuantity: decimalAmount }).strict(),
  costs: z.object({ commissionPerOrder: decimalAmount, commissionPerShare: decimalAmount, slippageBps: decimalAmount }).strict(),
  risk: z.object({ allowShort: z.literal(false), maxPositionQuantity: decimalAmount }).strict(),
  versionNotes: z.string().min(1).max(2000),
}).strict().superRefine((value, context) => {
  if (value.signal.fastWindow >= value.signal.slowWindow) context.addIssue({ code: z.ZodIssueCode.custom, path: ['signal', 'fastWindow'], message: '快均线必须短于慢均线' });
  if (!/^\d+$/.test(value.positionSizing.targetQuantity) || Number(value.positionSizing.targetQuantity) <= 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['positionSizing', 'targetQuantity'], message: '目标数量必须是正整股' });
  if (!/^\d+$/.test(value.risk.maxPositionQuantity) || Number(value.risk.maxPositionQuantity) <= 0 || Number(value.positionSizing.targetQuantity) > Number(value.risk.maxPositionQuantity)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['risk', 'maxPositionQuantity'], message: '持仓上限必须覆盖目标整股数' });
  if (Number(value.costs.slippageBps) > 1000) context.addIssue({ code: z.ZodIssueCode.custom, path: ['costs', 'slippageBps'], message: '滑点假设超出范围' });
});
const backtestUploadBarSchema = z.object({ timestamp: z.string().datetime({ offset: true }), open: decimalAmount, high: decimalAmount,
  low: decimalAmount, close: decimalAmount, volume: decimalAmount.nullable().optional(), splitRatio: decimalAmount.nullable().optional(),
  dividendPerShare: decimalAmount.optional() }).strict();
const backtestRunSchema = z.object({ strategyId: strategyIdSchema, strategyVersion: strategyVersionSchema, initialCash: decimalAmount,
  corporateActionsComplete: z.literal(true), bars: z.array(backtestUploadBarSchema).min(2).max(100000) }).strict();
const gatewayConnectionDetails: Record<string, (port: number) => string> = {
  GATEWAY_BRIDGE_NOT_STARTED: port => `未检测到 SparkFlow 本地桥接服务（127.0.0.1:${port}）。点击“智能连接”即可自动选择端口并启动。`,
  GATEWAY_BRIDGE_PORT_CONFLICT: port => `本机 ${port} 端口已被其他服务占用，当前服务不是 SparkFlow IBKR 桥接。请更换端口或释放占用后重新启动桥接。`,
  GATEWAY_BRIDGE_SESSION_MISSING: () => '已发现本地桥接服务，但当前项目缺少会话令牌。请从 SparkFlow 项目目录重新启动桥接。',
  GATEWAY_BRIDGE_SESSION_EXPIRED: () => '本地桥接会话已失效。请重新启动 SparkFlow IBKR 桥接服务。',
  GATEWAY_BRIDGE_UNAVAILABLE: port => `无法访问本地桥接服务 127.0.0.1:${port}，点击“智能连接”可自动恢复。`,
  GATEWAY_BRIDGE_INVALID_RESPONSE: port => `本地 ${port} 服务返回了不兼容的数据，请确认运行的是 SparkFlow IBKR 桥接。`,
  GATEWAY_BRIDGE_PORT_INVALID: () => '本地桥接端口配置无效，请设置为 1024–65535 之间的整数。',
  GATEWAY_ACCOUNT_UNCONFIGURED: () => '本地桥接已启动，但尚未绑定当前 Gateway 账户。完成绑定后会自动同步。',
  GATEWAY_ACCOUNT_OFFLINE: () => '本地桥接已启动，正在等待 Gateway API Socket 与账户快照。',
  GATEWAY_LIVE_SNAPSHOT_UNAVAILABLE: () => 'Gateway 尚未提供可用的账户快照，等待登录完成后会自动重试。',
  GATEWAY_PAPER_SNAPSHOT_UNAVAILABLE: () => '模拟盘 Gateway 尚未提供可用的账户快照，等待登录完成后会自动重试。',
  ACCOUNT_SNAPSHOT_STALE: () => 'Gateway 账户快照已过期，正在等待最新同步。',
};
class GatewayConnectionError extends Error {}
const gatewayConnectionDetail = (error: unknown, port: number) => error instanceof GatewayConnectionError ? error.message : gatewayConnectionDetails[error instanceof Error ? error.message : '']?.(port) ?? 'Gateway 同步暂不可用，请检查本机桥接与 API Socket。';
export async function readBriefProfileFallback(directory: string, analysisAsOf: string): Promise<Evidence[]> {
  const cutoff = Date.parse(analysisAsOf); if (!Number.isFinite(cutoff)) return [];
  const date = new Date(cutoff).toISOString().slice(0, 10), profiles: Evidence[] = [];
  try {
    const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^[a-f0-9-]+\.brief-attempt\.json$/i.test(entry.name));
    const files = (await Promise.all(entries.map(async entry => { try { const meta = await stat(path.join(directory, entry.name)); return { name: entry.name, at: meta.mtimeMs, size: meta.size }; } catch { return null; } })))
      .filter((entry): entry is { name: string; at: number; size: number } => entry !== null && entry.size <= 2_000_000).sort((a, b) => b.at - a.at).slice(0, 8);
    for (const file of files) {
      try {
        const attempt = JSON.parse(await readFile(path.join(directory, file.name), 'utf8'));
        const evidence = attempt.research?.evidence ?? attempt.input?.research?.evidence;
        for (const item of Array.isArray(evidence) ? evidence : []) {
          const fetched = Date.parse(item?.fetchedAt);
          if (item?.kind !== 'profile' || item.read !== true || !Array.isArray(item.symbols) || item.symbols.length !== 1 || typeof item.symbols[0] !== 'string' || typeof item.content !== 'string' || !Number.isFinite(fetched) || fetched > cutoff || new Date(fetched).toISOString().slice(0, 10) !== date) continue;
          // Whitelist only public Evidence fields; never propagate saved snapshots, prompts, account keys or model configuration.
          profiles.push({ id: String(item.id ?? ''), kind: 'profile', title: String(item.title ?? ''), summary: String(item.summary ?? ''), url: String(item.url ?? ''), source: String(item.source ?? ''), fetchedAt: item.fetchedAt, publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : null, symbols: [item.symbols[0]], content: item.content, read: true, cached: true });
        }
      } catch { /* A corrupt or incomplete saved attempt does not block fresh public research. */ }
    }
  } catch { /* The first run has no saved public materials yet. */ }
  return profiles;
}
export function oauthCallbackPage(authorized: boolean, synced: boolean, error?: string) {
  const title = error ? '授权返回处理未完成' : synced ? 'IBKR 账户已同步' : authorized ? 'IBKR 已授权，持仓待同步' : 'IBKR 授权未完成';
  const detail = error ? '请返回账户工作台查看连接提示；不要刷新此授权回调地址。' : synced ? '真实持仓与账户摘要已读取，可以关闭本窗口。' : '请返回账户工作台点击「刷新账户」，查看读取结果。';
  const safeError = error && /^[A-Z_]+$/.test(error) ? `<p>诊断代码：${error}</p>` : '';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{background:#0b1717;color:#dfebe6;font:16px/1.7 system-ui;margin:12vh auto;padding:24px;max-width:650px}a{display:inline-block;color:#0b2720;background:#76dabc;padding:12px 22px;border-radius:8px;text-decoration:none}p{color:#adbfba}</style><h1>${title}</h1><p>${detail}</p>${safeError}<a href="/ibkr">返回账户工作台</a></html>`;
}
export function extractEvidence(news: any, macro: any, snapshot: AccountSnapshot, now = new Date()): Evidence[] {
  const symbols = snapshot.positions.map(p => p.symbol);
  const items: Evidence[] = (Array.isArray(news?.items) ? news.items : []).filter((n: any) => typeof n.title === 'string' && safeUrl(n.url)).map((n: any) => {
    const text = `${n.title} ${n.summary ?? ''}`;
    const matched = symbols.filter(symbol => {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(text)) return true;
      const name = snapshot.positions.find(p => p.symbol === symbol)?.name;
      return Boolean(name && name !== symbol && name.length >= 4 && text.toLocaleLowerCase().includes(name.toLocaleLowerCase()));
    });
    return { id: `news:${digest([n.url, n.title]).slice(0, 20)}`, title: n.title.slice(0, 500), summary: String(n.summary ?? '').slice(0, 1200), url: safeUrl(n.url), source: String(n.source ?? '新闻来源'), publishedAt: typeof n.publishedAt === 'string' && Number.isFinite(Date.parse(n.publishedAt)) ? n.publishedAt : null, fetchedAt: now.toISOString(), symbols: matched, kind: 'news' as const };
  });
  const related = items.filter(e => e.symbols.length).slice(0, 20);
  const background = items.filter(e => !e.symbols.length).slice(0, 6);
  const macroItems: Evidence[] = (Array.isArray(macro?.macro) ? macro.macro : []).filter((m: any) => typeof m.label === 'string' && safeUrl(m.sourceUrl) && m.status !== 'unavailable').slice(0, 15).map((m: any) => ({ id: `macro:${digest([m.id, m.updatedAt, m.display]).slice(0, 20)}`, title: m.label, summary: `${m.display ?? ''} · 数据期 ${m.period ?? '待核实'}`, source: '宏观数据', url: safeUrl(m.sourceUrl), publishedAt: m.updatedAt && Number.isFinite(Date.parse(m.updatedAt)) ? m.updatedAt : null, fetchedAt: now.toISOString(), symbols: [], kind: 'macro' }));
  return [...related, ...background, ...macroItems];
}
export class IbkrWorkbenchService {
  saved: Saved = { version: 1, source: 'mcp', records: {} };
  private quotes: MarketQuote[] = [];
  private evidence: Evidence[] = [];
  private model: AiModel = { provider: '', model: '', fingerprint: '', configured: false };
  private nextSync = 0; private nextEvidence = 0; private failures = 0; private syncFlight?: Promise<void>; private gatewayStartFlight?: Promise<number>; private activeGatewayBridgePort?: number; private activeAnalysis?: Promise<void>; private activeBrief?: Promise<void>;
  private writeQueue = Promise.resolve(); private generation = 0; private disposed = false; private timer?: ReturnType<typeof setTimeout>;
  private researchAbort?: AbortController; private briefAbort?: AbortController; private performanceFlight?: Promise<PortfolioPerformance>;
  private scheduleFlight = false;
  private scheduleStartedAt = new Date().toISOString();
  private connectionDetail = ''; private storageError = ''; private ai; private ownsLease = false;
  private nextGatewayAttempt = 0;
  private gatewayHealthFlight?: Promise<void>;
  private nextGatewayHealth = 0;
  readonly mcp: IbkrMcp; readonly market: IbkrMarket; readonly profiles: IbkrProfiles;
  private ticketQuotes = new EastmoneyTicketQuotes(url => this.fetchJson(url));
  private ticketHistories = new TicketHistories(url=>this.fetchJson(url));
  constructor(private root: string, private directory: string, private fetchJson: JsonFetcher, private localGet: JsonFetcher, profileScan: ProfileBatchFetcher = async () => ({ data: [] }), private gatewayBridgeStarter: GatewayBridgeStarter = startSparkFlowBridge, private gatewayDiscoverer = discoverSparkFlowGateway) { this.mcp = new IbkrMcp(directory); this.market = new IbkrMarket(fetchJson); this.ai = createIbkrAi(root); this.profiles = new IbkrProfiles(profileScan); }
  async start() {
    this.scheduleStartedAt = new Date().toISOString();
    await this.mcp.load();
    const lock = path.join(this.directory, 'worker.lock');
    try {
      try { const holder = Number(await readFile(lock, 'utf8')); if (!Number.isSafeInteger(holder) || holder <= 0) throw new Error('WORKER_LOCK_INVALID');
        let alive = true; try { process.kill(holder, 0); } catch (e: any) { if (e.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('另一个 SparkFlow 服务正在运行账户后台，请关闭重复实例。');
        await unlink(lock);
      } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
      const handle = await open(lock, 'wx', 0o600); await handle.writeFile(String(process.pid)); await handle.close(); this.ownsLease = true;
    } catch { this.storageError = '另一个服务持有账户后台锁，或锁文件不可用；本实例不会同步或调用 AI。'; return; }
    try { const data = JSON.parse(await readFile(path.join(this.directory, 'state.json'), 'utf8')); if (data.version !== 1 || !['mcp', 'gateway'].includes(data.source) || (data.gatewayMode !== undefined && !['live', 'paper'].includes(data.gatewayMode)) || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)) throw new Error('STATE_SCHEMA'); this.saved = { ...data, gatewayMode: data.gatewayMode === 'paper' ? 'paper' : 'live' };
      for (const [key, record] of Object.entries(this.saved.records)) { if (!validSnapshot(record.snapshot) || record.snapshot.accountKey !== key || !Array.isArray(record.alerts) || !Array.isArray(record.reports) || !Array.isArray(record.jobs) || !Array.isArray(record.usage)) throw new Error('STATE_SCHEMA'); record.preferences = preferencesSchema.parse(record.preferences); if (record.briefAttempt?.state === 'running') { record.briefAttempt.state = 'failed'; record.briefAttempt.error = '服务已重启；本期不会重复自动调用，可手动重试。'; } record.jobs.forEach(j => { if (j.state === 'running') { j.state = 'interrupted'; j.error = '服务已重启；已保留资料，可继续研究。'; } }); record.snapshot = { ...record.snapshot, state: 'stale', connection: 'disconnected', detail: '服务刚恢复，等待重新同步。' }; }
    } catch (e: any) { if (e.code !== 'ENOENT') { this.saved = { version: 1, source: 'mcp', records: {} }; this.storageError = '账户状态文件无法读取，已暂停写入；请检查本地状态文件。'; } }
    this.schedule();
  }
  private schedule() { if (this.disposed) return; this.timer = setTimeout(async () => { try { await this.tick(); } catch { /* A failed task remains visible in status. */ } finally { this.schedule(); } }, 15000); this.timer.unref(); }
  private record() { return this.saved.selectedKey ? this.saved.records[this.saved.selectedKey] : undefined; }
  private gatewayConnected() {
    const snapshot = this.record()?.snapshot;
    return Boolean(snapshot && snapshot.mode === (this.saved.gatewayMode ?? 'live') && snapshot.connection === 'connected' && ['ready', 'empty'].includes(snapshot.state) && snapshot.asOf && Date.now() - Date.parse(snapshot.asOf) < 180000);
  }
  private async checkGatewayHealth() {
    if (this.saved.source !== 'gateway' || this.storageError || this.disposed || this.syncFlight || this.gatewayStartFlight) return;
    if (this.gatewayHealthFlight) return this.gatewayHealthFlight;
    const record = this.record();
    if (!record || record.snapshot.connection !== 'connected' || Date.now() < this.nextGatewayHealth) return;
    const revision = this.generation, snapshot = record.snapshot, mode = this.saved.gatewayMode ?? 'live';
    this.gatewayHealthFlight = (async () => {
      let detail = '';
      try {
        const port = await this.gatewayBridgePort();
        const token = (await readFile(path.join(this.root, '.sparkflow/ibkr-terminal/session.token'), 'utf8')).trim();
        const response = await fetch(`http://127.0.0.1:${port}/api/ibkr-terminal/snapshot?mode=${mode}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2000) });
        if (!response.ok) throw new Error('BRIDGE_UNAVAILABLE');
        const value = await response.json();
        if (!validSnapshot(value) || value.mode !== mode || value.accountKey !== snapshot.accountKey || value.testData) throw new Error('INVALID_HEALTH_SCOPE');
        if (value.connection !== 'connected') detail = 'IBKR Gateway 已断开，请登录客户端后点击“智能连接”。';
      } catch { detail = '无法确认本机 IBKR 连接，已停止显示为在线；请检查客户端和桥接服务后点击“智能连接”。'; }
      if (detail && revision === this.generation && record === this.record() && record.snapshot === snapshot && !this.syncFlight && !this.gatewayStartFlight && !this.disposed) {
        this.connectionDetail = detail;
        record.snapshot = { ...snapshot, state: 'stale', connection: 'disconnected', detail };
        this.nextSync = 0;
        await this.persist();
      }
    })();
    try { await this.gatewayHealthFlight; } finally { this.gatewayHealthFlight = undefined; this.nextGatewayHealth = Date.now() + 3000; }
  }
  private scheduleBoundary(record: AccountRecord) {
    const configured = record.scheduleEffectiveAt?.analysis;
    return configured && Date.parse(configured) > Date.parse(this.scheduleStartedAt) ? configured : this.scheduleStartedAt;
  }
  assertAvailable() { if (this.storageError || this.disposed) throw new Error(this.storageError || '服务正在关闭'); }
  private persist() {
    if (this.storageError) return Promise.reject(new Error(this.storageError));
    const value = structuredClone(this.saved);
    const pending = this.writeQueue.then(() => atomicJson(path.join(this.directory, 'state.json'), value));
    this.writeQueue = pending.catch(() => {}); return pending;
  }
  private async gatewayBridgePort() {
    let raw = '';
    try { raw = (await readFile(path.join(this.root, '.sparkflow/ibkr-terminal/bridge.port'), 'utf8')).trim(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!raw) raw = process.env.SPARKFLOW_IBKR_BRIDGE_PORT ?? '';
    if (!raw) return this.activeGatewayBridgePort ?? 8765;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('GATEWAY_BRIDGE_PORT_INVALID');
    return port;
  }
  private async ensureGateway() {
    this.assertAvailable();
    if (this.saved.source !== 'gateway') throw new Error('请先选择 TWS / Gateway 来源。');
    if (!this.gatewayStartFlight) {
      const revision = this.generation, mode = this.saved.gatewayMode ?? 'live';
      this.gatewayStartFlight = (async () => {
        const preferred = await this.gatewayBridgePort();
        const bridge = await this.gatewayBridgeStarter(this.root, preferred, true);
        if (revision !== this.generation || this.disposed) return bridge.port;
        this.activeGatewayBridgePort = bridge.port;
        const status = await this.gatewayDiscoverer(this.root, bridge.port, mode);
        if (revision !== this.generation || this.disposed) return bridge.port;
        if (status.phase !== 'ready') throw new GatewayConnectionError(status.detail);
        return bridge.port;
      })().catch(error => {
        if (revision === this.generation && !this.disposed) this.connectionDetail = error instanceof Error ? error.message : 'IBKR 自动连接失败。';
        throw error instanceof GatewayConnectionError ? error : new GatewayConnectionError(this.connectionDetail);
      }).finally(() => { this.gatewayStartFlight = undefined; this.nextGatewayAttempt = Date.now() + 15000; });
    }
    return this.gatewayStartFlight;
  }
  async connectGateway() {
    const revision = this.generation;
    const port = await this.ensureGateway();
    await this.syncFlight;
    if (revision !== this.generation || this.disposed) return port;
    await this.sync(false);
    if (!this.gatewayConnected()) throw new GatewayConnectionError(this.connectionDetail || 'API 已就绪，账户快照尚未同步，请点击智能连接重试。');
    return port;
  }
  async tick() {
    if (this.storageError || this.disposed) return;
    await this.checkGatewayHealth();
    if (Date.now() >= this.nextSync && (this.saved.source === 'gateway' ? this.gatewayConnected() : Boolean(this.saved.selectedKey || this.mcp.status().authorized))) await this.sync(false);
    const record = this.record(); if (!record || record.snapshot.state === 'stale' || !record.grant) return;
    await this.runSchedules();
  }

  private async runSchedules() {
    if (this.scheduleFlight) return;
    this.scheduleFlight = true;
    try {
      const record = this.record(), generation = this.generation;
      const asOf = Date.parse(record?.snapshot.asOf ?? '');
      if (!record || !record.grant || !['ready', 'empty'].includes(record.snapshot.state) || record.snapshot.connection !== 'connected' || record.snapshot.testData || !Number.isFinite(asOf) || Date.now() - asOf > 180000 || asOf > Date.now() + 60000) return;
      const model = await this.ai.status(true);
      if (this.disposed || generation !== this.generation || record !== this.record() || !model.configured || record.grant?.fingerprint !== model.fingerprint) return;
      if (record.usage.filter(u => newYorkClock(new Date(u.at)).date === newYorkClock(new Date()).date).length >= record.preferences.maxAiCalls) return;
      const now = new Date(), config = accountSchedules(record.preferences).analysis;
      const slot = scheduleWindow(config, now, this.scheduleBoundary(record)).due;
      if (!slot || this.activeAnalysis) return;
      const key = `analysis:${slot.key}`;
      if (record.scheduleRuns?.[key]) return;
      record.scheduleRuns ??= {};
      record.scheduleRuns[key] = { at: now.toISOString() };
      // Claim durably before starting any research; failures/restarts never replay the slot.
      await this.persist();
      try {
        const current = scheduleWindow(accountSchedules(record.preferences).analysis, new Date(), this.scheduleBoundary(record)).due;
        if (record !== this.record() || generation !== this.generation || current?.key !== slot.key) throw new Error('账户或定时设置已更新，本次未启动');
        await this.analyze('daily', undefined, key);
      } catch (error) { record.scheduleRuns[key].error = error instanceof Error ? error.message : '定时任务启动失败'; await this.persist(); }
    } finally { this.scheduleFlight = false; }
  }

  private scheduleStatus() {
    const record = this.record(); if (!record) return { nextRunAt: null, pendingAt: null, detail: '连接账户后设置' };
    const config = accountSchedules(record.preferences).analysis, window = scheduleWindow(config, new Date(), this.scheduleBoundary(record));
    const pending = window.due && !record.scheduleRuns?.[`analysis:${window.due.key}`];
    const latest = Object.entries(record.scheduleRuns ?? {}).filter(([key]) => key.startsWith('analysis:')).sort((a, b) => b[1].at.localeCompare(a[1].at))[0]?.[1];
    return { nextRunAt: window.nextRunAt, pendingAt: pending ? window.due!.at : null, detail: !config.enabled ? '已关闭' : !window.calendarSupported ? '交易日历未覆盖，等待更新' : !record.grant || record.grant.fingerprint !== this.model.fingerprint ? '等待开启当前模型的账户 AI 授权' : this.activeAnalysis ? '账户分析执行中，到点任务会等待本流程完成' : latest?.error ? `最近启动失败：${latest.error}` : pending ? '已到点，等待账户、模型与调用额度就绪' : '已启用，等待下次执行' };
  }

  async sync(recoverGateway = true) {
    if (this.storageError) throw new Error(this.storageError);
    if (this.syncFlight) return this.syncFlight;
    const revision = this.generation;
    let gatewayPort = 8765;
    this.syncFlight = (async () => {
      try {
        let snapshot: AccountSnapshot;
        if (this.saved.source === 'mcp') snapshot = await this.mcp.snapshot(this.saved.selectedKey);
        else {
          gatewayPort = await this.gatewayBridgePort();
          const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
          let token = '';
          try { token = (await readFile(path.join(this.root, '.sparkflow/ibkr-terminal/session.token'), 'utf8')).trim(); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            try {
              const probe = await fetch(`${gatewayBase}/api/ibkr-terminal/session`, { signal: AbortSignal.timeout(1200) });
              throw new Error(probe.status === 401 || probe.status === 403 ? 'GATEWAY_BRIDGE_SESSION_MISSING' : 'GATEWAY_BRIDGE_PORT_CONFLICT');
            } catch (probeError) {
              if (probeError instanceof Error && /^GATEWAY_/.test(probeError.message)) throw probeError;
              throw new Error('GATEWAY_BRIDGE_NOT_STARTED');
            }
          }
          const gatewayMode = this.saved.gatewayMode ?? 'live';
          let response: Response;
          try { response = await fetch(`${gatewayBase}/api/ibkr-terminal/snapshot?mode=${gatewayMode}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }); }
          catch { throw new Error('GATEWAY_BRIDGE_UNAVAILABLE'); }
          if (response.status === 401 || response.status === 403) throw new Error('GATEWAY_BRIDGE_SESSION_EXPIRED');
          if (response.status === 404) throw new Error('GATEWAY_BRIDGE_PORT_CONFLICT');
          if (!response.ok) throw new Error('GATEWAY_BRIDGE_UNAVAILABLE');
          let value: unknown;
          try { value = await response.json(); } catch { throw new Error('GATEWAY_BRIDGE_INVALID_RESPONSE'); }
          if (!validSnapshot(value) || value.mode !== gatewayMode || value.testData) throw new Error('GATEWAY_BRIDGE_INVALID_RESPONSE');
          if (value.connection === 'unconfigured') throw new GatewayConnectionError(value.detail || gatewayConnectionDetails.GATEWAY_ACCOUNT_UNCONFIGURED(gatewayPort));
          if (value.connection !== 'connected') throw new GatewayConnectionError(value.detail || gatewayConnectionDetails.GATEWAY_ACCOUNT_OFFLINE(gatewayPort));
          if (!['ready', 'empty'].includes(value.state)) throw new GatewayConnectionError(value.detail || gatewayConnectionDetails.GATEWAY_LIVE_SNAPSHOT_UNAVAILABLE(gatewayPort));
          snapshot = value;
          // Legacy contracts without asset metadata remain visible but are not assumed to be stocks.
        }
        if (revision !== this.generation || this.disposed) return;
        if (snapshot.testData) throw new Error('真实工作台拒绝工程测试数据');
        if (!snapshot.asOf || !Number.isFinite(Date.parse(snapshot.asOf)) || Date.now() - Date.parse(snapshot.asOf) > 180000 || Date.parse(snapshot.asOf) > Date.now() + 60000) throw new Error('ACCOUNT_SNAPSHOT_STALE');
        const key = snapshot.accountKey;
        if (this.saved.selectedKey && this.saved.selectedKey !== key) throw new Error('ACCOUNT_IDENTITY_MISMATCH');
        this.saved.selectedKey = key;
        let record = this.saved.records[key]; const previous = record?.snapshot;
        if (!record) record = this.saved.records[key] = { snapshot, preferences: { ...defaults }, alerts: [], reports: [], jobs: [], usage: [] };
        const analyzed = record.reports.find(r => r.version === 2)?.snapshot.positions ?? [];
        snapshot.positions = snapshot.positions.map(p => {const old=previous?.positions.find(h=>h.conId===p.conId&&h.symbol===p.symbol),research=analyzed.find(h=>h.conId===p.conId&&h.symbol===p.symbol);return {...p,sector:old?.sector??research?.sector,industry:old?.industry??research?.industry,instrumentType:old?.instrumentType??research?.instrumentType,profileUrl:old?.profileUrl??research?.profileUrl,name:old?.name??research?.name??p.name};});
        snapshot.positions = await this.profiles.enrich(snapshot.positions);
        const day = snapshot.asOf!.slice(0,10); record.history = [...(record.history??[]).filter(h=>h.date!==day),{date:day,nav:Number(snapshot.metrics.netLiquidation)||null,cumulativeReturn:null}].slice(-400);
        record.snapshot = snapshot; this.failures = 0; this.connectionDetail = '';
        this.quotes = await this.market.quotes(snapshot.positions);
        if (revision !== this.generation) return;
        if (Date.now() >= this.nextEvidence) {
          if (snapshot.positions.length === 0) this.evidence = [];
          else {
            const results = await Promise.allSettled([this.localGet('/api/news-feed'), this.localGet('/api/global-macro-dashboard?region=global&section=macro')]);
            if (revision !== this.generation) return;
            this.evidence = extractEvidence(results[0].status === 'fulfilled' ? results[0].value : null, results[1].status === 'fulfilled' ? results[1].value : null, snapshot);
          }
          this.nextEvidence = Date.now() + 300000;
        }
        this.rules(record, previous);
        const signature = digest([snapshot.positions.map(p => [p.conId, p.quantity]).sort((a, b) => Number(a[0]) - Number(b[0])), record.alerts.filter(a => !a.resolved && a.kind === 'risk' && !a.key.startsWith('ai:')).map(a => a.key).sort(), this.evidence.filter(e => e.symbols.length && e.publishedAt && Date.now() - Date.parse(e.publishedAt) < 86400000).map(e => e.id).sort()]);
        record.lastEventSignature = signature;
        await this.persist();
      } catch (e) {
        if (revision !== this.generation || this.disposed) return;
        if (this.saved.source === 'gateway' && recoverGateway && Date.now() >= this.nextGatewayAttempt) {
          try {
            await this.ensureGateway();
            // End this flight before the fresh read; never recursively await it.
            if (revision !== this.generation || this.disposed) return;
            this.syncFlight = undefined;
            await this.sync(false);
            return;
          } catch (recoveryError) { e = recoveryError; }
        }
        if (revision !== this.generation || this.disposed) return;
        this.failures++;
        this.connectionDetail = this.saved.source === 'gateway' ? gatewayConnectionDetail(e, gatewayPort) : e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : '同步暂不可用，请检查账户连接与本机服务。';
        const record = this.record(); if (record) { record.snapshot = { ...record.snapshot, state: 'stale', connection: 'disconnected', detail: this.connectionDetail }; await this.persist(); }
      } finally { this.nextSync = Date.now() + (this.saved.source === 'gateway' && this.failures ? 15000 : Math.min(60000 * 2 ** Math.min(this.failures, 4), 900000)); this.syncFlight = undefined; }
    })(); return this.syncFlight;
  }
  private rules(record: AccountRecord, previous?: AccountSnapshot) {
    const risk = accountRisk(record.snapshot); const now = new Date().toISOString(); const active = new Set<string>();
    const add = (key: string, title: string, detail: string, symbols: string[], kind: Alert['kind'] = 'risk', evidenceIds: string[] = []) => {
      active.add(key); const found = record.alerts.find(a => a.key === key && a.active !== false);
      if (found) { found.detail = detail; return; }
      record.alerts.unshift({ id: randomUUID(), key, kind, title, detail, symbols, evidenceIds, createdAt: now, read: false, resolved: false, active: true });
    };
    for (const w of risk.weights) if (w.weight !== null && w.weight > (record.preferences.targetWeight ?? 0.25)) add(`concentration:${w.symbol}`, `${w.symbol} 仓位集中`, `当前约 ${(w.weight * 100).toFixed(1)}%，超过${record.preferences.targetWeight === null ? '默认观察线 25%' : `目标上限 ${record.preferences.targetWeight * 100}%`}；检查是否需要分批调整。`, [w.symbol]);
    if (risk.nav && risk.nav > 0 && risk.cash !== null && risk.cash / risk.nav < (record.preferences.cashFloor ?? 0.1)) add('cash-floor', '现金缓冲偏低', '本币现金占比低于设定底线；核对近期资金需求及保证金。', []);
    if (risk.nav && risk.nav > 0 && risk.margin !== null && risk.margin / risk.nav > 0.5) add('margin', '保证金占用偏高', '维持保证金超过净资产的 50%，应结合券商可用资金进一步核对。', []);
    if (previous?.snapshotId && digest(previous.positions.map(p => [p.conId, p.quantity]).sort()) !== digest(record.snapshot.positions.map(p => [p.conId, p.quantity]).sort())) add(`positions:${record.snapshot.snapshotId}`, '真实持仓发生变化', '持仓数量或合约清单已更新，可查看新旧报告对比。', [], 'change');
    for (const q of this.quotes) if (q.changePercent !== null && Math.abs(q.changePercent) >= 5 && q.status === 'delayed' && q.asOf && Date.now() - Date.parse(q.asOf) < 86400000) add(`move:${q.symbol}`, `${q.symbol} 当日波动较大`, `参考行情涨跌 ${q.changePercent.toFixed(2)}%；来源东方财富，报价时间 ${q.asOf}。价格变化本身不等于买卖信号。`, [q.symbol]);
    for(const plan of record.plans??[])if(plan.status==='watching'&&plan.steps.length&&plan.steps.every(s=>s.priceCondition&&s.trigger==='仅价格条件')){
      const met=plan.steps.every(s=>{const q=this.quotes.find(q=>q.conId===s.conId);return q?.price!=null&&q.status==='delayed'&&q.asOf&&Date.now()-Date.parse(q.asOf)<180000&&(s.priceCondition!.direction==='above'?q.price>=s.priceCondition!.price:q.price<=s.priceCondition!.price);});
      if(met){plan.status='triggered';plan.updatedAt=now;add(`plan:${plan.id}`,'计划价格条件已满足',`${plan.title}：请核对价格与资金约束后自行处理。`,plan.steps.map(s=>record.snapshot.positions.find(p=>p.conId===s.conId)?.symbol??'').filter(Boolean),'change');}
    }
    record.alerts = record.alerts.map(a => a.kind === 'risk' && !a.key.startsWith('ai:') && !active.has(a.key) ? { ...a, resolved: true, active: false } : a).slice(0, 300);
  }
  async modelStatus() { try { this.model = await this.ai.status(); } catch { this.model = { provider: '', model: '', fingerprint: '', configured: false }; } return this.model; }
  async refreshQuotes() { const snapshot = this.record()?.snapshot; const revision = this.generation; if (!snapshot) return this.quotes; const quotes = await this.market.quotes(snapshot.positions); if (revision === this.generation) this.quotes = quotes; return revision === this.generation ? quotes : []; }
  async state(): Promise<WorkbenchState> {
    await this.checkGatewayHealth();
    await this.modelStatus(); const record = this.record(); const today = newYorkClock(new Date()).date;
    const gatewayMode = this.saved.gatewayMode ?? 'live';
    let snapshot = record?.snapshot ?? emptySnapshot(this.saved.source === 'gateway' ? gatewayMode : 'live');
    if (snapshot.asOf && Date.now() - Date.parse(snapshot.asOf) > 180000) snapshot = { ...snapshot, state: 'stale', connection: 'disconnected', detail: '最后成功快照已超过三分钟。' };
    const priority = (alert: Alert) => alert.resolved ? 5 : ['margin', 'cash-floor'].includes(alert.key) ? 0 : alert.kind === 'risk' ? 1 : alert.kind === 'change' ? 2 : 3;
    const alerts = [...(record?.alerts ?? [])].sort((a, b) => priority(a) - priority(b) || b.createdAt.localeCompare(a.createdAt));
    const gatewayPort = this.saved.source === 'gateway' ? await this.gatewayBridgePort().catch(() => undefined) : undefined;
    const performance = this.saved.source === 'gateway' ? gatewayPerformance(record?.history ?? [], snapshot.baseCurrency, gatewayMode) : record?.performance ?? localPerformance(record?.history ?? [], snapshot.baseCurrency);
    return { source: this.saved.source, gatewayMode, connection: this.saved.source === 'mcp' ? { ...this.mcp.status(), detail: this.storageError || this.connectionDetail || this.mcp.detail } : { state: snapshot.connection, detail: this.storageError || this.connectionDetail || snapshot.detail || `IB Gateway ${gatewayMode === 'paper' ? '模拟盘' : '实盘'}只读服务`, port: gatewayPort, tools: [], accounts: [] }, snapshot, quotes: this.quotes, evidence: this.evidence, alerts, reports: record?.reports ?? [], jobs: record?.jobs ?? [], preferences: record?.preferences ?? defaults, ai: { ...this.model, enabled: Boolean(record?.grant && record.grant.fingerprint === this.model.fingerprint), fields: ['脱敏持仓', '现金', '风险指标', '行情', '新闻与宏观证据'], usedToday: record?.usage.filter(u => newYorkClock(new Date(u.at)).date === today).length ?? 0 }, nextSyncAt: this.nextSync ? new Date(this.nextSync).toISOString() : null, calendarSupported: briefSchedule(new Date()).calendarSupported, schedules: { analysis: this.scheduleStatus() }, metrics:portfolioMetrics(snapshot,record?.preferences.cashFloor,record?.preferences.targetWeight), plans:record?.plans??[], performance, researchServices:(this.model as any).researchServices??[] };
  }
  async paperMarketQuote(payload: unknown) {
    this.assertAvailable();
    const {dataSource,...contract} = z.object({ conId: z.number().int().positive(), symbol: z.string().regex(/^[A-Z0-9][A-Z0-9. _\-]{0,19}$/), currency: z.literal('USD'), exchange: z.string().max(20).optional(), dataSource:z.enum(['tencent','eastmoney']).default('tencent') }).strict().parse(payload);
    const [reference, broker] = await Promise.allSettled([
      this.ticketQuotes.quote(contract,dataSource),
      this.paperRequest('quote', { conId: contract.conId }),
    ]);
    if (reference.status === 'fulfilled') {
      if(broker.status!=='fulfilled')return reference.value;
      const merged=mergeBrokerTicketQuote(reference.value,broker.value as Partial<PaperQuote>);
      // The source switch controls displayed market prices. IBKR still supplies
      // executable bid/ask references and performs order validation separately.
      return {...merged,last:reference.value.last,state:reference.value.state,
        asOf:reference.value.asOf,fetchedAt:reference.value.fetchedAt,
        source:reference.value.source};
    }
    throw reference.reason;
  }
  async paperSearch(payload: unknown) {
    this.assertAvailable();
    const {query} = z.object({query:z.string().trim().min(1).max(60)}).strict().parse(payload);
    return searchStocks(query,url=>this.fetchJson(url));
  }
  async paperHistory(payload:unknown) {
    this.assertAvailable();
    const {period,dataSource,...contract}=z.object({conId:z.number().int().positive(),symbol:z.string().regex(/^[A-Z0-9][A-Z0-9. _\-]{0,19}$/),currency:z.literal('USD'),exchange:z.string().max(20).optional(),period:z.enum(['intraday','day','week','month','year']),dataSource:z.enum(['tencent','eastmoney']).default('tencent')}).strict().parse(payload);
    return this.ticketHistories.history(contract,period,dataSource);
  }
  async paperRequest(endpoint: 'status'|'contract'|'quote'|'transport'|'configure'|'preview'|'confirm'|'cancel'|'reconcile'|'stop', payload?: unknown) {
    this.assertAvailable();
    if (this.saved.source !== 'gateway' || this.saved.gatewayMode !== 'paper') throw new Error('请先选择并连接 IB Gateway 模拟盘。');
    const record = this.record();
    if (!record || record.snapshot.mode !== 'paper' || !record.snapshot.accountKey.startsWith('paper:')) throw new Error('尚未取得当前模拟账户快照。');
    const method = ['status','contract','quote','reconcile'].includes(endpoint) ? 'GET' : 'POST';
    let suffix = endpoint;
    let bodyValue: unknown;
    if (endpoint === 'contract') {
      const value = z.union([z.object({ symbol: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9. -]{0,15}$/) }).strict(), z.object({ conId: z.number().int().positive() }).strict()]).parse(payload);
      suffix += 'symbol' in value ? `?symbol=${encodeURIComponent(value.symbol.toUpperCase())}` : `?conId=${value.conId}`;
    } else if (endpoint === 'quote') {
      const value = z.object({ conId: z.number().int().positive() }).strict().parse(payload);
      suffix += `?conId=${value.conId}`;
    } else if (endpoint === 'transport') bodyValue = z.object({ explicit: z.literal(true) }).strict().parse(payload);
    else if (endpoint === 'configure') {
      const value = paperConfigureSchema.parse(payload);
      bodyValue = { ...value, accountKey: record.snapshot.accountKey, mode: 'paper' };
    } else if (endpoint === 'preview') {
      const value = paperPreviewSchema.parse(payload);
      bodyValue = { ...value, accountKey: record.snapshot.accountKey, mode: 'paper', orderType: value.orderType ?? 'LMT', tif: 'DAY', ...((value.orderType === 'MKT') ? { limitPrice: null } : {}) };
    } else if (endpoint === 'confirm') bodyValue = paperConfirmSchema.parse(payload);
    else if (endpoint === 'cancel') bodyValue = paperCancelSchema.parse(payload);
    const target = endpoint === 'transport' ? '/api/ibkr-terminal/gateway/paper-orders' : `/api/ibkr-terminal/paper/${suffix}`;
    const request = async (port: number, requestTarget=target, requestMethod=method, requestBody:unknown=bodyValue) => {
      const token = (await readFile(path.join(this.root, '.sparkflow/ibkr-terminal/session.token'), 'utf8')).trim();
      if (!token) throw new Error('本地桥接会话令牌不存在，请重新启动智能连接。');
      const response = await fetch(`http://127.0.0.1:${port}${requestTarget}`, {
        method:requestMethod, headers: { Authorization: `Bearer ${token}`, ...(requestMethod === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(requestMethod === 'POST' ? { body: JSON.stringify(requestBody ?? {}) } : {}), signal: AbortSignal.timeout(endpoint === 'transport' ? 40000 : endpoint === 'preview' || endpoint === 'reconcile' ? 15000 : 8000),
      });
      return {response,result:await response.json().catch(() => ({})) as any};
    };
    const initialPort=await this.gatewayBridgePort();
    let attempt = await request(initialPort);
    // A running bridge may predate the current paper-order policy. Upgrade it
    // once, restore its scoped paper policy, and replay only the side-effect-free preview.
    if (endpoint === 'preview' && !attempt.response.ok && ['OUTSIDE_RTH','ORDER_NOTIONAL_LIMIT'].includes(attempt.result?.detail)) {
      const priorStatus=await request(initialPort,'/api/ibkr-terminal/paper/status','GET');
      const policy=priorStatus.response.ok?paperConfigureSchema.safeParse({
        conIds:priorStatus.result?.policy?.conIds,expiresAt:priorStatus.result?.policy?.expiresAt,
        limits:priorStatus.result?.policy?.limits,explicit:true,
      }):null;
      const upgradedPort=await this.ensureGateway();
      if (policy?.success) {
        const restored=await request(upgradedPort,'/api/ibkr-terminal/paper/configure','POST',{
          ...policy.data,accountKey:record.snapshot.accountKey,mode:'paper',
        });
        if (!restored.response.ok) throw new Error(typeof restored.result?.detail === 'string' ? restored.result.detail : 'PAPER_OPERATION_FAILED');
      }
      attempt = await request(upgradedPort);
    }
    const {response,result} = attempt;
    if (endpoint === 'quote' && response.status === 404) throw new Error('PAPER_BRIDGE_UPDATE_REQUIRED');
    if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'PAPER_OPERATION_FAILED');
    return result;
  }
  async backtestRequest(endpoint: 'strategies'|'runs'|'jobs'|'save-strategy'|'run'|'cancel'|'result'|'package', payload?: unknown) {
    this.assertAvailable();
    const preferred = await this.gatewayBridgePort();
    const bridge = await this.gatewayBridgeStarter(this.root, preferred);
    const token = (await readFile(path.join(this.root, '.sparkflow/ibkr-terminal/session.token'), 'utf8')).trim();
    if (!token) throw new Error('本地回测服务会话不存在，请重新启动 SparkFlow。');
    let method: 'GET'|'POST' = 'GET', target = '', bodyValue: unknown;
    if (endpoint === 'strategies') target = '/api/ibkr-terminal/strategies';
    else if (endpoint === 'runs') target = '/api/ibkr-terminal/backtests';
    else if (endpoint === 'jobs') target = '/api/ibkr-terminal/backtests/jobs';
    else if (endpoint === 'save-strategy') { method = 'POST'; target = '/api/ibkr-terminal/strategies'; bodyValue = strategyDefinitionSchema.parse(payload); }
    else if (endpoint === 'run') { method = 'POST'; target = '/api/ibkr-terminal/backtests/jobs'; bodyValue = backtestRunSchema.parse(payload); }
    else if (endpoint === 'cancel') { const value = z.object({ jobId: z.string().regex(/^backtest:[a-f0-9]{32}$/) }).strict().parse(payload); method = 'POST'; target = `/api/ibkr-terminal/backtests/jobs/${value.jobId}/cancel`; bodyValue = {}; }
    else { const value = z.object({ runHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(payload); target = `/api/ibkr-terminal/backtests/${value.runHash}${endpoint === 'package' ? '/package' : ''}`; }
    const response = await fetch(`http://127.0.0.1:${bridge.port}${target}`, { method,
      headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(bodyValue) } : {}), signal: AbortSignal.timeout(endpoint === 'run' ? 15000 : 8000) });
    const result: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'BACKTEST_OPERATION_FAILED');
    return result;
  }
  async select(source: 'mcp' | 'gateway', key?: string, gatewayMode?: GatewayMode) {
    const mode = gatewayMode ?? this.saved.gatewayMode ?? 'live';
    if (source === this.saved.source && mode === (this.saved.gatewayMode ?? 'live') && (source === 'gateway' || !key || key === this.saved.selectedKey)) return;
    this.researchAbort?.abort(); this.briefAbort?.abort(); const revision = ++this.generation, previousSync = this.syncFlight;
    this.saved.source = source; this.saved.gatewayMode = mode; this.saved.selectedKey = source === 'gateway' ? undefined : key;
    this.quotes = []; this.evidence = []; this.nextEvidence = 0; this.nextSync = 0; this.nextGatewayAttempt = 0; this.connectionDetail = '';
    await this.persist();
    if (source === 'mcp') void (async () => {
      await previousSync;
      if (revision === this.generation && !this.disposed) await this.sync();
    })().catch(() => {});
  }
  private briefStatus(): DailyBriefStatus {
    const record = this.record(), schedule = briefSchedule(new Date());
    const config = accountSchedules(record?.preferences ?? defaults).brief;
    const window = scheduleWindow(config, new Date(), record?.scheduleEffectiveAt?.brief);
    const latest = record?.briefs?.[0], enabled = config.enabled;
    const base = { latest, enabled, nextRunAt: window.nextRunAt, dueSession: schedule.dueSession, calendarSupported: window.calendarSupported };
    if (record?.briefAttempt?.state === 'running') return { ...base, state: 'running', detail: record.briefAttempt.detail ?? '正在收集持仓相关资料…' };
    if (!record?.grant || !this.model.configured || record.grant.fingerprint !== this.model.fingerprint) return { ...base, state: 'blocked', detail: '请在设置中授权当前模型读取账户后生成简报。' };
    if (!window.calendarSupported) return { ...base, state: 'blocked', detail: '交易日历尚未覆盖当前年份，自动简报暂停。' };
    if (/AI_HTTP_(401|402|403)/.test(record?.briefAttempt?.error ?? '')) return { ...base, nextRunAt: null, state: 'blocked', detail: `模型鉴权或额度不可用，自动简报暂停；请核对 API 配置后手动生成以恢复。${record!.briefAttempt!.error!.match(/AI_HTTP_\d+/)?.[0] ?? ''}` };
    if (record.briefAttempt?.state === 'failed') return { ...base, state: 'failed', detail: record.briefAttempt.error ?? '本期生成失败，保留上期简报，可手动重试。' };
    if (!['ready','empty'].includes(record.snapshot.state) || Date.now() - Date.parse(record.snapshot.asOf ?? '') > 180000) return { ...base, state: 'blocked', detail: '等待账户重新同步，保留已有简报。' };
    if (record.usage.filter(u => newYorkClock(new Date(u.at)).date === newYorkClock(new Date()).date).length >= record.preferences.maxAiCalls) return { ...base, state: 'blocked', detail: '今日 AI 调用已达上限；自动简报等待预算恢复。' };
    if (!enabled) return { ...base, state: 'disabled', detail: '自动简报已关闭，仍可手动生成。' };
    return { ...base, state: latest ? 'ready' : 'waiting', detail: latest ? '已有账户简报，按设置的时间更新。' : '等待定时生成账户简报，也可现在生成。' };
  }
  async generateBrief(automatic = false, scheduleKey?: string) {
    this.assertAvailable();
    if (this.activeBrief) throw new Error('今日简报正在生成');
    const record = this.record(), snapshot = record?.snapshot;
    const asOf = Date.parse(snapshot?.asOf ?? '');
    if (!record || !snapshot || snapshot.testData || !['ready','empty'].includes(snapshot.state) || snapshot.connection !== 'connected' || !Number.isFinite(asOf) || Date.now() - asOf > 180000 || asOf > Date.now() + 60000) throw new Error('请先同步最新真实账户');
    const generation = this.generation, key = snapshot.accountKey;
    const model = await this.ai.status(true);
    if (!model.configured || record.grant?.fingerprint !== model.fingerprint) throw new Error('请先在设置中开启当前模型的账户分析');
    if (this.activeBrief) throw new Error('今日简报正在生成');
    if (this.disposed || generation !== this.generation || this.saved.selectedKey !== key) throw new Error('账户已变化，请重新生成');
    if (Date.now() - asOf > 180000) throw new Error('请先同步最新真实账户');
    const schedule = briefSchedule(new Date()), sessionDate = schedule.dueSession;
    if (automatic && !scheduleKey && (!accountSchedules(record.preferences).brief.enabled || !sessionDate || !schedule.calendarSupported || record.briefAttempt?.sessionDate === sessionDate || record.briefs?.some(b => b.sessionDate === sessionDate))) throw new Error('本期已处理或自动简报尚未到期');
    if (scheduleKey && (!record.scheduleRuns?.[scheduleKey] || !accountSchedules(record.preferences).brief.enabled)) throw new Error('定时任务已关闭或未登记');
    const today = newYorkClock(new Date()).date;
    if (record.usage.filter(u => newYorkClock(new Date(u.at)).date === today).length >= record.preferences.maxAiCalls) throw new Error('今日 AI 调用已达上限');
    const frozen = structuredClone(snapshot), preferences = structuredClone(record.preferences), previous = structuredClone(record.briefs?.[0]);
    const attempt: BriefAttempt = { id: randomUUID(), sessionDate, state: 'running', startedAt: new Date().toISOString(), detail: '正在扫描全部持仓的新闻、财报、估值与事件日历…' };
    record.briefAttempt = attempt;
    const controller = new AbortController(); this.briefAbort = controller;
    let release!: () => void; this.activeBrief = new Promise<void>(r => { release = r; });
    const timeout = setTimeout(() => controller.abort('timeout'), 900000);
    const allowed = () => !this.disposed && !controller.signal.aborted && generation === this.generation && this.saved.selectedKey === key && record.grant?.fingerprint === model.fingerprint;
    try { await this.persist(); } catch (e) { clearTimeout(timeout); attempt.state = 'failed'; this.briefAbort = undefined; this.activeBrief = undefined; release(); throw e; }
    void (async () => {
      try {
        if (!allowed()) throw new Error('BRIEF_CANCELLED');
        const fallbackEvidence = await readBriefProfileFallback(this.directory, attempt.startedAt);
        const research = await prepareBriefResearch(frozen, {
          tool: (name, args, signal) => this.ai.tool(name, args, signal),
          progress: async detail => { if (!allowed()) throw new Error('BRIEF_CANCELLED'); attempt.detail = detail; await this.persist(); },
        }, controller.signal, { analysisAsOf: attempt.startedAt, previousAsOf: previous?.analysisAsOf ?? previous?.generatedAt, fallbackEvidence });
        if (!allowed() || (await this.ai.status(true)).fingerprint !== model.fingerprint) throw new Error('BRIEF_CANCELLED');
        const input = briefInput(frozen, preferences, sessionDate, research, previous, record.performance), prompt = briefPrompt(input);
        const prepared = { id: attempt.id, promptVersion: BRIEF_PROMPT_VERSION, generationMode: 'text', snapshot: frozen, snapshotHash: digest(frozen), input, prompt, model, research };
        // Keep reviewable materials even if the provider fails or returns invalid content.
        await atomicJson(path.join(this.directory, `${attempt.id}.brief-attempt.json`), prepared);
        const callDate = newYorkClock(new Date()).date;
        if (record.usage.filter(u => newYorkClock(new Date(u.at)).date === callDate).length >= record.preferences.maxAiCalls) throw new Error('BRIEF_BUDGET_EXHAUSTED');
        record.usage.push({ at: new Date().toISOString(), kind: automatic ? 'daily-brief' : 'manual-brief' });
        attempt.detail = `已读取 ${input.research?.evidence.length ?? 0} 份资料，正在一次性分析完整账户…`;
        await this.persist();
        if (!allowed()) throw new Error('BRIEF_CANCELLED');
        const result = await this.ai.analyze(prompt, model, controller.signal, 'text');
        if (!allowed() || (await this.ai.status(true)).fingerprint !== model.fingerprint) throw new Error('BRIEF_CANCELLED');
        await atomicJson(path.join(this.directory, `${attempt.id}.brief-attempt.json`), { ...prepared, raw: result.text, finishReason: result.finishReason, usage: result.usage });
        if (!result.text?.trim()) throw new Error('BRIEF_OUTPUT_EMPTY');
        if (['length', 'max_tokens'].includes(result.finishReason ?? '')) throw new Error('BRIEF_OUTPUT_TRUNCATED');
        const content = validateBrief(result.text, input);
        const brief: DailyBrief = { id: attempt.id, accountKey: key, snapshotId: frozen.snapshotId, snapshotHash: digest(frozen), snapshotAsOf: frozen.asOf, sessionDate, analysisAsOf: input.analysisAsOf, generatedAt: new Date().toISOString(), provider: model.provider, model: model.model, promptVersion: BRIEF_PROMPT_VERSION, content, facts: input.facts, evidence: input.research?.evidence, coverage: research.coverage, researchGaps: research.gaps };
        await atomicJson(path.join(this.directory, `${brief.id}.brief.json`), { ...brief, snapshot: frozen, input, prompt, raw: result.text });
        if (!allowed()) throw new Error('BRIEF_CANCELLED');
        record.briefs = [brief, ...(record.briefs ?? [])].slice(0, 30); attempt.state = 'completed';
      } catch (e) {
        attempt.state = 'failed';
        const code = e instanceof Error ? e.message : '';
        attempt.error = !allowed() ? controller.signal.reason === 'timeout' ? '简报生成超时；已保存资料，本期不重复自动调用。' : '账户或授权已变化，简报已取消。' : code.startsWith('BRIEF_') || e instanceof z.ZodError || e instanceof SyntaxError ? `简报结构、数字或原文引用未通过校验；资料与输出已保存，保留上期内容。${/^BRIEF_[A-Z_]+$/.test(code) ? `（${code}）` : ''}` : `研究或模型服务暂不可用；保留上期简报，可手动重试。${/^AI_[A-Z0-9_]+$/.test(code) ? `（${code}）` : ''}`;
      } finally {
        clearTimeout(timeout); this.briefAbort = undefined;
        await this.persist().catch(() => { this.storageError = '本地简报保存失败，自动任务暂停'; });
        this.activeBrief = undefined; release();
      }
    })();
    return { id: attempt.id, state: attempt.state };
  }
  async recoverBrief() {
    this.assertAvailable();
    const record = this.record(), attempt = record?.briefAttempt;
    if (!record || !attempt || !['failed', 'completed'].includes(attempt.state)) throw new Error('没有可恢复的简报');
    const model = await this.ai.status(true);
    if (!model.configured || record.grant?.fingerprint !== model.fingerprint) throw new Error('请先在设置中开启当前模型的账户分析');
    const filename = path.join(this.directory, `${attempt.id}.brief-attempt.json`);
    let saved: any;
    try { saved = JSON.parse(await readFile(filename, 'utf8')); } catch { throw new Error('未找到可恢复的本地简报资料'); }
    if (saved?.promptVersion !== BRIEF_PROMPT_VERSION || typeof saved?.raw !== 'string' || !saved?.input || saved?.snapshot?.accountKey !== record.snapshot.accountKey) throw new Error('本地简报资料与当前账户或版本不匹配');
    const content = validateBrief(saved.raw, saved.input);
    const brief: DailyBrief = { id: attempt.id, accountKey: record.snapshot.accountKey, snapshotId: String(saved.snapshot?.snapshotId ?? record.snapshot.snapshotId), snapshotHash: String(saved.snapshotHash ?? digest(saved.snapshot)), snapshotAsOf: saved.snapshot?.asOf ?? null, sessionDate: attempt.sessionDate, analysisAsOf: saved.input.analysisAsOf, generatedAt: new Date().toISOString(), provider: model.provider, model: model.model, promptVersion: BRIEF_PROMPT_VERSION, content, facts: saved.input.facts, evidence: saved.input.research?.evidence, coverage: saved.research?.coverage ?? saved.input.research?.coverage, researchGaps: saved.research?.gaps ?? saved.input.research?.gaps };
    await atomicJson(path.join(this.directory, `${brief.id}.brief.json`), { ...brief, snapshot: saved.snapshot, input: saved.input, prompt: saved.prompt, raw: saved.raw, recovered: true });
    record.briefs = [brief, ...(record.briefs ?? []).filter(item => item.id !== brief.id)].slice(0, 30);
    record.briefAttempt = { ...attempt, state: 'completed', detail: '已从本地生成结果重新发布；未再次调用模型。' };
    delete record.briefAttempt.error;
    await this.persist();
    return { id: brief.id, state: 'completed', recovered: true };
  }

  async preferences(preferences: Preferences) {
    const record = this.record(); if (!record) throw new Error('请先连接账户');
    const next = preferencesSchema.parse(preferences), before = accountSchedules(record.preferences), after = accountSchedules(next);
    record.scheduleEffectiveAt ??= {};
    if (JSON.stringify(before.analysis) !== JSON.stringify(after.analysis)) record.scheduleEffectiveAt.analysis = new Date().toISOString();
    next.daily = false;
    next.eventAnalysis = false;
    next.maxAutomatic = 0;
    if (next.schedules) next.schedules = { ...next.schedules, brief: { ...next.schedules.brief, enabled: false } };
    if (next.benchmark !== record.preferences.benchmark) record.performance = undefined;
    record.preferences = next; await this.persist();
  }
  async grant(enabled: boolean, fingerprint?: string) {
    const record = this.record(); if (!record) throw new Error('请先连接账户');
    if (!enabled) { this.researchAbort?.abort(); this.briefAbort?.abort(); record.grant = undefined; await this.persist(); return; }
    const model = await this.ai.status(true);
    if (!model.configured || fingerprint !== model.fingerprint) throw new Error('模型已变化或未配置，请刷新后重新核对');
    record.grant = { fingerprint: model.fingerprint, at: new Date().toISOString() }; await this.persist();
  }
  async alert(id: string, action: 'read' | 'resolve' | 'watch') { const record = this.record(); const alert = record?.alerts.find(a => a.id === id); if (!alert) throw new Error('提醒不存在'); if (action === 'watch') alert.watched = !alert.watched; else if (action === 'read') alert.read = true; else { alert.read = true; alert.resolved = true; } await this.persist(); }
  async analyze(kind: AnalysisReport['kind'], question?: string, dateKey?: string, resumeId?: string, reuseId?: string, revalidateStored=false) {
    this.assertAvailable(); if(this.activeAnalysis) throw new Error('已有分析正在运行');
    const record=this.record(), snapshot=record?.snapshot;
    if(!record||!snapshot||snapshot.testData||!['ready','empty'].includes(snapshot.state)||Date.now()-Date.parse(snapshot.asOf??'')>180000)throw new Error('请先同步最新真实账户');
    const model=await this.ai.status(true);
    if(!model.configured||record.grant?.fingerprint!==model.fingerprint)throw new Error('请先在设置中开启当前模型的账户分析');
    if(this.activeAnalysis)throw new Error('已有分析正在运行');
    const today=newYorkClock(new Date()).date;
    if(!revalidateStored&&record.usage.filter(u=>newYorkClock(new Date(u.at)).date===today).length>=record.preferences.maxAiCalls)throw new Error('今日 AI 调用已达上限');
    const events=record.jobs.filter(j=>j.kind==='event'&&newYorkClock(new Date(j.startedAt)).date===today);
    if(kind==='event'&&!resumeId&&(events.length>=record.preferences.maxAutomatic||events.some(j=>Date.now()-Date.parse(j.startedAt)<record.preferences.cooldownMinutes*60000)))throw new Error('事件分析处于冷却期或已达上限');
    record.research??={};
    const prior=resumeId?record.jobs.find(j=>j.id===resumeId):undefined;
    const checkpoint=resumeId?record.research[resumeId]:createResearch(snapshot,record.preferences,this.quotes,model,kind==='manual'||kind==='chat',record.alerts.filter(a=>!a.resolved).flatMap(a=>a.symbols),question);
    if(!checkpoint||resumeId&&!prior)throw new Error('该任务没有可恢复的阶段资料');
    if(reuseId){
      const previous=record.research[reuseId];
      if(resumeId||!previous||previous.snapshot.accountKey!==snapshot.accountKey)throw new Error('该账户没有可复用的研究资料');
      if(Date.now()-Date.parse(previous.progress.startedAt)>86400000)throw new Error('已保存资料超过一天，请生成新分析以更新研究资料');
      checkpoint.evidence=structuredClone(previous.evidence);
      checkpoint.materialsPrepared=true;checkpoint.reusedFrom=reuseId;
      const failedOutput=previous.failures?.portfolio;
      if(previous.outputMode==='text'||failedOutput&&!failedOutput.text.trim())checkpoint.outputMode='text';
      for(const h of checkpoint.snapshot.positions){const old=previous.snapshot.positions.find(p=>p.conId===h.conId&&p.symbol===h.symbol);if(old){h.name??=old.name;h.sector??=old.sector;h.industry??=old.industry;h.instrumentType??=old.instrumentType;}}
      checkpoint.progress.sources=checkpoint.evidence.filter(e=>e.read).length;
      checkpoint.progress.reads=previous.progress.reads;checkpoint.progress.searches=previous.progress.searches;
      checkpoint.progress.trace=[...structuredClone(previous.progress.trace.filter(t=>!['model','model-once','model-repair','validation'].includes(t.tool))),{at:new Date().toISOString(),tool:'reuse',target:`复用任务 ${reuseId} 的资料；本次使用最新账户快照`,ok:true}];
      checkpoint.progress.gaps=[...previous.progress.gaps];
    }
    if(checkpoint.model.fingerprint!==model.fingerprint)throw new Error('模型已变化，请创建新的研究任务');
    if(prior?.state==='completed')throw new Error('该研究已经完成');
    if(revalidateStored){if(!resumeId||!checkpoint.failures?.portfolio?.text)throw new Error('没有可重新校验的模型输出');checkpoint.revalidateStored=true;checkpoint.materialsPrepared=true;}
    if(resumeId&&checkpoint.progress.modelCalls>0&&!revalidateStored)throw new Error('本次单次分析已经调用过模型，请重新发起一份分析');
    const job:AnalysisJob=prior??{id:randomUUID(),kind,state:'running',startedAt:new Date().toISOString()};
    checkpoint.dateKey??=dateKey;dateKey=checkpoint.dateKey;
    if(!checkpoint.performance&&record.performance?.benchmark===(checkpoint.preferences.benchmark??'SPY'))checkpoint.performance=structuredClone(record.performance);
    job.state='running';job.error=undefined;job.failureCategory=undefined;job.progress=checkpoint.progress;
    if(!prior){record.jobs.unshift(job);record.jobs=record.jobs.slice(0,50);}
    record.research[job.id]=checkpoint;const retained=new Set(record.jobs.map(j=>j.id));for(const id of Object.keys(record.research))if(!retained.has(id))delete record.research[id];
    if(kind==='daily'&&dateKey)record.dailyAttempt={date:dateKey,at:Date.now()};
    const controller=new AbortController();this.researchAbort=controller;
    const timeout=setTimeout(()=>controller.abort('timeout'),checkpoint.deep?900000:300000);
    let release!:()=>void;this.activeAnalysis=new Promise<void>(r=>{release=r;});
    try{await this.persist();}catch(e){clearTimeout(timeout);this.activeAnalysis=undefined;release();throw e;}
    void(async()=>{try{
      const content=await runResearch(checkpoint,{
        tool:(name,args,signal)=>this.ai.tool(name,args,signal),
        model:(prompt,signal)=>this.ai.analyze(prompt,model,signal,checkpoint.outputMode),
        save:()=>this.persist(),
        reserve:async()=>{
          if(revalidateStored)throw new Error('重新校验不能调用模型');
          if(this.disposed||controller.signal.aborted||record.grant?.fingerprint!==model.fingerprint||this.saved.selectedKey!==snapshot.accountKey)throw new Error('RESEARCH_CANCELLED');
          const overBudget=record.usage.filter(u=>newYorkClock(new Date(u.at)).date===newYorkClock(new Date()).date).length>=record.preferences.maxAiCalls;
          if(overBudget)throw new Error('RESEARCH_BUDGET');
          record.usage.push({at:new Date().toISOString(),kind});await this.persist();
        }
      },controller.signal);
      if(controller.signal.aborted||record.grant?.fingerprint!==model.fingerprint)throw new Error('RESEARCH_CANCELLED');
      const frozen=checkpoint.snapshot;
      const report:AnalysisReport={id:randomUUID(),version:2,accountKey:frozen.accountKey,snapshotId:frozen.snapshotId,snapshotHash:digest(frozen),generatedAt:new Date().toISOString(),provider:model.provider,model:model.model,kind,question:checkpoint.question,dateKey,evidence:checkpoint.evidence,quotes:checkpoint.quotes,snapshot:frozen,content,research:structuredClone(checkpoint.progress),metrics:portfolioMetrics(frozen,checkpoint.preferences.cashFloor,checkpoint.preferences.targetWeight)};
      await atomicJson(path.join(this.directory,`${report.id}.report.json`),report);
      record.reports.unshift(report);record.reports=record.reports.slice(0,20);job.state='completed';job.reportId=report.id;
      if(kind==='daily')record.lastDaily=dateKey;
      for(const type of ['risk','opportunity'] as const)for(const detail of (type==='risk'?content.risks:content.opportunities).slice(0,3)){
        const symbols=frozen.positions.filter(h=>detail.includes(h.symbol)).map(h=>h.symbol);const action=content.actions.find(a=>symbols.includes(a.symbol));const ids=action?.evidenceIds??content.evidenceIds??[];const key=`ai:${type}:${digest([symbols.sort(),[...ids].sort()]).slice(0,20)}`;const existing=record.alerts.find(a=>a.key===key);if(existing){existing.detail=detail;existing.reportId=report.id;continue;}
        record.alerts.unshift({id:randomUUID(),key,kind:type,title:detail.split(/[。；：]/)[0].slice(0,42),detail,symbols:frozen.positions.filter(h=>detail.includes(h.symbol)).map(h=>h.symbol),createdAt:report.generatedAt,read:false,resolved:false,reportId:report.id,evidenceIds:ids,trigger:action?.trigger,invalidation:action?.invalidation});
      }
    }catch(e){const code=controller.signal.reason==='timeout'?'RESEARCH_TIMEOUT':e instanceof Error?e.message:'RESEARCH_FAILED';job.failureCategory=code.split(':')[0];job.state=code==='RESEARCH_CANCELLED'?'cancelled':checkpoint.progress.modelCalls>0?'failed':'partial';job.error=researchFailure(job.failureCategory)+(job.failureCategory==='OUTPUT_EVIDENCE'&&code.includes(':')?`：${code.slice(code.indexOf(':')+1).trim().slice(0,160)}`:'');}
    finally{clearTimeout(timeout);this.researchAbort=undefined;await this.persist().catch(()=>{this.storageError='本地研究状态保存失败';});this.activeAnalysis=undefined;release();}})();return job;
  }
  async cancel(id:string){const record=this.record(), job=record?.jobs.find(j=>j.id===id), brief=record?.briefAttempt;if(job?.state==='running'){this.researchAbort?.abort('user');await this.activeAnalysis;return;}if(brief?.id===id&&brief.state==='running'){this.briefAbort?.abort('user');await this.activeBrief;return;}throw new Error('任务没有运行');}
  async research(id:string){const checkpoint=this.record()?.research?.[id];if(!checkpoint)throw new Error('阶段资料不存在');return {progress:checkpoint.progress,evidence:checkpoint.evidence,sections:checkpoint.sections};}
  async savePlan(data:unknown){const record=this.record();if(!record)throw new Error('请先连接账户');const value=planSchema.parse(data);if(value.id&&!record.plans?.some(p=>p.id===value.id))throw new Error('计划不属于当前账户');if(value.reportId&&!(await this.report(value.reportId)))throw new Error('关联报告不存在');if(['watching','triggered'].includes(value.status))simulatePlan(record.snapshot,value.steps,record.preferences.cashFloor);const old=record.plans?.find(p=>p.id===value.id);const plan:AdjustmentPlan={...value,id:value.id??randomUUID(),createdAt:old?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString(),snapshotId:record.snapshot.snapshotId};record.plans=[plan,...(record.plans??[]).filter(p=>p.id!==plan.id)].slice(0,100);await this.persist();return plan;}
  simulate(data:any){const record=this.record();if(!record||record.snapshot.state==='stale')throw new Error('请先同步账户');const value=planSchema.parse(data.plan);return simulatePlan(record.snapshot,value.steps,record.preferences.cashFloor,data.shock??-.1);}
  async performance(){
    const record=this.record();if(!record)throw new Error('请先连接账户');
    if(this.performanceFlight)return this.performanceFlight;
    const source=this.saved.source,gatewayMode=this.saved.gatewayMode??'live';
    if(source==='gateway'){
      const result=gatewayPerformance(record.history??[],record.snapshot.baseCurrency,gatewayMode);
      result.fetchedAt=new Date().toISOString();record.performance=result;await this.persist();return result;
    }
    if(record.performance?.inception&&record.performance.fetchedAt&&Date.now()-Date.parse(record.performance.fetchedAt)<900000&&record.performance.source==='IBKR PortfolioAnalyst')return record.performance;
    this.performanceFlight=(async()=>{
      let result=localPerformance(record.history??[],record.snapshot.baseCurrency);
      try{
        const raw=await this.mcp.performance(record.snapshot.accountKey);const data=raw.data;
        result=normalizePerformance(data,raw.description??'',record.snapshot.baseCurrency);
      }catch{result.source='MCP 当前账户 · 本地净值快照';result.note+=' PortfolioAnalyst 历史暂不可用；请检查 MCP 授权，当前仅保留由 MCP 同步得到的本地净值快照。';}
      const benchmark=record.preferences.benchmark??'SPY';result.benchmark=benchmark;
      if(benchmark!=='none'&&result.returnMethod)try{const bm=await this.ai.tool('benchmark',{symbol:benchmark});if(bm.adjusted&&bm.currency===result.currency){result=comparePerformance(result,bm.rows,benchmark);result.benchmarkSource=bm.source;result.benchmarkFetchedAt=new Date().toISOString();}}catch{result.note+=' 基准来源暂不可用。';}
      result.fetchedAt=new Date().toISOString();record.performance=result;await this.persist();return result;
    })();try{return await this.performanceFlight;}finally{this.performanceFlight=undefined;}
  }
  async disconnect() {
    this.researchAbort?.abort(); this.briefAbort?.abort(); ++this.generation; await this.syncFlight;
    const source = this.saved.source, record = this.record();
    if (record) { record.grant = undefined; record.snapshot = { ...record.snapshot, state: 'stale', connection: 'disconnected', detail: '账户已断开。' }; }
    if (source === 'mcp') await this.mcp.disconnect();
    else { this.activeGatewayBridgePort = undefined; this.nextGatewayAttempt = 0; this.connectionDetail = '本地账户连接已断开。'; }
    this.saved.selectedKey = undefined; this.quotes = []; this.evidence = []; this.nextSync = 0;
    await this.persist();
  }
  async report(id: string) { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('无效报告标识'); const report = JSON.parse(await readFile(path.join(this.directory, `${id}.report.json`), 'utf8')) as AnalysisReport; if (report.accountKey !== this.saved.selectedKey) throw new Error('报告不属于当前账户'); return report; }
  async close() { this.disposed = true; this.researchAbort?.abort(); this.briefAbort?.abort(); ++this.generation; if (this.timer) clearTimeout(this.timer); this.ai.close(); await this.syncFlight; await this.performanceFlight?.catch(()=>{}); await Promise.all([this.activeAnalysis, this.activeBrief]); await this.writeQueue; await this.mcp.close(); if (this.ownsLease) { this.ownsLease = false; await unlink(path.join(this.directory, 'worker.lock')).catch(() => {}); } }
}

const htmlEscape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function reportHtml(markdown:string){
 const inline=(value:string)=>htmlEscape(value).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,(_all,label,url)=>`<a href="${url}" rel="noreferrer">${label}</a>`).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
 const content=markdown.split('\n\n').map(block=>block.startsWith('### ')?`<h3>${inline(block.slice(4))}</h3>`:block.startsWith('## ')?`<h2>${inline(block.slice(3))}</h2>`:block.startsWith('# ')?`<h1>${inline(block.slice(2))}</h1>`:block.startsWith('> ')?`<blockquote>${inline(block.slice(2))}</blockquote>`:block.startsWith('- ')?`<ul>${block.split('\n').map(line=>`<li>${inline(line.replace(/^- /,''))}</li>`).join('')}</ul>`:`<p>${inline(block)}</p>`).join('\n');
 return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><title>SparkFlow · 投资组合研究</title><style>body{background:#050a09;color:#dcebe1;font:15px/1.9 system-ui;max-width:960px;margin:50px auto;padding:24px;overflow-wrap:anywhere}h1{font-size:32px;color:#eff8f2}h2{border-top:1px solid #20352d;padding-top:26px;margin-top:35px;color:#70dcba}h3{color:#b5ddc4;margin-top:26px}p,li{white-space:pre-wrap}a{color:#70dcba}blockquote{border-left:2px solid #53755f;padding:12px 20px;color:#9eb5a6;background:#0b1411}ul{padding-left:22px}@media print{body{background:white;color:#18271e;margin:0;font-size:11pt}h1,h2,h3,a{color:#193e2b}h2,h3{break-after:avoid}blockquote{background:#eff4ef}}</style>${content}</html>`;
}
async function body(req: IncomingMessage, maxBytes = 32000) { if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('只接受 JSON 请求'); let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > maxBytes) throw new Error('请求过大'); } return JSON.parse(text); }
export function ibkrWorkbenchPlugin(options: { fetchJson: JsonFetcher; fetchLogoScan?: (tickers: string[]) => Promise<unknown>; fetchProfileScan?: ProfileBatchFetcher; fetchLogoImage?: (url: string) => Promise<Uint8Array>; stateDir?: string }): Plugin {
  let service: IbkrWorkbenchService | undefined;
  const install = (server: any) => {
    const port = () => { const address = server.httpServer?.address(); return address && typeof address !== 'string' ? address.port : 0; };
    const root = server.config.root;
    const logoImages = new CompanyLogoImages(options.fetchLogoImage ?? (async () => { throw new Error('Logo download unavailable'); }));
    const logos = new CompanyLogos(options.fetchLogoScan ?? (async () => ({ data: [] })), file => access(path.join(root, 'public/stock-logos', file)).then(() => true, () => false));
    service = new IbkrWorkbenchService(root, options.stateDir ?? path.join(root, '.sparkflow/ibkr-workbench'), options.fetchJson, async pathname => {
      const response = await fetch(`http://127.0.0.1:${port()}${pathname}`, { signal: AbortSignal.timeout(30000) }); if (!response.ok) throw new Error('背景数据暂不可用'); return response.json();
    }, options.fetchProfileScan);
    const instance = service; const ready = instance.start();
    server.httpServer?.once('close', () => void instance.close());
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (!req.url?.startsWith('/api/ibkr-workbench/')) return next();
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(req.url, `http://127.0.0.1:${port()}`); const endpoint = url.pathname.slice('/api/ibkr-workbench/'.length);
      const json = (value: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
      // Only OAuth callback may originate from the external IBKR login page; PKCE + expiring state bind it.
      const callback = endpoint === 'oauth/callback' && req.method === 'GET' && req.headers.host === `127.0.0.1:${port()}`;
      if (!callback && !allowedLocalRequest(req.headers, port())) return json({ error: '仅允许本机同源访问' }, 403);
      try {
        if (req.method === 'GET' && endpoint === 'logo') {
          const instrument = z.object({ symbol: z.string().max(20), currency: z.string().max(3), assetType: z.string().max(8), exchange: z.string().max(20) }).parse(Object.fromEntries(url.searchParams));
          const logo = await logos.resolve(instrument);
          res.setHeader('Cache-Control', logo.src ? 'private, max-age=86400' : 'private, max-age=60');
          if (logo.src?.startsWith('https:')) {
            if (url.searchParams.get('image') === '1') {
              const bytes = await logoImages.get(logo.src);
              res.setHeader('Content-Type', 'image/svg+xml');
              res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
              res.end(Buffer.from(bytes)); return;
            }
            url.searchParams.set('image', '1');
            return json({ ...logo, src: url.pathname + url.search });
          }
          return json(logo);
        }
        await ready;
        if (callback) {
          let error: string | undefined;
          try { instance.assertAvailable(); await instance.mcp.callback(url.searchParams.get('state') ?? '', url.searchParams.get('code') ?? ''); await instance.sync(); }
          catch (e) { error = e instanceof Error ? e.message : 'MCP_OAUTH_CALLBACK_FAILED'; }
          const current = await instance.state();
          const synced = !error && current.connection.state === 'connected' && ['ready', 'empty'].includes(current.snapshot.state);
          res.statusCode = error ? 400 : 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
          res.end(oauthCallbackPage(Boolean(current.connection.authorized), synced, error)); return;
        }
        if (req.method === 'GET' && endpoint === 'state') return json(await instance.state());
        if (req.method === 'GET' && endpoint === 'paper/status') return json(await instance.paperRequest('status'));
        if (req.method === 'GET' && endpoint === 'backtests/strategies') return json(await instance.backtestRequest('strategies'));
        if (req.method === 'GET' && endpoint === 'backtests/runs') return json(await instance.backtestRequest('runs'));
        if (req.method === 'GET' && endpoint === 'backtests/jobs') return json(await instance.backtestRequest('jobs'));
        if (req.method === 'GET' && endpoint === 'backtests/result') return json(await instance.backtestRequest('result', { runHash: url.searchParams.get('runHash') }));
        if (req.method === 'GET' && endpoint === 'backtests/package') return json(await instance.backtestRequest('package', { runHash: url.searchParams.get('runHash') }));
        if (req.method === 'GET' && endpoint === 'performance') return json(await instance.performance());
        if(req.method==='GET'&&endpoint.startsWith('research/')) return json(await instance.research(endpoint.slice(9)));
        if (req.method === 'GET' && endpoint === 'quotes') return json(await instance.refreshQuotes());
        if (req.method === 'GET' && endpoint === 'history') { const state = await instance.state(); const quote = state.quotes.find(q => q.conId === Number(url.searchParams.get('conId'))); if (!quote) throw new Error('合约尚未匹配行情'); return json(await instance.market.history(quote, url.searchParams.get('period') ?? '1M')); }
        if (req.method === 'GET' && /^reports\/[0-9a-f-]{36}\/(json|markdown|html)$/.test(endpoint)) {
          const [, id, format] = endpoint.split('/'); const report = await instance.report(id); const markdown = reportMarkdown(report);
          res.setHeader('Content-Disposition', `attachment; filename="ibkr-${id}.${format === 'markdown' ? 'md' : format}"`);
          res.setHeader('Content-Type', format === 'html' ? 'text/html; charset=utf-8' : format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8');
          res.end(format === 'json' ? JSON.stringify(report, null, 2) : format === 'markdown' ? markdown : reportHtml(markdown)); return;
        }
        if (req.method !== 'POST') return json({ error: '接口不存在' }, 404);
        instance.assertAvailable();
        const data = await body(req, endpoint === 'backtests/run' ? 4 * 1024 * 1024 : 32000);
        if (endpoint === 'connect') return json(await instance.mcp.begin(`http://127.0.0.1:${port()}`));
        if (endpoint === 'disconnect') { await instance.disconnect(); return json({ ok: true, detail: instance.mcp.detail }); }
        if (endpoint === 'source') { const value = z.object({ source: z.enum(['mcp', 'gateway']), gatewayMode: z.enum(['live', 'paper']).optional(), accountKey: z.string().regex(/^live:[a-zA-Z0-9:_-]+$/).optional() }).strict().parse(data); await instance.select(value.source, value.accountKey, value.gatewayMode); return json({ ok: true }); }
        if (endpoint === 'gateway-connect') { await instance.connectGateway(); return json(await instance.state()); }
        if (endpoint === 'paper/contract') return json(await instance.paperRequest('contract', data));
        if (endpoint === 'paper/search') return json(await instance.paperSearch(data));
        if (endpoint === 'paper/quote') return json(await instance.paperRequest('quote', data));
        if (endpoint === 'paper/market-quote') return json(await instance.paperMarketQuote(data));
        if (endpoint === 'paper/history') return json(await instance.paperHistory(data));
        if (endpoint === 'paper/transport') return json(await instance.paperRequest('transport', data));
        if (endpoint === 'paper/configure') return json(await instance.paperRequest('configure', data));
        if (endpoint === 'paper/preview') return json(await instance.paperRequest('preview', data));
        if (endpoint === 'paper/confirm') return json(await instance.paperRequest('confirm', data));
        if (endpoint === 'paper/cancel') return json(await instance.paperRequest('cancel', data));
        if (endpoint === 'paper/reconcile') return json(await instance.paperRequest('reconcile', data));
        if (endpoint === 'paper/stop') return json(await instance.paperRequest('stop', data));
        if (endpoint === 'backtests/strategies') return json(await instance.backtestRequest('save-strategy', data));
        if (endpoint === 'backtests/run') return json(await instance.backtestRequest('run', data), 202);
        if (endpoint === 'backtests/cancel') return json(await instance.backtestRequest('cancel', data));
        if (endpoint === 'sync') { await instance.sync(); return json(await instance.state()); }
        if (endpoint === 'preferences') { await instance.preferences(preferencesSchema.parse(data)); return json({ ok: true }); }
        if (endpoint === 'consent') { const v = z.object({ enabled: z.boolean(), fingerprint: z.string().optional() }).strict().parse(data); await instance.grant(v.enabled, v.fingerprint); return json({ ok: true }); }
        if (endpoint === 'alerts') { const v = z.object({ id: z.string().uuid(), action: z.enum(['read', 'resolve','watch']) }).strict().parse(data); await instance.alert(v.id, v.action); return json({ ok: true }); }
        if(endpoint==='plans')return json(await instance.savePlan(data));
        if(endpoint==='simulate')return json(instance.simulate(data));
        if(endpoint==='cancel'){await instance.cancel(z.object({id:z.string().uuid()}).parse(data).id);return json({ok:true});}
        if(endpoint==='resume'){const {id}=z.object({id:z.string().uuid()}).strict().parse(data);const state=await instance.state();const job=state.jobs.find(j=>j.id===id);if(!job)throw new Error('任务不存在');return json(await instance.analyze(job.kind,undefined,undefined,id),202);}
        if(endpoint==='retry'){const {id}=z.object({id:z.string().uuid()}).strict().parse(data);const state=await instance.state();const job=state.jobs.find(j=>j.id===id);if(!job)throw new Error('任务不存在');return json(await instance.analyze('manual',undefined,undefined,undefined,id),202);}
        if(endpoint==='revalidate'){const {id}=z.object({id:z.string().uuid()}).strict().parse(data);const state=await instance.state();const job=state.jobs.find(j=>j.id===id);if(!job)throw new Error('任务不存在');return json(await instance.analyze(job.kind,undefined,undefined,id,undefined,true),202);}
        if (endpoint === 'analyze') { const v = z.object({ question: z.string().max(2000).optional() }).strict().parse(data); return json(await instance.analyze(v.question ? 'chat' : 'manual', v.question), 202); }
        return json({ error: '接口不存在' }, 404);
      } catch (e) { return json({ error: e instanceof z.ZodError ? '请求字段或分析结构无效' : e instanceof Error && e.message.length < 220 ? e.message : '账户工作台暂不可用' }, 400); }
    });
  };
  return { name: 'ibkr-account-workbench', config: () => ({ server: { fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.sparkflow/**'] } } }), configureServer: install, configurePreviewServer: install, closeBundle: async () => { await service?.close(); } };
}
