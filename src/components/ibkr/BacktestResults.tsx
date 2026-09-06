import type { BacktestResult } from '../../lib/ibkr/backtestClient';

export function BacktestResults({ runs }: { runs: BacktestResult[] }) {
  if (!runs.length) return <div className="ibkr-backtest-empty"><b>没有已验证的回测结果</b><span>配置用户策略与版本化数据后才能创建任务。</span></div>;
  return <div className="ibkr-backtest-results" aria-label="历史回测结果">{runs.map(run => <article key={run.runHash}>
    <header><div><b>{run.strategyId}</b><span>v{run.strategyVersion} · {run.barCount} bars</span></div>{run.testData && <strong>工程测试</strong>}</header>
    <EquitySparkline run={run} />
    <dl><dt>最终权益</dt><dd>{run.metrics.finalEquity} USD</dd><dt>总收益率</dt><dd>{run.metrics.totalReturn}</dd><dt>持有基准</dt><dd>{run.metrics.benchmarkReturn}</dd><dt>最大回撤</dt><dd>{run.metrics.maxDrawdown}</dd><dt>换手</dt><dd>{run.metrics.turnover}</dd><dt>区间波动</dt><dd>{run.metrics.returnVolatility ?? '样本不足'}</dd><dt>风险调整</dt><dd>{run.metrics.riskAdjustedReturn ?? '样本不足'}</dd><dt>成交</dt><dd>{run.metrics.tradeCount}</dd><dt>费用</dt><dd>{run.metrics.totalFees} USD</dd><dt>滑点成本</dt><dd>{run.metrics.slippageCost} USD</dd></dl>
    <details><summary>可复现证据</summary><p>策略哈希 <code>{run.strategyHash}</code></p><p>数据哈希 <code>{run.datasetHash}</code></p><p>配置哈希 <code>{run.configHash}</code></p><p>运行哈希 <code>{run.runHash}</code></p></details>
  </article>)}</div>;
}

function EquitySparkline({ run }: { run: BacktestResult }) {
  const values = run.equityCurve.map(point => Number(point.equity));
  const low = Math.min(...values); const high = Math.max(...values); const range = high - low || 1;
  const points = values.map((value, index) => `${values.length === 1 ? 50 : index / (values.length - 1) * 100},${34 - (value - low) / range * 30}`).join(' ');
  return <svg className="ibkr-equity-curve" viewBox="0 0 100 38" preserveAspectRatio="none" role="img" aria-label={`权益曲线，共 ${values.length} 个可复现数据点`}><polyline points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg>;
}
