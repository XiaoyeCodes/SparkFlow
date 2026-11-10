export type GravitySymbol = 'SPY' | 'QQQ';

export type GravityPoint = {
  date: string;
  close: number;
  twap: number;
  premium: number;
  score: number;
  level: number;
  vwap: number | null;
};

export type GravityHistory = {
  symbol: GravitySymbol;
  points: GravityPoint[];
  validUntil: string;
  _publicCache?: { state: 'fresh' | 'stale' };
};
