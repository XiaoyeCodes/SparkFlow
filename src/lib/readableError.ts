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

const PROVIDER_CONTENT_POLICY_PATTERN = /(?:content exists risk|provider_content_filter|content[_ -]?filter|content moderation|prohibited_content)/i;

const PROVIDER_CONTENT_POLICY_MESSAGE = '模型服务的内容风控拒绝了本次分析。系统已尝试安全恢复但仍未通过，请稍后重新分析；若持续出现，请切换模型服务。';

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
  if (PROVIDER_CONTENT_POLICY_PATTERN.test(message)) return PROVIDER_CONTENT_POLICY_MESSAGE;
  return message || fallback;
}
