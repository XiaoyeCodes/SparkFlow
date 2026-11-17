import { cleanNewsText } from './newsFeed.ts';

export function statsListingRss(html: string, listingUrl: string, now = Date.now()) {
  const base = new URL(listingUrl);
  if (base.hostname !== 'www.stats.gov.cn' || !['/sj/zxfb/', '/sj/sjjd/'].includes(base.pathname)) throw new Error('统计局栏目不匹配');
  const seen = new Set<string>();
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const items: string[] = [];
  for (const block of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const anchor = block[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    let url: URL;
    try { url = new URL(anchor[1], base); } catch { continue; }
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || !/\/t\d{8}_\d+\.s?html$/.test(url.pathname)) continue;
    const titleAttribute = anchor[0].match(/\btitle=["']([^"']+)["']/i)?.[1];
    const title = cleanNewsText(titleAttribute || anchor[2]);
    const day = block[1].match(/<span\b[^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>/i)?.[1];
    const timestamp = day ? Date.parse(day + 'T00:00:00+08:00') : NaN;
    if (!title || !Number.isFinite(timestamp) || timestamp > now || seen.has(url.href)) continue;
    seen.add(url.href);
    items.push(`<item><title>${escape(title)}</title><link>${escape(url.href)}</link><pubDate>${new Date(timestamp).toUTCString()}</pubDate></item>`);
  }
  if (!items.length) throw new Error('统计局官方列表未找到带可核验日期的文章');
  return `<rss version="2.0"><channel>${items.slice(0, 30).join('')}</channel></rss>`;
}
