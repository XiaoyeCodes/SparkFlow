import { createHash } from 'node:crypto';
import type { DailyBriefAiSummaryResponse, DailyBriefSnapshot, DailyBriefSummary } from '../src/lib/dailyBriefTypes.ts';
import type { SnapshotStore } from './publicDataCache.ts';

export type BriefAiConfig = {
  provider: string;
  model: string;
  baseUrl: string;
  protocol: 'chat' | 'responses';
  apiKey: string;
  useProxy: boolean;
};

type RecordEntry = { version: 1; key: string; expiresAt: number; result: Omit<DailyBriefAiSummaryResponse, 'cache'> };
const MAX_BYTES = 256 * 1024;
const DAY_MS = 86_400_000;

export function isDailyBriefAiSummary(value: unknown): value is DailyBriefSummary {
  const summary = value as DailyBriefSummary | null;
  const strings = (list: unknown) => Array.isArray(list) && list.every(item => typeof item === 'string');
  return Boolean(summary && typeof summary.headline === 'string' && summary.headline.trim()
    && typeof summary.regime === 'string' && ['calm', 'balanced', 'cautious', 'risk'].includes(summary.tone)
    && strings(summary.highlights) && strings(summary.risks) && strings(summary.watchlist) && strings(summary.portfolioNotes)
    && summary.assessment && Number.isFinite(summary.assessment.score) && summary.assessment.score >= 0 && summary.assessment.score <= 100
    && ['积极', '中性偏积极', '中性', '中性偏谨慎', '谨慎'].includes(summary.assessment.rating)
    && ['低', '中', '高'].includes(summary.assessment.confidence)
    && typeof summary.assessment.rationale === 'string' && typeof summary.assessment.disclaimer === 'string'
    && Array.isArray(summary.assessment.advice) && summary.assessment.advice.length === 5
    && summary.assessment.advice.every(item => typeof item?.label === 'string' && typeof item.detail === 'string' && item.detail.trim()));
}

// An explicit page service, not a generic POST cache. Only the server's current
// non-personalized briefing is eligible; request bodies never supply model input.
export function createDailyBriefAiSummaryCache(options: {
  store: SnapshotStore;
  promptVersion: string;
  generate: (snapshot: DailyBriefSnapshot, config: BriefAiConfig) => Promise<DailyBriefSummary | null>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const memory = new Map<string, RecordEntry>();
  const pending = new Map<string, Promise<RecordEntry>>();
  const failures = new Map<string, { attempts: number; retryAt: number }>();
  let newestKey = '';
  let writes = Promise.resolve();

  const response = (entry: RecordEntry, source: DailyBriefAiSummaryResponse['cache']['source']): DailyBriefAiSummaryResponse => {
    if (entry.expiresAt <= now()) throw new Error('简报版次已过期，请更新后重试');
    return { ...structuredClone(entry.result), cache: { hit: source !== 'generated', source, expiresAt: new Date(entry.expiresAt).toISOString() } };
  };
  const remember = (entry: RecordEntry) => {
    for (const [key, cached] of memory) if (cached.expiresAt <= now()) memory.delete(key);
    memory.delete(entry.key);
    while (memory.size >= 4) memory.delete(memory.keys().next().value!);
    memory.set(entry.key, entry);
  };

  return {
    async get(snapshot: DailyBriefSnapshot, config: BriefAiConfig): Promise<DailyBriefAiSummaryResponse> {
      if (snapshot.portfolio.connected || snapshot.portfolio.positions.length) throw new Error('含个人持仓的简报不进入跨访客摘要缓存');
      const editionStart = Date.parse(`${snapshot.date}T09:00:00+08:00`);
      const expiresAt = editionStart + DAY_MS;
      if (!Number.isFinite(editionStart) || editionStart > now() || expiresAt <= now()
        || !Number.isFinite(Date.parse(snapshot.generatedAt)) || Date.parse(snapshot.generatedAt) > now()) {
        throw new Error('当前简报版次已过期或尚未就绪，请更新简报后重试');
      }
      if (!config.apiKey.trim() || !config.model.trim() || !config.baseUrl.trim()) throw new Error('请先配置 AI 服务');
      // Hash all inputs and effective model settings. No prompt, endpoint, API key,
      // positions or raw market/news inputs are written into the cache record.
      const key = createHash('sha256').update(JSON.stringify({ promptVersion: options.promptVersion,
        date: snapshot.date, slot: snapshot.slot, generatedAt: snapshot.generatedAt, updatedAt: snapshot.updatedAt,
        markets: snapshot.markets, macro: snapshot.macro, news: snapshot.news, summary: snapshot.summary, editorial: snapshot.editorial,
        config: { provider: config.provider, model: config.model.trim(), baseUrl: config.baseUrl.trim(),
          protocol: config.protocol, apiKey: config.apiKey.trim(), useProxy: config.useProxy },
      })).digest('hex');
      const cached = memory.get(key);
      if (cached && cached.expiresAt > now()) { newestKey = key; return response(cached, 'memory'); }
      const active = pending.get(key);
      if (active) { newestKey = key; return response(await active, 'shared'); }
      if ((failures.get(key)?.retryAt ?? 0) > now()) throw new Error('AI 摘要暂不可用，请稍后重试');
      // Bound simultaneous calls even if a host changes models/editions rapidly.
      if (pending.size >= 2) throw new Error('AI 摘要正在生成，请稍后重试');
      newestKey = key;
      let restored = false;
      const task = (async () => {
        try {
          try {
            const raw = await options.store.read('current');
            if (raw && Buffer.byteLength(raw) <= MAX_BYTES) {
              const entry = JSON.parse(raw) as RecordEntry;
              if (entry.version === 1 && entry.key === key && entry.expiresAt === expiresAt && entry.expiresAt > now()
                && entry.result?.provider === config.provider && entry.result.model === config.model
                && Number.isFinite(Date.parse(entry.result.generatedAt)) && Date.parse(entry.result.generatedAt) <= now()
                && entry.result.snapshot?.date === snapshot.date && entry.result.snapshot.slot === snapshot.slot
                && entry.result.snapshot.generatedAt === snapshot.generatedAt && isDailyBriefAiSummary(entry.result.summary)) {
                restored = true;
                remember(entry);
                return entry;
              }
            }
          } catch { /* Corrupt/unreadable disk cache must not block generation. */ }
          const summary = await options.generate(snapshot, config);
          if (!isDailyBriefAiSummary(summary)) throw new Error('模型没有生成有效的每日简报结论');
          if (expiresAt <= now()) throw new Error('摘要生成时简报已换版，请稍后重试');
          const entry: RecordEntry = { version: 1, key, expiresAt, result: {
            summary: structuredClone(summary), provider: config.provider, model: config.model, generatedAt: new Date(now()).toISOString(),
            snapshot: { date: snapshot.date, slot: snapshot.slot, generatedAt: snapshot.generatedAt },
          } };
          const raw = JSON.stringify(entry);
          if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('AI 摘要结果过大');
          remember(entry);
          failures.delete(key);
          // One atomic snapshot file, serialized writes; a late old revision must
          // not overwrite the latest requested edition/model on disk.
          writes = writes.then(async () => {
            if (newestKey === key) await options.store.write('current', raw);
          }).catch(() => undefined);
          await writes;
          return entry;
        } catch {
          const attempts = (failures.get(key)?.attempts ?? 0) + 1;
          failures.delete(key);
          while (failures.size >= 16) failures.delete(failures.keys().next().value!);
          failures.set(key, { attempts, retryAt: now() + Math.min(300_000, 30_000 * 2 ** Math.min(attempts - 1, 4)) });
          throw new Error('AI 摘要暂不可用，请稍后重试');
        }
      })().finally(() => { pending.delete(key); });
      pending.set(key, task);
      return response(await task, restored ? 'disk' : 'generated');
    },
  };
}
