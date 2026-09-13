export type FisherObservation = { value: number; period: string; publishedAt: string; source: string; sourceUrl: string };
export type FisherMode = 'loan' | 'deposit';
export type FisherSnapshot = {
  mode: FisherMode;
  status: 'current' | 'pending' | 'unavailable';
  realRate: number | null;
  nominal: FisherObservation | null;
  inflation: FisherObservation | null;
  checkedAt: string;
  validUntil: string;
  nextCheckAt: string;
  nextReleaseAt: string | null;
  message: string;
};
