export type IncomeGroup = { label: string; amount: number; nominal: number; real: number };
export type IncomeSource = { label: string; amount: number; growth: number; share: number };
export type IncomeReport = {
  period: string; label: string; publishedAt: string; sourceUrl: string;
  groups: IncomeGroup[]; sources: IncomeSource[];
  median: number; medianGrowth: number; medianRatio: number;
};
export type IncomeSnapshot = {
  status: 'current' | 'snapshot' | 'unavailable'; report: IncomeReport | null;
  checkedAt: string; validUntil: string; nextCheckAt: string;
};
