import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent, fetch } from 'undici';
import type { CustomNewsSubscription, NewsCategory } from '../src/lib/newsTypes';

export function isPublicIpv4(address: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || (b === 0 && [0, 2].includes(c)) || (b === 88 && c === 99)))
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 198 && ([18, 19].includes(b) || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}

export function validateSubscription(input: unknown): CustomNewsSubscription {
  if (!input || typeof input !== 'object') throw new Error('订阅参数无效');
  const data = input as Record<string, unknown>;
  const label = typeof data.label === 'string' ? data.label.trim() : '';
  if (!label || label.length > 60) throw new Error('名称需为 1–60 个字符');
  const url = validateFeedUrl(data.url);
  if (!['tech', 'finance', 'world', 'society', 'livelihood'].includes(String(data.category))) throw new Error('请选择有效分类');
  if (!['domestic', 'foreign'].includes(String(data.origin))) throw new Error('请选择来源地区');
  return { id: 'custom-' + createHash('sha256').update(url.href).digest('hex').slice(0, 16), label,
    url: url.href, category: data.category as NewsCategory, origin: data.origin as 'domestic' | 'foreign' };
}

export function validateFeedUrl(value: unknown) {
  let url: URL;
  try { url = new URL(typeof value === 'string' ? value : ''); } catch { throw new Error('请输入完整 HTTPS RSS/Atom 地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.href.length > 2048) throw new Error('只支持无账号密码、标准端口的公开 HTTPS 订阅');
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan)$/.test(host) || host.includes(':') || (/^[\d.]+$/.test(host) && !isPublicIpv4(host))) throw new Error('不允许本机、内网或特殊用途地址');
  url.hash = '';
  return url;
}

// Custom URLs are untrusted. Pin public IPv4 DNS results on every hop; never send them to the local proxy.
export async function fetchPublicFeed(value: string): Promise<{ text: string; route: 'direct' }> {
  let url = validateFeedUrl(value);
  const signal = AbortSignal.timeout(12_000);
  for (let hop = 0; hop <= 3; hop++) {
    let onAbort: (() => void) | undefined;
    const records = await Promise.race([
      lookup(url.hostname, { family: 4, all: true }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('订阅 DNS 查询超时'));
        if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
      })
    ]).finally(() => { if (onAbort) signal.removeEventListener('abort', onAbort); });
    if (!records.length || records.some((entry) => !isPublicIpv4(entry.address))) throw new Error('订阅解析到内网或特殊用途地址，已拒绝访问');
    const dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (options.all) callback(null, records);
      else callback(null, records[0].address, 4);
    } } });
    try {
      const response = await fetch(url, { dispatcher, signal, redirect: 'manual', headers: { Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml', 'User-Agent': 'SparkFlow/1.0 RSS Reader' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('订阅重定向缺少目标');
        url = validateFeedUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('订阅 HTTP ' + response.status); }
      if (Number(response.headers.get('content-length')) > 2_000_000) { await response.body?.cancel(); throw new Error('订阅响应超过 2 MB'); }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body || []) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error('订阅响应超过 2 MB');
        chunks.push(chunk);
      }
      return { text: Buffer.concat(chunks).toString('utf8'), route: 'direct' };
    } finally { await dispatcher.destroy(); }
  }
  throw new Error('订阅重定向次数过多');
}

export function createSubscriptionStore(filename: string) {
  let queue: Promise<unknown> = Promise.resolve();
  async function list(): Promise<CustomNewsSubscription[]> {
    try {
      const data = JSON.parse(await readFile(filename, 'utf8'));
      if (!Array.isArray(data) || data.length > 20) throw new Error('订阅配置无效');
      return data.map(validateSubscription);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('无法读取自定义订阅配置，请检查 .sparkflow/news-sources.json');
    }
  }
  function modify(update: (current: CustomNewsSubscription[]) => CustomNewsSubscription[]) {
    const task = queue.then(async () => {
      const next = update(await list());
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename + '.tmp', JSON.stringify(next, null, 2), 'utf8');
      await rename(filename + '.tmp', filename);
      return next;
    });
    queue = task.catch(() => undefined);
    return task;
  }
  return { list,
    add: (input: unknown) => {
      const source = validateSubscription(input);
      return modify((current) => {
        if (current.some((entry) => entry.id === source.id)) throw new Error('此订阅地址已添加');
        if (current.length >= 20) throw new Error('最多支持 20 个自定义订阅');
        return [...current, source];
      });
    },
    remove: (id: string) => modify((current) => {
      if (!current.some((entry) => entry.id === id)) throw new Error('未找到该自定义订阅');
      return current.filter((entry) => entry.id !== id);
    })
  };
}
