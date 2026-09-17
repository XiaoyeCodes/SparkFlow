// Source discovery and parsers are isolated from Vite so fixtures can verify
// release periods, units and failure behaviour without starting the app.
export type OfficialMetric = {
  id: string; label: string; value: number | null; display: string; period: string;
  source: string; sourceUrl: string; status: 'live' | 'delayed' | 'unavailable';
  change?: number | null; changeDisplay?: string; note?: string;
  history?: Array<{ time: string; value: number }>;
  releasedAt?: string; checkedAt?: string; freshness?: 'checked' | 'cached' | 'unverified';
};
export type OfficialArticle = { title: string; url: string; publishedAt?: string; period: string };
export function createVerifiedMetricMerger(registry: OfficialMetric[]) {
  const lastGood = new Map<string, OfficialMetric>();
  const periodKey = (period: string) => period.replace(/年/g, '-').replace(/月/g, '').replace(/(\d{4})-01[—–-]/, '$1-').replace(/-(\d)(?=$|-)/g, '-0$1');
  return (groups: Array<PromiseSettledResult<OfficialMetric | OfficialMetric[]>>) => {
    const values = new Map<string, OfficialMetric>(registry.map(item => [item.id, {
      id: item.id, label: item.label, source: item.source, sourceUrl: item.sourceUrl,
      value: null, display: '待核验', period: '未取得有效发布', status: 'unavailable', freshness: 'unverified',
    }]));
    for (const [id, item] of lastGood) values.set(id, { ...item, freshness: 'cached', note: `${item.note || ''} 本轮未取得有效新值，保留上次成功核验数据。` });
    const expected = new Set([...registry.map(item => item.id), 'cpi', 'official-pmi']);
    for (const group of groups) {
      if (group.status !== 'fulfilled') continue;
      for (const row of Array.isArray(group.value) ? group.value : [group.value]) {
        if (!expected.has(row.id) || (row.value !== null && !Number.isFinite(row.value))) continue;
        const previous = lastGood.get(row.id);
        if (previous && /^\d{4}-/.test(periodKey(row.period)) && periodKey(row.period) < periodKey(previous.period)) continue;
        const checked = { ...row, checkedAt: new Date().toISOString(), freshness: row.value === null ? 'unverified' as const : 'checked' as const };
        values.set(row.id, checked);
        if (row.value !== null) lastGood.set(row.id, checked);
      }
    }
    return values;
  };
}
type Reader = (url: string) => Promise<string>;
export const officialLists = {
  statistics: 'https://www.stats.gov.cn/sj/zxfb/',
  fiscal: 'https://gks.mof.gov.cn/tongjishuju/',
  lpr: 'https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125440/index.html',
  xinhua: 'https://www.news.cn/fortune/gundong/index.html',
  ndrcTrade: 'https://www.ndrc.gov.cn/wsdwhfz/',
  government: 'https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json',
};

export function alignChinaUsTenYearSpread(
  china: { period: string; value: number | null },
  us: { period: string; value: number },
  maxGapDays = 7,
) {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(china.period) || !isoDate.test(us.period) || china.value === null
    || !Number.isFinite(china.value) || !Number.isFinite(us.value)) return null;
  const chinaTime = Date.parse(`${china.period}T00:00:00Z`);
  const usTime = Date.parse(`${us.period}T00:00:00Z`);
  if (!Number.isFinite(chinaTime) || !Number.isFinite(usTime)) return null;
  const gapDays = Math.round(Math.abs(chinaTime - usTime) / 86_400_000);
  if (gapDays > maxGapDays) return null;
  return { value: (china.value - us.value) * 100, gapDays };
}
export function officialText(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/\s+/g, '').trim();
}
export function officialPeriod(title: string): string {
  const year = title.match(/(20\d{2})年/)?.[1];
  if (!year) return '';
  const cumulative = title.match(/(?:1[—–-]|前)(\d{1,2})(?:个)?月/);
  const month = cumulative?.[1] || title.match(/年(\d{1,2})月/)?.[1]
    || (/上半年/.test(title) ? '6' : /前三季度/.test(title) ? '9' : /一季度/.test(title) ? '3' : '');
  if (!month || +month < 1 || +month > 12) return '';
  return `${year}-${String(+month).padStart(2, '0')}`;
}
function dateFromText(value: string): string | undefined {
  const match = value.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})(?:日)?/);
  if (!match) return undefined;
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return Number.isFinite(Date.parse(day)) ? day : undefined;
}
export function parseOfficialLinks(html: string, baseUrl: string): OfficialArticle[] {
  const seen = new Set<string>();
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match => {
    const title = officialText(match[2]);
    let url: URL;
    try { url = new URL(match[1].replace(/&amp;/g, '&'), baseUrl); } catch { return []; }
    const host = new URL(baseUrl).hostname;
    if (!/^https?:$/.test(url.protocol) || url.hostname !== host || title.length < 8 || title.length > 150 || seen.has(url.href)) return [];
    const liStart = html.lastIndexOf('<li', match.index);
    const liEnd = html.indexOf('</li>', match.index);
    const context = liStart >= 0 && liEnd > match.index! && liEnd - liStart < 5000 ? officialText(html.slice(liStart, liEnd)) : '';
    const pathDate = url.pathname.match(/(?:t|\/)(20\d{2})(\d{2})(\d{2})(?:_|\/|\d)/);
    const date = dateFromText(context) || (pathDate ? `${pathDate[1]}-${pathDate[2]}-${pathDate[3]}` : undefined);
    seen.add(url.href);
    return [{ title, url: url.href, publishedAt: date ? `${date}T00:00:00+08:00` : undefined, period: officialPeriod(title) }];
  });
}
export async function latestOfficialArticle(list: string, pattern: RegExp, read: Reader) {
  const links = parseOfficialLinks(await read(list), list).filter(item => pattern.test(item.title) && item.period)
    .sort((a, b) => b.period.localeCompare(a.period));
  if (!links.length) throw new Error('官方栏目未找到对应月度发布');
  const article = links[0];
  const html = await read(article.url);
  // Publication date is not the YYYYMMDD embedded in a URL (MOF can differ).
  const meta = html.match(/<meta[^>]*name=["'](?:PubDate|publishdate|firstpublishedtime)["'][^>]*content=["']([^"']+)/i)?.[1];
  const releasedAt = dateFromText(meta || '') || article.publishedAt?.slice(0, 10);
  return { ...article, releasedAt, text: officialText(html) };
}
const signed = (direction: string, value?: string) => direction === '持平' ? 0 : Number(value) * (/下降|降低|下跌/.test(direction) ? -1 : 1);
const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
export function parseOfficialMetricArticle(kind: 'pmi' | 'fiscal' | 'property' | 'lpr', article: OfficialArticle & { text: string; releasedAt?: string }): OfficialMetric[] {
  const { text, period, url: sourceUrl, releasedAt } = article;
  const common = { sourceUrl, releasedAt, status: 'delayed' as const, period, checkedAt: new Date().toISOString(), freshness: 'checked' as const };
  if (kind === 'pmi') {
    const match = text.match(/(?:^|[，。；：])制造业采购经理指数[（(]PMI[）)]为([\d.]+)%?[，,]比上月(上升|下降)([\d.]+)个百分点/)
      || text.match(/制造业采购经理指数[（(]PMI[）)]为([\d.]+)%?[，,]比上月(上升|下降)([\d.]+)个百分点/);
    if (!match) throw new Error('制造业 PMI 正文格式变化');
    const value = Number(match[1]);
    const change = signed(match[2], match[3]);
    if (value < 0 || value > 100) throw new Error('PMI 超出有效范围');
    return [{ ...common, id: 'official-pmi', label: '官方制造业 PMI', value, display: value.toFixed(1), change, changeDisplay: `${change > 0 ? '+' : ''}${change.toFixed(1)}`, source: '国家统计局' }];
  }
  if (kind === 'lpr') {
    const one = text.match(/1年期LPR为([\d.]+)%/i);
    const five = text.match(/5年期以上LPR为([\d.]+)%/i);
    if (!one || !five) throw new Error('LPR 期限字段不完整');
    return [{ ...common, id: 'lpr', label: '贷款市场报价利率', value: +one[1], display: `1Y ${(+one[1]).toFixed(2)}% · 5Y+ ${(+five[1]).toFixed(2)}%`, source: '中国人民银行', note: '分别为1年期和5年期以上LPR，不是同一国债收益率曲线' }];
  }
  const patterns = kind === 'fiscal'
    ? [{ id: 'fiscal', label: '一般公共预算支出同比', pattern: /全国一般公共预算支出([\d.]+)亿元[，,]同比(增长|下降|持平)([\d.]+)?%?/ },
      { id: 'land-sales', label: '土地出让收入同比', pattern: /国有土地使用权出让收入([\d.]+)亿元[，,]同比(增长|下降|持平)([\d.]+)?%?/ }]
    : [{ id: 'property', label: '新建商品房销售额同比', pattern: /新建商品房销售额([\d.]+)亿元[，,](?:同比)?(增长|下降|持平)([\d.]+)?%?/ }];
  return patterns.map(({ id, label, pattern }) => {
    const match = text.match(pattern);
    if (!match) throw new Error(`${label} 正文字段缺失`);
    const value = signed(match[2], match[3]);
    if (!Number.isFinite(value)) throw new Error(`${label} 不是有效数值`);
    return { ...common, period: `${period.slice(0, 4)}-01—${period.slice(5)}`, id, label, value, display: pct(value), source: kind === 'fiscal' ? '财政部' : '国家统计局', note: `年初至本期累计金额 ${match[1]} 亿元；同比为可比口径` };
  });
}
export async function fetchOfficialMetrics(kind: 'pmi' | 'fiscal' | 'property' | 'lpr', read: Reader) {
  const specs = {
    pmi: [officialLists.statistics, /中国采购经理指数运行情况/],
    fiscal: [officialLists.fiscal, /财政收支情况/],
    property: [officialLists.statistics, /全国房地产市场基本情况/],
    lpr: [officialLists.lpr, /公布贷款市场报价利率.*公告/],
  } as const;
  const [list, pattern] = specs[kind];
  return parseOfficialMetricArticle(kind, await latestOfficialArticle(list, pattern, read));
}
export async function fetchOfficialNews(kind: 'statistics' | 'xinhua' | 'government', read: Reader) {
  const source = kind === 'statistics' ? '国家统计局' : kind === 'xinhua' ? '新华社' : '中国政府网';
  const list = officialLists[kind];
  let articles: OfficialArticle[];
  if (kind === 'government') {
    const records = JSON.parse(await read(list));
    if (!Array.isArray(records)) throw new Error('政府网最新政策列表格式变化');
    articles = records.flatMap(row => {
      try {
        const url = new URL(row.URL);
        const date = dateFromText(String(row.DOCRELPUBTIME || ''));
        if (url.hostname !== 'www.gov.cn' || !/^https?:$/.test(url.protocol) || !date || typeof row.TITLE !== 'string') return [];
        return [{ title: officialText(row.TITLE), url: url.href, publishedAt: `${date}T00:00:00+08:00`, period: '' }];
      } catch { return []; }
    });
  } else {
    const html = await read(list);
    articles = parseOfficialLinks(html, list);
    if (kind === 'xinhua') {
      // This is the same archive used by the publisher's Load More button.
      const datasource = html.match(/id=["']content-list["'][^>]*data=["']datasource:([a-f\d]+)["']/i)?.[1];
      if (datasource) {
        const archive = JSON.parse(await read(new URL(`ds_${datasource}.json`, list).href));
        if (!Array.isArray(archive.datasource)) throw new Error('新华社分页数据格式变化');
        articles = archive.datasource.flatMap((row: { publishUrl?: string; publishTime?: string; showTitle?: string }) => {
          try {
            const url = new URL(row.publishUrl || '', list);
            const date = dateFromText(row.publishTime || '');
            if (url.hostname !== 'www.news.cn' || !/^https?:$/.test(url.protocol) || !date || !row.showTitle) return [];
            const clock = row.publishTime?.match(/\d{2}:\d{2}:\d{2}/)?.[0] || '00:00:00';
            return [{ title: officialText(row.showTitle), url: url.href, period: officialPeriod(row.showTitle), publishedAt: `${date}T${clock}+08:00` }];
          } catch { return []; }
        });
      }
    }
  }
  const items = articles.filter(item => item.publishedAt).map(item => ({ ...item, id: `official-${kind}-${item.url}`, source }));
  if (!items.length) throw new Error(`${source} 未解析到带日期的条目`);
  return items;
}
export async function fetchExportMetric(read: Reader): Promise<OfficialMetric> {
  // Both publishers quote the Customs release. A second official channel keeps
  // this metric available when a rolling news archive omits the latest article.
  const [xinhua, ndrc] = await Promise.all([
    fetchOfficialNews('xinhua', read)
      .then(items => items.map(item => ({ ...item, publisher: '新华社' as const })))
      .catch(() => []),
    read(officialLists.ndrcTrade)
      .then(html => parseOfficialLinks(html, officialLists.ndrcTrade)
        .filter(item => item.publishedAt)
        .map(item => ({ ...item, publisher: '国家发展改革委' as const })))
      .catch(() => []),
  ]);
  const articles = [...xinhua, ...ndrc].filter(item => /进出口|外贸|出口|进口|三驾马车/.test(item.title))
    .sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!))
    .filter((item, index, all) => all.findIndex(candidate => candidate.url === item.url) === index);
  for (const article of articles.slice(0, 16)) {
    try {
      const text = officialText(await read(article.url));
      const year = article.publishedAt!.slice(0, 4);
      const monthMatch = text.match(/(?:前|1[—–~～-])(\d{1,2})(?:个)?月/);
      const month = monthMatch?.[1];
      const cumulativeStart = monthMatch?.index ?? 0;
      const monthlyMarker = month ? text.indexOf(`${Number(month)}月当月`, cumulativeStart + monthMatch![0].length) : -1;
      const cumulativeText = text.slice(cumulativeStart, monthlyMarker > cumulativeStart ? monthlyMarker : cumulativeStart + 1000);
      const match = cumulativeText.match(/(?:^|[，。；;])(?:其中[，,]?)?(?:我国)?出口(?:总值)?(?:为)?([\d.]+)万亿元(?:人民币)?[，,；;]?(?:同比)?(?:为)?(增长|下降)([\d.]+)%/);
      if (!month || !match) continue;
      const value = signed(match[2], match[3]);
      return { id: 'exports', label: '出口累计同比（人民币）', value, display: pct(value), period: `${year}-01—${month.padStart(2, '0')}`, source: `海关总署 / ${article.publisher}`, sourceUrl: article.url, releasedAt: article.publishedAt!.slice(0, 10), status: 'delayed', note: `${article.publisher}转引海关数据；人民币计价，累计出口${match[1]}万亿元`, freshness: 'checked' };
    } catch {
      // Continue to the next official article/source if one page is unavailable.
    }
  }
  throw new Error('官方发布渠道未取得可核验的最新累计出口字段');
}
