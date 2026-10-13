export type EffectiveFedRate = { value: number; updatedAt: string; sourceUrl: string };
export function parseNewYorkFedEffr(data: unknown, now = Date.now()): EffectiveFedRate {
  const rows = (data as { refRates?: Array<{ type?: string; effectiveDate?: string; percentRate?: number }> })?.refRates;
  const valid = rows?.filter(row => row.type === 'EFFR' && typeof row.percentRate === 'number' && row.percentRate >= 0
    && row.percentRate < 30 && Number.isFinite(Date.parse(row.effectiveDate || ''))
    && Date.parse(row.effectiveDate!) <= now && now - Date.parse(row.effectiveDate!) < 14 * 86400_000)
    .sort((a, b) => b.effectiveDate!.localeCompare(a.effectiveDate!));
  if (!valid?.length) throw new Error('纽约联储没有近期有效 EFFR');
  return { value: valid[0].percentRate!, updatedAt: `${valid[0].effectiveDate}T00:00:00.000Z`,
    sourceUrl: 'https://www.newyorkfed.org/markets/reference-rates/effr' };
}
export async function latestEffectiveFedRate(sources: Promise<EffectiveFedRate>[], budgetMs = 3000) {
  const available: EffectiveFedRate[] = [];
  const settled = Promise.allSettled(sources.map(async source => { available.push(await source); }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([settled, new Promise<void>(resolve => { timer = setTimeout(resolve, budgetMs); })]);
    if (!available.length) throw new Error('EFFR 主备来源均不可用');
    return available.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  } finally { clearTimeout(timer); }
}
