import { useEffect, useState } from 'react';
import { Clock3, Sparkles, FileText } from 'lucide-react';
import type { AccountSchedule, WorkbenchState } from '../../lib/ibkr/workbenchTypes';
import { accountSchedules } from '../../lib/ibkr/accountSchedules';
import './AccountScheduleSettings.css';

const zoneNames = { 'Asia/Shanghai': '北京时间', 'America/New_York': '纽约时间', UTC: 'UTC' };
function stamp(value: string | null | undefined, timeZone: string) {
  return value ? new Intl.DateTimeFormat('zh-CN', { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : '—';
}
export function AccountScheduleSettings({ state, busy, save }: { state: WorkbenchState; busy: boolean; save: (value: WorkbenchState['preferences']) => void }) {
  const saved = JSON.stringify(accountSchedules(state.preferences));
  const [schedules, setSchedules] = useState(() => accountSchedules(state.preferences));
  useEffect(() => setSchedules(JSON.parse(saved)), [saved, state.snapshot.accountKey]);
  const update = (kind: 'brief' | 'analysis', patch: Partial<AccountSchedule>) => setSchedules(previous => ({ ...previous, [kind]: { ...previous[kind], ...patch } }));
  const invalid = Object.values(schedules).some(config => config.times.some(time => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) || new Set(config.times).size !== config.times.length);
  const changed = JSON.stringify(schedules) !== saved;
  return <form className="awb-panel awb-schedules" onSubmit={event => { event.preventDefault(); if (!invalid) save({ ...state.preferences, schedules, daily: schedules.brief.enabled }); }}>
    <header><div><h2><Clock3 size={18}/>定时任务</h2><p>账户简报与每日分析分别安排时间，独立开关。</p></div><span>本机服务运行时执行</span></header>
    <div className="awb-schedule-grid">{(['brief', 'analysis'] as const).map(kind => {
      const config = schedules[kind], status = state.schedules?.[kind];
      const title = kind === 'brief' ? '账户简报' : '每日 AI 分析';
      const Icon = kind === 'brief' ? FileText : Sparkles;
      const zone = config.mode === 'market-close' ? 'America/New_York' : config.timeZone;
      return <section className={`awb-schedule-card ${config.enabled ? 'enabled' : ''}`} key={kind} aria-label={`${title}定时设置`}>
        <div className="awb-schedule-title"><div><Icon size={18}/><h3>{title}</h3></div><label className="awb-schedule-switch"><input type="checkbox" role="switch" aria-label={`启用${title}定时`} checked={config.enabled} onChange={event => update(kind, { enabled: event.target.checked })}/><span>{config.enabled ? '已开启' : '已关闭'}</span></label></div>
        <p>{kind === 'brief' ? '更新「账户总览」中的简报，聚焦机会、风险与观察事项。' : '生成完整账户分析，结论与报告保存到「AI 分析」页面。'}</p>
        <div className="awb-schedule-fields"><label>执行方式<select aria-label={`${title}执行方式`} value={config.mode} onChange={event => update(kind, { mode: event.target.value as AccountSchedule['mode'] })}><option value="clock">每天指定时间</option><option value="market-close">美股收盘后 30 分钟</option></select></label>
          {config.mode === 'clock' ? <><label>时区<select aria-label={`${title}时区`} value={config.timeZone} onChange={event => update(kind, { timeZone: event.target.value as AccountSchedule['timeZone'] })}>{Object.entries(zoneNames).map(([zone, name]) => <option key={zone} value={zone}>{name}</option>)}</select></label><label>每天次数<select aria-label={`${title}每天次数`} value={config.times.length} onChange={event => {
            const count = Number(event.target.value), times = config.times.slice(0, count);
            while (times.length < count) { const available = Array.from({ length: 24 }, (_, i) => `${String((9 + i) % 24).padStart(2, '0')}:00`).find(time => !times.includes(time)); times.push(available!); }
            update(kind, { times });
          }}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1} 次</option>)}</select></label></> : <div className="awb-schedule-close">每个美股交易日 1 次<br/><small>纽约时间 · 休市跳过，提前收盘相应提前</small></div>}
        </div>
        {config.mode === 'clock' && <div className="awb-schedule-times">{config.times.map((time, index) => <label key={index}>第 {index + 1} 次<input aria-label={`${title}第 ${index + 1} 次时间`} type="time" required step="60" value={time} onChange={event => update(kind, { times: config.times.map((old, i) => i === index ? event.target.value : old) })}/></label>)}</div>}
        <div className="awb-schedule-next"><span>下次执行 · {zoneNames[zone]}</span><b>{!config.enabled ? '已关闭' : changed ? '保存后更新' : stamp(status?.nextRunAt, zone)}</b><small>{changed ? '时间修改尚未保存' : status?.detail || '等待同步调度状态'}</small>{!changed && status?.pendingAt && config.enabled && <small>待执行时点：{stamp(status.pendingAt, zone)}</small>}</div>
      </section>;
    })}</div>
    <div className="awb-schedule-save"><div><p>每日指定时间包含周末。两项同时到点会排队；停机后每项只补最近一次。保存修改后从下一个时点开始。</p><p>每次生成通常使用 1 次 AI 调用，与手动分析、问答和事件分析共享每日总上限 {state.preferences.maxAiCalls} 次（纽约日期）。纽约夏令时跳过不存在的时间，重复时间仅执行一次。</p>{invalid && <p role="alert">请填写有效时间，同一任务的执行时间不能重复。</p>}</div><button className="primary" type="submit" disabled={busy || invalid || !changed || !state.snapshot.snapshotId}>{busy ? '保存中…' : '保存定时设置'}</button></div>
  </form>;
}
