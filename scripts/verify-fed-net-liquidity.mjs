const baseUrl = process.env.SPARKFLOW_URL || 'http://127.0.0.1:5180';
const response = await fetch(`${baseUrl}/api/fed-net-liquidity?fresh=1`, {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(60_000),
});

if (!response.ok) throw new Error(`净流动性接口返回 ${response.status}`);
const payload = await response.json();
const item = payload?.liquidity;
if (item?.id !== 'fed-net-liquidity') throw new Error('净流动性数据标识错误');
if (!Number.isFinite(item.value) || item.value <= 0) throw new Error('净流动性当前值无效');
if (!Array.isArray(item.history) || item.history.length < 20 || item.history.length > 31) {
  throw new Error(`近30天序列点数异常：${item.history?.length ?? 0}`);
}
if (!Array.isArray(item.chartHistory) || item.chartHistory.length !== item.history.length || item.chartMethod !== '5D EMA') {
  throw new Error('净流动性绘图序列未按5日EMA完整生成');
}

for (let index = 0; index < item.history.length; index += 1) {
  const point = item.history[index];
  if (!Number.isFinite(point.value)) throw new Error(`第 ${index + 1} 个趋势点无效`);
  if (index > 0 && new Date(point.time).getTime() <= new Date(item.history[index - 1].time).getTime()) {
    throw new Error('趋势序列日期未严格递增');
  }
}

const { totalAssets, treasuryGeneralAccount, overnightReverseRepo } = item.components || {};
if (![totalAssets, treasuryGeneralAccount, overnightReverseRepo].every(Number.isFinite)) {
  throw new Error('净流动性组成项不完整');
}
const reconciled = totalAssets - treasuryGeneralAccount - overnightReverseRepo;
if (Math.abs(reconciled - item.value) > 0.000001) {
  throw new Error(`公式无法回算：${reconciled} != ${item.value}`);
}

const firstValue = item.history[0].value;
const lastValue = item.history.at(-1).value;
const expectedChange = lastValue - firstValue;
if (Math.abs(expectedChange - item.change30d) > 0.000001) throw new Error('30日变化与趋势序列不一致');
const expectedRegime = item.change30d >= 0 ? 'injection' : 'contraction';
if (item.regime !== expectedRegime) throw new Error('流动性投放/收缩状态与30日变化方向不一致');
const maxJump = (values) => Math.max(...values.slice(1).map((point, index) => Math.abs(point.value - values[index].value)));
const rawMaxJump = maxJump(item.history);
const chartMaxJump = maxJump(item.chartHistory);
if (!(chartMaxJump < rawMaxJump)) throw new Error(`5日EMA没有降低最大单日跳变：${chartMaxJump} >= ${rawMaxJump}`);

console.log(`✓ 美联储净流动性 ${item.display}`);
console.log(`✓ 30日 ${item.changeDisplay} · ${item.regimeLabel}`);
console.log(`✓ ${item.history.length} 个原始点，三项数据公式回算通过`);
console.log(`✓ 5日EMA最大跳变 ${chartMaxJump.toFixed(4)}T，小于原始 ${rawMaxJump.toFixed(4)}T`);
