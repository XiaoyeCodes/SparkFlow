export type ChinaRegionalEconomy = {
  adcode: string;
  name: string;
  level: 'city' | 'county';
  period: string;
  source: string;
  sourceUrl: string;
  parentProvinceCode?: string;
  parentCityCode?: string;
  dataCoverage?: 'administrative' | 'population' | 'economic';
  economicPeriod?: string | null;
  economicSource?: string | null;
  economicSourceUrl?: string | null;
  populationPeriod?: string | null;
  populationSource?: string | null;
  populationSourceUrl?: string | null;
  censusPeriod?: string | null;
  censusSource?: string | null;
  censusSourceUrl?: string | null;
  gdp100mCny?: number | null;
  populationMillion?: number | null;
  censusPopulationMillion?: number | null;
  householdPopulation10k?: number | null;
  householdSize?: number | null;
  sexRatio?: number | null;
  age0To14Percent?: number | null;
  age60PlusPercent?: number | null;
  age65PlusPercent?: number | null;
  areaKm2?: number | null;
  primary100mCny?: number | null;
  secondary100mCny?: number | null;
  tertiary100mCny?: number | null;
  secondaryPercent?: number | null;
  tertiaryPercent?: number | null;
  fiscalRevenue100mCny?: number | null;
  fiscalExpenditure100mCny?: number | null;
  deposit100mCny?: number | null;
  loan100mCny?: number | null;
  averageWageCny?: number | null;
  townCount?: number | null;
  streetCount?: number | null;
  industrialEnterpriseCount?: number | null;
  primarySchoolCount?: number | null;
  higherSchoolCount?: number | null;
  primaryStudentCount?: number | null;
  secondaryStudentCount?: number | null;
  healthBedCount?: number | null;  gdpPeriod?: string;
  gdpSource?: string;
  gdpSourceUrl?: string;
  gdpPerCapitaCny?: number;
  perCapitaPeriod?: string;
  perCapitaSourceUrl?: string;
  populationBasis?: 'year-end-resident' | 'average-resident';
};

export type RegionalMetric = 'gdp' | 'population' | 'perCapita';
export type RegionalObservation = {
  adcode: string; metric: RegionalMetric; value: number; period: string;
  source: string; sourceUrl: string; checkedAt: string;
  basis: 'official' | 'year-end-resident' | 'average-resident'; evidence: string;
  editionYear?: number;
};
export type RegionalScopeStatus = {
  name: string; checkedAt: string; nextCheckAt: string;
  status: 'updated' | 'partial' | 'unavailable'; count: number;
  errors: { url?: string; reason: string; title?: string }[];
};
export type RegionalSnapshot = {
  observations: RegionalObservation[]; scopes: Record<string, RegionalScopeStatus>;
  running?: string | null; revision?: string;
};

export function validRegionalObservation(o: RegionalObservation) {
  if (!o || !/^\d{6}$/.test(o.adcode) || !/^20\d{2}$/.test(o.period)
    || Number(o.period) >= new Date().getFullYear() || !Number.isFinite(o.value) || o.value <= 0) return false;
  const max = { gdp: 100000, population: 100, perCapita: 5000000 }[o.metric];
  if (!max || o.value >= max || !o.evidence || !Number.isFinite(Date.parse(o.checkedAt))) return false;
  if (o.metric === 'population' && !['year-end-resident', 'average-resident'].includes(o.basis)) return false;
  try { const u = new URL(o.sourceUrl); return /^https?:$/.test(u.protocol) && u.hostname.endsWith('.gov.cn'); }
  catch { return false; }
}

export function latestRegionalObservations(observations: RegionalObservation[]) {
  const values = new Map<string, RegionalObservation>();
  for (const o of observations) {
    if (!validRegionalObservation(o)) continue;
    const key = `${o.adcode}:${o.metric}`;
    const old = values.get(key);
    if (!old || o.period > old.period || (o.period === old.period &&
      ((o.editionYear || 0) > (old.editionYear || 0) || ((o.editionYear || 0) === (old.editionYear || 0) && o.checkedAt > old.checkedAt)))) values.set(key, o);
  }
  return [...values.values()];
}

export function mergeRegionalObservations(base: Record<string, ChinaRegionalEconomy>, observations: RegionalObservation[]) {
  const records = { ...base };
  for (const o of latestRegionalObservations(observations)) {
    if (!records[o.adcode]) continue;
    const item = records[o.adcode];
    if (o.metric === 'gdp' && (!item.gdp100mCny || o.period >= (item.gdpPeriod || item.economicPeriod || item.period))) {
      records[o.adcode] = { ...item, gdp100mCny: o.value, gdpPeriod: o.period, gdpSource: o.source, gdpSourceUrl: o.sourceUrl, dataCoverage: 'economic' };
    } else if (o.metric === 'population' && (!item.populationMillion || o.period >= (item.populationPeriod || item.period))) {
      records[o.adcode] = { ...item, populationMillion: o.value, populationPeriod: o.period, populationBasis: o.basis as 'year-end-resident' | 'average-resident', populationSource: o.source, populationSourceUrl: o.sourceUrl };
    } else if (o.metric === 'perCapita' && o.period >= (item.perCapitaPeriod || '0')) {
      records[o.adcode] = { ...item, gdpPerCapitaCny: o.value, perCapitaPeriod: o.period, perCapitaSourceUrl: o.sourceUrl };
    }
  }
  return records;
}

export function regionalPopulationMillion(item: ChinaRegionalEconomy) {
  // Resident population is preferred. Keep census and registered population
  // explicitly separate instead of treating registered population as resident.
  return item.populationMillion ?? item.censusPopulationMillion ?? (item.householdPopulation10k != null ? item.householdPopulation10k / 100 : null);
}

export function regionalPerCapitaGdp(item: ChinaRegionalEconomy) {
  if (item.gdpPerCapitaCny != null) return item.gdpPerCapitaCny;
  const year = item.gdpPeriod || item.economicPeriod || item.period;
  if (!item.gdp100mCny || !item.populationMillion || !item.populationBasis || year !== item.populationPeriod) return null;
  return item.gdp100mCny * 100 / item.populationMillion;
}

export function regionalMetricDetails(item: ChinaRegionalEconomy, metric: RegionalMetric) {
  if (metric === 'gdp') return { period: item.gdpPeriod || item.economicPeriod || (item.gdp100mCny ? item.period : ''),
    sourceUrl: item.gdpSourceUrl || item.economicSourceUrl || item.sourceUrl, note: '现价 GDP' };
  if (metric === 'perCapita') return { period: item.perCapitaPeriod || (regionalPerCapitaGdp(item) ? item.gdpPeriod || item.economicPeriod || item.period : ''),
    sourceUrl: item.perCapitaSourceUrl || item.gdpSourceUrl || item.economicSourceUrl || item.sourceUrl,
    note: item.gdpPerCapitaCny ? '官方人均 GDP' : item.populationBasis === 'year-end-resident' ? '按同年年末常住人口估算' : '需同年 GDP 与常住人口' };
  const census = item.populationMillion == null && item.censusPopulationMillion != null;
  const household = item.populationMillion == null && item.censusPopulationMillion == null && item.householdPopulation10k != null;
  return { period: census ? item.censusPeriod : item.populationPeriod || (household ? item.economicPeriod || item.period : ''),
    sourceUrl: census ? item.censusSourceUrl : item.populationSourceUrl || item.sourceUrl,
    note: household ? '户籍人口' : census || item.populationPeriod === '2020' ? '普查常住人口' : item.populationBasis ? '常住人口' : '历史年鉴人口' };
}
