import { safeNewsUrl } from './newsEvidence';

export type MacroEvidence = { id: string; label: string; display: string; status: 'live' | 'delayed' | 'unavailable'; updatedAt?: string; period?: string; sourceUrl: string };
export type MacroEvidenceFeed = { generatedAt: string; items: MacroEvidence[] };

export async function fetchMacroEvidence(signal: AbortSignal): Promise<MacroEvidenceFeed> {
  const response = await fetch('/api/global-macro-dashboard?region=global&section=macro', { signal });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error((payload as { error?: string })?.error || '宏观源不可用');
  if (!payload || typeof payload !== 'object' || typeof (payload as { generatedAt?: unknown }).generatedAt !== 'string' || !Array.isArray((payload as { macro?: unknown }).macro)) throw new Error('宏观响应缺少来源字段');
  const raw = payload as { generatedAt: string; macro: unknown[] };
  const items = raw.macro.flatMap((value): MacroEvidence[] => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Partial<MacroEvidence>;
    if (typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.display !== 'string'
      || !['live', 'delayed', 'unavailable'].includes(String(item.status))) return [];
    return [{ id: item.id, label: item.label, display: item.display, status: item.status!,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : undefined,
      period: typeof item.period === 'string' ? item.period : undefined, sourceUrl: safeNewsUrl(item.sourceUrl) ?? '' }];
  });
  return { generatedAt: raw.generatedAt, items };
}
