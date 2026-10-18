export type StockStrategy = { id: string; name: string; description: string; category: string };
export type StrategyReport = {
  meta?: { stock_code?: string; stock_name?: string; current_price?: number | null; change_pct?: number | null; model_used?: string };
  summary?: { analysis_summary?: string; operation_advice?: string; action_label?: string; trend_prediction?: string; sentiment_score?: number; sentiment_label?: string };
  strategy?: { ideal_buy?: string; secondary_buy?: string; stop_loss?: string; take_profit?: string };
  details?: { technical_analysis?: string; fundamental_analysis?: string; news_summary?: string; empty_news_disclosure?: string; risk_warning?: string; raw_result?: Record<string, unknown> };
};
export type StrategyJob = {
  id: string; symbol: string; mode: 'report' | 'chat'; question: string; strategies: string[];
  sessionId: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  progress: number; message: string; createdAt: string; updatedAt: string; model: string;
  result?: { stock_name?: string; report?: StrategyReport; content?: string };
};
export type StrategyState = {
  ready: boolean; configured: boolean; model: string; provider: string;
  strategies: StockStrategy[]; jobs: StrategyJob[];
};
export const isStrategyActive = (job: StrategyJob) => job.status === 'queued' || job.status === 'running';
