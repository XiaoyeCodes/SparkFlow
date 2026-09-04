// Parsing and period rules shared by the six independently refreshed US macro cards.
export const macroText = (raw: string) => raw
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&#(?:8722|8211);|&minus;|−/g, '-').replace(/\s+/g, ' ').trim();

export function parseEmploymentHeadline(raw: string) {
  const text = macroText(raw);
  const headline = text.match(/Total nonfarm payroll employment\b([\s\S]{0,260}?)(?:,\s+and|\.\s|\.$|$)/i)?.[1];
  const parenthesized = headline?.match(/\(([+-]?\d[\d,]*)\)/);
  const directional = headline?.match(/\b(increased|rose|grew|expanded|added|decreased|declined|fell|dropped)\s+(?:by\s+)?([\d,]+)/i);
  const nonfarm = parenthesized ? Number(parenthesized[1].replace(/,/g, '')) / 1000
    : directional ? Number(directional[2].replace(/,/g, '')) / 1000 * (/decreased|declined|fell|dropped/i.test(directional[1]) ? -1 : 1)
    : undefined;
  // Restrict the match to the headline, before demographic subgroup rates.
  const unemploymentMatch = text.match(/(?:the )?unemployment rate\s*(?:,?\s*at|\(|(?:was |remained )?(?:unchanged|little changed|changed little)\s+at|(?:rose|increased|edged up|fell|declined|decreased|edged down)\s+to)\s*([\d.]+)\s*(?:percent|%)/i);
  const unemployment = unemploymentMatch ? Number(unemploymentMatch[1]) : undefined;
  if (!Number.isFinite(nonfarm) || !Number.isFinite(unemployment)) throw new Error('BLS 就业新闻稿数值无法识别');
  return { nonfarm: nonfarm!, unemployment: unemployment! };
}

export function previousMacroPeriod(period: string) {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

export type MacroMarketContext = {
  period: string; actual: number; previous?: number; consensus?: number; sourceUrl: string;
};

function marketNumber(raw = '') {
  const text = macroText(raw).replace(/\([^)]*\)/g, '').trim();
  const match = text.match(/^([+-]?\d[\d,]*(?:\.\d+)?)\s*(K|M|%)?$/i);
  return match ? Number(match[1].replace(/,/g, '')) * (/m/i.test(match[2] || '') ? 1000 : 1) : undefined;
}

export function parseMacroMarketCalendar(raw: string, category: string, event: RegExp, sourceUrl: string): MacroMarketContext {
  const rows = [...raw.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)]
    .filter((row) => macroText(row[1].match(/data-category=["']([^"']*)["']/i)?.[1] || '').toLowerCase() === category.toLowerCase())
    .map((row) => [...row[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => macroText(cell[1])))
    .filter(cells => event.test(cells[2] || ''));
  // Rendered fallbacks preserve calendar column order but have no HTML attributes.
  if (!rows.length) {
    for (const line of raw.split(/\r?\n/)) {
      const cells = line.replace(/^\s*\||\|\s*$/g, '').split('|').map(macroText);
      if (/^\d{4}-\d{2}-\d{2}$/.test(cells[0] || '') && cells.length >= 7 && event.test(cells[2] || '')) rows.push(cells);
    }
  }
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const released = rows.flatMap(cells => {
    const date = cells[0]?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const actual = marketNumber(cells[4]);
    if (!date || actual === undefined) return [];
    const reference = cells[3]?.match(/\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\b(?:\s+(20\d{2}))?/i);
    let period = previousMacroPeriod(date.slice(0, 7));
    if (reference) {
      const month = months.indexOf(reference[1].slice(0, 3).toLowerCase()) + 1;
      const releaseYear = Number(date.slice(0, 4));
      const year = Number(reference[2]) || releaseYear - (month > Number(date.slice(5, 7)) ? 1 : 0);
      period = `${year}-${String(month).padStart(2, '0')}`;
    }
    return [{ date, period, actual, previous: marketNumber(cells[5]), consensus: marketNumber(cells[6]), sourceUrl }];
  }).sort((a,b) => b.period.localeCompare(a.period) || b.date.localeCompare(a.date));
  if (!released.length) throw new Error(`${category} 已发布数据无法识别`);
  return released[0];
}

export function macroComparison(period: string, actual: number, officialPrevious: number | undefined,
  context: MacroMarketContext | undefined, history: Array<{ time: string; value: number }>, tolerance = 0.051) {
  const matched = context?.period === period && Math.abs(context.actual - actual) < tolerance ? context : undefined;
  const previousPeriod = previousMacroPeriod(period);
  const previous = officialPrevious ?? matched?.previous ?? history.find(p => p.time.slice(0, 7) === previousPeriod)?.value;
  return { previous, consensus: matched?.consensus, change: previous === undefined ? null : actual - previous };
}

export function assertMacroPeriodNotRegressed(incoming: string, existing?: string) {
  if (existing && incoming.slice(0, 7) < existing.slice(0, 7)) throw new Error('上游返回了更早统计期，保留最新数据');
}
