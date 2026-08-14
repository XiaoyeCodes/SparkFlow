const baseUrl = process.env.SPARKFLOW_BASE_URL || 'http://127.0.0.1:5180';
const expectedStats = {
  ppi: ['环比', '同比值', '预期', '前值'],
  cpi: ['环比', '同比值', '预期', '前值'],
  unemployment: ['实际', '预期', '前值'],
  nonfarm: ['实际', '预期', '前值'],
  pmi: ['前值', '预期'],
  pce: ['PCE实际', 'PCE前值', 'PCE变化', 'PCE预期'],
};

function numeric(value) {
  const match = String(value || '').match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchCard(id) {
  const response = await fetch(`${baseUrl}/api/us-macro-card?id=${encodeURIComponent(id)}`);
  assert(response.ok, `${id} HTTP ${response.status}`);
  const payload = await response.json();
  return payload.card;
}

const ids = Object.keys(expectedStats);
const startedAt = Date.now();
const cards = await Promise.all(ids.map(fetchCard));

cards.forEach((card) => {
  assert(card?.id && ids.includes(card.id), '返回了未知卡片');
  assert(Number.isFinite(card.value), `${card.id} 实际值缺失`);
  assert(!String(card.display).includes('待更新'), `${card.id} 主值待更新`);
  const stats = new Map((card.stats || []).map((item) => [item.label, item.display]));
  expectedStats[card.id].forEach((label) => {
    const value = stats.get(label);
    assert(value && !value.includes('待更新'), `${card.id} ${label}缺失`);
  });

  if (['unemployment', 'nonfarm'].includes(card.id)) {
    const actual = numeric(stats.get('实际'));
    const previous = numeric(stats.get('前值'));
    assert(actual !== null && previous !== null, `${card.id} 无法校验变化值`);
    assert(Math.abs(card.change - (actual - previous)) < 0.011, `${card.id} 变化值与实际/前值不一致`);
  }
  if (card.id === 'pmi') {
    const previous = numeric(stats.get('前值'));
    assert(previous !== null && Math.abs(card.change - (card.value - previous)) < 0.011, 'PMI 变化值不一致');
  }
  if (card.id === 'pce') {
    const actual = numeric(stats.get('PCE实际'));
    const previous = numeric(stats.get('PCE前值'));
    assert(actual !== null && previous !== null && Math.abs(card.change - (actual - previous)) < 0.011, 'PCE 变化值不一致');
  }
});

const invalid = await fetch(`${baseUrl}/api/us-macro-card?id=invalid`);
assert(invalid.status === 400, `非法卡片应返回 400，实际为 ${invalid.status}`);

console.log(JSON.stringify({
  ok: true,
  cards: cards.map((card) => ({ id: card.id, display: card.display, change: card.changeDisplay })),
  elapsedMs: Date.now() - startedAt,
}, null, 2));
