import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, Loader2, Plus, Radio, Trash2 } from 'lucide-react';
import type { CustomNewsSubscription, NewsFeed } from '../lib/newsTypes';
import { newsCategories } from '../lib/newsPresentation';

export function SignalsSourceManager({ feed, onChanged }: { feed: NewsFeed | null; onChanged: (id?: string) => Promise<void> }) {
  const [sources, setSources] = useState<CustomNewsSubscription[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [category, setCategory] = useState('world');
  const [origin, setOrigin] = useState('foreign');
  const load = async () => {
    setError('');
    try {
      const response = await fetch('/api/news-sources');
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.sources)) throw new Error(data.detail || '无法读取订阅');
      setSources(data.sources); setReady(true);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };
  useEffect(() => { void load(); }, []);

  const mutate = async (method: 'POST' | 'DELETE', body: object) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/news-sources', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '订阅操作失败');
      setSources(data.sources); setConfirmId('');
      const added = method === 'POST' ? (data.sources as CustomNewsSubscription[]).find((entry) => !sources.some((old) => old.id === entry.id)) : undefined;
      if (method === 'POST') { setLabel(''); setUrl(''); }
      setMessage(method === 'POST' ? `已验证并保存 ${data.count} 条订阅条目，正在同步新闻…` : '已移除订阅，正在更新新闻列表…');
      await onChanged(added?.id);
      setMessage(method === 'POST' ? '订阅已保存，已切换到该来源。' : '订阅已移除。');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void mutate('POST', { label, url, category, origin }); };

  return <details className="signals-subscriptions">
    <summary><Radio size={14} /><span>管理数据源 / 添加订阅</span><small>{sources.length} 个自定义</small><ChevronDown size={13} /></summary>
    <div className="signals-subscriptions-body">
      <div className="signals-subscriptions-heading"><h2>让信息源，按你的关注生长</h2><span>RSS / ATOM</span></div>
      <p>内置国际媒体使用官方 RSS，华尔街日报与路透社为明确标记的 Google News 近 24 小时检索。仅提供公开标题、摘要和文章链接，不绕过付费墙；英文源保留原文。</p>
      <form onSubmit={submit}>
        <label>来源名称<input required maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如：我的国际观察" /></label>
        <label className="signals-subscription-url">RSS / Atom 地址<input required type="url" maxLength={2048} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/feed.xml" /></label>
        <label>新闻分类<select value={category} onChange={(e) => setCategory(e.target.value)}>{newsCategories.filter(([id]) => id !== 'all').map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>来源地区<select value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="foreign">国际</option><option value="domestic">国内</option></select></label>
        <button type="submit" className="signals-action is-primary" disabled={busy || !ready}>{busy ? <Loader2 size={13} className="signals-spin" /> : <Plus size={13} />}验证并添加</button>
      </form>
      <p className="signals-subscription-hint">仅接受公开 HTTPS 的 RSS/Atom 地址，不能填写普通新闻首页。自定义源直连抓取，不访问内网、不使用本地代理；最多 20 个，保存于本项目，重启后保留。暂不支持 OPML 文件导入。</p>
      {error ? <div className="signals-message is-error" role="alert"><p>{error}</p>{!ready ? <button type="button" onClick={() => void load()}>重试</button> : null}</div> : null}
      {message ? <p role="status" className="signals-subscription-feedback">{message}</p> : null}
      <ul className="signals-custom-list">{sources.map((source) => {
        const status = feed?.sources.find((entry) => entry.id === source.id);
        return <li key={source.id}><div><strong>{source.label}</strong><span>{source.url}</span><small>{status ? status.ok ? `${status.count} 条 · 已连接` : status.error : '等待同步'}</small></div>
          {confirmId === source.id ? <div className="signals-subscription-confirm"><span>移除此订阅？</span><button type="button" disabled={busy} onClick={() => void mutate('DELETE', { id: source.id })}>确认移除</button><button type="button" onClick={() => setConfirmId('')}>取消</button></div> : <button type="button" disabled={busy} aria-label={`移除订阅 ${source.label}`} onClick={() => setConfirmId(source.id)}><Trash2 size={14} /></button>}
        </li>;
      })}</ul>
    </div>
  </details>;
}
