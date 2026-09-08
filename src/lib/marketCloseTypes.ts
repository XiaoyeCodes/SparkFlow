export type CloseMarket = 'cn' | 'us';
export type CloseIndex = { name: string; symbol: string; close: number; change: number; changePercent: number; date: string; sourceUrl: string };
export type CloseSource = { id: string; title: string; url: string; publishedAt: string; fetchedAt: string; content: string };
export type CloseReport = { market: CloseMarket; date: string; generatedAt: string; model: string; provider: string; markdown: string; indices: CloseIndex[]; sources: CloseSource[]; gaps: string[] };
export type CloseReportState = { market: CloseMarket; dueDate: string | null; nextRunAt: string | null; calendarSupported: boolean; report: CloseReport | null; status: 'idle' | 'running' | 'failed' | 'complete'; stage?: string; error?: string; attempts: number };
