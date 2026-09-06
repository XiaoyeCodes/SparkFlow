import { useEffect, useState } from 'react';
import { buildStrategyDraft, type StrategyDraftInput } from '../../lib/ibkr/strategyDraft';
import type { Snapshot } from '../../lib/ibkr/types';

const initial = (snapshot: Snapshot): StrategyDraftInput => ({
  strategyId: 'user:strategy-draft', version: '1.0.0', name: '待确认的 SMA 策略',
  conId: snapshot.positions[0] ? String(snapshot.positions[0].conId) : '', barInterval: '1D',
  fastWindow: '5', slowWindow: '20', targetQuantity: '1', maxPositionQuantity: '1',
  commissionPerOrder: '0', commissionPerShare: '0', slippageBps: '0',
  versionNotes: '待用户复核；未授权运行。',
});

export function StrategyDraftEditor({ snapshot }: { snapshot: Snapshot }) {
  const [input, setInput] = useState<StrategyDraftInput>(() => initial(snapshot));
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setInput(value => ({ ...value, conId: snapshot.positions[0] ? String(snapshot.positions[0].conId) : '' }));
    setOutput(''); setError('');
  }, [snapshot.accountKey]);
  const field = (key: keyof StrategyDraftInput) => ({
    value: input[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setInput(value => ({ ...value, [key]: event.target.value })); setOutput(''); setError('');
    },
  });
  const generate = () => {
    const result = buildStrategyDraft(input);
    if (!result.ok) { setError(result.errors[0]); setOutput(''); return; }
    setError(''); setOutput(JSON.stringify(result.definition, null, 2));
  };
  return <details className="ibkr-strategy-editor" data-testid="strategy-draft-editor">
    <summary>结构化策略草稿</summary>
    <p>仅在当前浏览器生成白名单定义；未保存、未回测、未授权、未激活。</p>
    <div className="ibkr-strategy-editor-grid">
      <label>用户策略 ID<input {...field('strategyId')} /></label>
      <label>版本<input {...field('version')} /></label>
      <label>策略名称<input {...field('name')} /></label>
      <label>合约 conId<input inputMode="numeric" {...field('conId')} /></label>
      <label>Bar 周期<select {...field('barInterval')}><option value="1D">1D</option><option value="1h">1h</option></select></label>
      <label>快速窗口<input inputMode="numeric" {...field('fastWindow')} /></label>
      <label>慢速窗口<input inputMode="numeric" {...field('slowWindow')} /></label>
      <label>目标整股数量<input inputMode="numeric" {...field('targetQuantity')} /></label>
      <label>最大持仓数量<input inputMode="numeric" {...field('maxPositionQuantity')} /></label>
      <label>每单费用<input inputMode="decimal" {...field('commissionPerOrder')} /></label>
      <label>每股费用<input inputMode="decimal" {...field('commissionPerShare')} /></label>
      <label>滑点 bps<input inputMode="decimal" {...field('slippageBps')} /></label>
      <label className="ibkr-strategy-editor-notes">版本说明<textarea {...field('versionNotes')} /></label>
    </div>
    <div className="ibkr-strategy-editor-actions"><button onClick={generate}>生成本地草稿</button><span>固定：收盘 SMA 交叉 · 下一根 bar · 仅多头 · 固定整股</span></div>
    {error && <p className="ibkr-backtest-error" role="alert">{error}</p>}
    {output && <pre data-testid="strategy-draft-json">{output}</pre>}
  </details>;
}
