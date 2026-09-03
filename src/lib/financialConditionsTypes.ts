export type FinancialSeriesId = 'NFCI' | 'BAMLH0A0HYM2';
export type FinancialConditionPoint = { time: string; value: number };

export type FinancialConditionMetric = {
  seriesId: FinancialSeriesId;
  value: number;
  observedAt: string;
  fetchedAt: string;
  // NFCI: index points. HY OAS: percentage points, NOT basis points.
  changeWeek: number | null;
  comparisonAt: string | null;
  history: FinancialConditionPoint[];
  sourceUrl: string;
  stale: boolean;
};

export type FinancialConditionsSnapshot = {
  nfci: FinancialConditionMetric | null;
  creditSpread: FinancialConditionMetric | null;
};

export type FinancialConditionsPayload = {
  generatedAt: string;
  conditions: FinancialConditionsSnapshot;
};
