import type { NewsFeed } from '../newsTypes';
import type { Snapshot } from './types';
import type { MacroEvidenceFeed } from './macroEvidence';

export type ReportEvidenceInput = {
  evidenceId: string; kind: 'news' | 'macro' | 'micro'; title: string; summary: string; source: string; url: string;
  publishedAt?: string; fetchedAt: string; linkedConIds: number[];
  relation: 'SYMBOL_MENTION' | 'ACCOUNT_CONTEXT_NOT_CAUSAL'; testData: boolean;
};
export type ReportEvidenceBundleInput = { generatedAt: string; items: ReportEvidenceInput[]; gaps: string[] };

const safeUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
};
const safeTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
const tokens = (value: string) => value.toLocaleUpperCase().split(/[^A-Z0-9.\-]+/).filter(Boolean);

export function buildReportEvidence(snapshot: Pick<Snapshot, 'testData' | 'positions'>, news: NewsFeed | null,
    macro: MacroEvidenceFeed | null, generatedAt = new Date().toISOString()): ReportEvidenceBundleInput {
  const items: ReportEvidenceInput[] = [];
  const gaps: string[] = [];
  if (news) {
    for (const row of news.items.slice(0, 50)) {
      const url = safeUrl(row.url); if (!url) continue;
      const words = new Set(tokens(`${row.title} ${row.summary ?? ''}`));
      const linkedConIds = snapshot.positions.filter(position => words.has(position.symbol.toLocaleUpperCase())).map(position => position.conId);
      items.push({ evidenceId: `news:${row.id}`, kind: 'news', title: row.title, summary: row.summary ?? '', source: row.source,
        url, ...(safeTime(row.publishedAt) ? { publishedAt: row.publishedAt } : {}),
        fetchedAt: safeTime(row.observedAt) ?? safeTime(news.generatedAt) ?? generatedAt, linkedConIds,
        relation: linkedConIds.length ? 'SYMBOL_MENTION' : 'ACCOUNT_CONTEXT_NOT_CAUSAL', testData: snapshot.testData });
    }
    if (!items.some(row => row.kind === 'news')) gaps.push('NEWS_EMPTY');
  } else gaps.push('NEWS_UNAVAILABLE');
  if (macro) {
    for (const row of macro.items.slice(0, 50)) {
      const url = safeUrl(row.sourceUrl); if (!url) continue;
      items.push({ evidenceId: `macro:${row.id}`, kind: 'macro', title: row.label, summary: row.display,
        source: new URL(url).hostname, url, fetchedAt: safeTime(row.updatedAt) ?? safeTime(macro.generatedAt) ?? generatedAt,
        linkedConIds: [], relation: 'ACCOUNT_CONTEXT_NOT_CAUSAL', testData: snapshot.testData });
    }
    if (!items.some(row => row.kind === 'macro')) gaps.push('MACRO_EMPTY');
  } else gaps.push('MACRO_UNAVAILABLE');
  gaps.push('MICRO_PERMISSION_REQUIRED');
  return { generatedAt, items, gaps };
}
