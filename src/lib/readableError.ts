const PRIORITY_ERROR_KEYS = [
  'message',
  'msg',
  'error_description',
  'error',
  'detail',
  'reason',
  'cause',
  'title',
] as const;

function formatLocation(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value.map(String).filter(Boolean).join('.');
}

function visit(value: unknown, seen: WeakSet<object>): string {
  if (value instanceof Error) return value.message.trim() || value.name;
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '[object Object]' ? '' : text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => visit(item, seen)).filter(Boolean).join('；');
  }
  if (!value || typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of PRIORITY_ERROR_KEYS) {
    if (!(key in record)) continue;
    const message = visit(record[key], seen);
    if (!message) continue;
    const location = formatLocation(record.loc ?? record.path);
    return location ? `${location}：${message}` : message;
  }

  const details = Object.entries(record)
    .filter(([key]) => key !== 'loc' && key !== 'path')
    .slice(0, 4)
    .map(([key, nested]) => {
      const message = visit(nested, seen);
      return message ? `${key}：${message}` : '';
    })
    .filter(Boolean);
  return details.join('；');
}

/**
 * Converts API, SSE and thrown values into UI-safe text. It deliberately
 * refuses JavaScript's default `[object Object]` representation.
 */
export function readableError(value: unknown, fallback = '请求失败') {
  const message = visit(value, new WeakSet<object>());
  return message || fallback;
}
