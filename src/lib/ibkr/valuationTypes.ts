export type ValuationLookback = 1 | 3 | 5 | 10;
export type ValuationSeriesId = 'vix' | 'spx' | 'ndx' | 'pe' | 'forwardYield' | 'treasury10y' | 'fearGreed';
export type ValuationMetricId = 'vix' | 'spx' | 'ndx' | 'pe' | 'forwardYield' | 'erp';
export type ValuationStatus = 'live' | 'delayed' | 'frozen' | 'close' | 'snapshot' | 'stale' | 'missing';

export interface ValuationPoint { date: string; value: number }
export interface ValuationSeries {
  points: ValuationPoint[];
  current: number | null;
  asOf: string | null;
  source: string;
  sourceUrl: string | null;
  status: ValuationStatus;
  note: string;
}
export interface ValuationInputs {
  fetchedAt: string;
  series: Record<ValuationSeriesId, ValuationSeries>;
}
export interface ValuationCoverage {
  complete: boolean;
  start: string | null;
  end: string | null;
  samples: number;
  requiredStart: string;
  reason: string | null;
}
export interface ValuationMetric {
  id: ValuationMetricId;
  label: string;
  current: number | null;
  unit: 'index' | 'times' | 'percent';
  percentile: number | null;
  deviationPercent: number | null;
  trendValue: number | null;
  asOf: string | null;
  source: string;
  sourceUrl: string | null;
  status: ValuationStatus;
  note: string;
  coverage: ValuationCoverage;
  eligible: boolean;
}
export interface ValuationContribution {
  id: 'spx' | 'ndx' | 'pe' | 'erp' | 'vix' | 'fearGreed';
  label: string;
  /** Percentage of the total score, summing to 100. */
  weight: number;
  /** Buy signal in [0, 100], before weighting. */
  signal: number | null;
  /** signal × weight / 100, without intermediate rounding. */
  points: number | null;
  reason: string | null;
}
export interface ValuationRules {
  version: string;
  formula: string;
  weights: Record<ValuationContribution['id'], number>;
  methodology: string[];
}
export interface ValuationSnapshot {
  current: number | null;
  asOf: string | null;
  status: ValuationStatus;
  source: string;
  sourceUrl: string | null;
  note: string;
  eligible: boolean;
}
export interface ValuationChart {
  label: string;
  points: { date: string; value: number; trend: number }[];
  note: string;
}
export interface ValuationDashboard {
  fetchedAt: string;
  lookbackYears: ValuationLookback;
  window: { start: string; end: string };
  metrics: ValuationMetric[];
  score: {
    value: number | null;
    label: string;
    conclusion: string;
    contributions: ValuationContribution[];
    coverageWeight: number;
    missing: string[];
  };
  chart: ValuationChart;
  charts: Record<'spx' | 'ndx' | 'vix', ValuationChart>;
  sentiment: ValuationSnapshot;
  treasury: ValuationSnapshot;
  rules: ValuationRules;
  /** Raw input values, timestamps and rules required for deterministic replay. */
  audit: { inputs: ValuationInputs; lookbackYears: ValuationLookback; rules: ValuationRules; contributions: ValuationContribution[] };
}
