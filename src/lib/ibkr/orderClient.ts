import type { AccountMode } from './types';

export type OrderDraft = {
  accountKey: string; mode: AccountMode; conId: number; side: 'BUY' | 'SELL'; quantity: string;
  orderType: 'LMT'; limitPrice: string; tif: 'DAY';
};

export type OrderPreview = OrderDraft & {
  previewId: string; bodyHash: string; expiresAt: string; symbol: string; currency: string; snapshotId: string;
  reservedCash: string; reservedNotional: string; reservedQuantity: string; testData: boolean; warnings: string[];
};

const amount = /^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validOrderPreview(value: unknown): value is OrderPreview {
  if (!object(value)) return false;
  const mode = value.mode;
  return typeof value.previewId === 'string' && value.previewId.length > 0
    && typeof value.bodyHash === 'string' && /^[0-9a-f]{64}$/.test(value.bodyHash)
    && typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt))
    && (mode === 'paper' || mode === 'live') && typeof value.accountKey === 'string' && value.accountKey.startsWith(`${mode}:`)
    && Number.isInteger(value.conId) && Number(value.conId) > 0
    && (value.side === 'BUY' || value.side === 'SELL') && value.orderType === 'LMT' && value.tif === 'DAY'
    && ['quantity', 'limitPrice', 'reservedCash', 'reservedNotional', 'reservedQuantity'].every(key => typeof value[key] === 'string' && amount.test(value[key]))
    && ['symbol', 'currency', 'snapshotId'].every(key => typeof value[key] === 'string' && value[key].length > 0)
    && typeof value.testData === 'boolean' && Array.isArray(value.warnings) && value.warnings.every(row => typeof row === 'string');
}

export class OrderReviewError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

async function responseJson(response: Response) {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new OrderReviewError(object(value) && typeof value.detail === 'string' ? value.detail : 'ORDER_REVIEW_UNAVAILABLE');
  return value;
}

export async function previewOrder(draft: OrderDraft, signal?: AbortSignal): Promise<OrderPreview> {
  const response = await fetch('/api/ibkr-terminal/orders/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft), signal,
  });
  const value = await responseJson(response);
  if (!validOrderPreview(value) || value.accountKey !== draft.accountKey || value.mode !== draft.mode || value.conId !== draft.conId
    || value.side !== draft.side || value.quantity !== draft.quantity || value.limitPrice !== draft.limitPrice) {
    throw new OrderReviewError('PREVIEW_RESPONSE_INVALID');
  }
  return value;
}

export async function confirmOrder(preview: OrderPreview, signal?: AbortSignal) {
  const response = await fetch(`/api/ibkr-terminal/orders/previews/${encodeURIComponent(preview.previewId)}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bodyHash: preview.bodyHash, explicit: true }), signal,
  });
  const value = await responseJson(response);
  if (!object(value) || value.submission !== 'PERSISTED' || value.orderId !== null || value.permId !== null
    || !object(value.intent) || value.intent.accountKey !== preview.accountKey || value.intent.clientIntentId === undefined
    || value.intent.quantity !== preview.quantity || value.intent.limitPrice !== preview.limitPrice) {
    throw new OrderReviewError('CONFIRMATION_RESPONSE_INVALID');
  }
  return value;
}
