export type ChinaGdpYear = { year: number; value: number; growth: number; sourceUrl: string };
export type ChinaGdpSnapshot = {
  status: 'current' | 'unavailable';
  years: ChinaGdpYear[];
  checkedAt: string;
  validUntil: string;
  nextCheckAt: string;
};
