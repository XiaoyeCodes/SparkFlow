import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ExternalLink, Flame, Loader2, RefreshCw } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { PageTransition } from '../components/PageTransition';
import './DailyHot.css';

const DAILY_HOT_REPOSITORY = 'https://github.com/imsyy/DailyHot';

type FrameState = 'loading' | 'opened' | 'slow' | 'error';
type ServiceStatus = { state: 'starting' | 'ready' | 'error' | 'stopped'; frontendUrl?: string; error?: string; pid?: number };

function readServiceStatus(value: ServiceStatus): ServiceStatus {
  if (value.state === 'ready') {
    const url = new URL(value.frontendUrl || '');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('热榜服务返回了无效的本地地址');
  }
  if (!['starting', 'ready', 'error', 'stopped'].includes(value.state)) throw new Error('无法识别热榜服务状态');
  return value;
}

export function DailyHot() {
  const { search } = useLocation();
  const [attempt, setAttempt] = useState(0);
  const [frameState, setFrameState] = useState<FrameState>('loading');
  const [service, setService] = useState<ServiceStatus>({ state: 'starting' });

  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    const check = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch('/api/dailyhot/status', { signal: controller.signal });
        if (!response.ok) throw new Error(`本地服务状态读取失败（HTTP ${response.status}）`);
        const next = readServiceStatus(await response.json());
        if (!controller.signal.aborted) setService(next);
      } catch (error) {
        if (!controller.signal.aborted) setService({ state: 'error', error: error instanceof Error ? error.message : String(error) });
      } finally { polling = false; }
    };
    void check();
    const interval = window.setInterval(check, 5000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    setFrameState('loading');
    if (!service.frontendUrl) return;
    const timer = window.setTimeout(() => {
      setFrameState((state) => state === 'loading' ? 'slow' : state);
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [attempt, service.frontendUrl]);

  const reload = async () => {
    setFrameState('loading');
    setAttempt((value) => value + 1);
    try {
      const response = await fetch('/api/dailyhot/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || '本地热榜服务启动失败');
      setService(readServiceStatus(next));
    } catch (error) { setService({ state: 'error', error: error instanceof Error ? error.message : String(error) }); }
  };

  return (
    <PageTransition>
      <div className="daily-hot-page">
        <div className="daily-hot-shell">
          <header className="daily-hot-header">
            <div className="daily-hot-heading">
              <Link to={`/signals${search}`} className="daily-hot-back"><ArrowLeft size={14} />返回今日新闻</Link>
              <h1><Flame size={22} aria-hidden="true" />今日热榜 <span>DAILYHOT</span></h1>
              <p>各平台热门榜单 · 本地部署 · 基于 <a href={DAILY_HOT_REPOSITORY} target="_blank" rel="noopener noreferrer">imsyy / DailyHot</a> 与 DailyHotApi 2.0.8</p>
            </div>
            <div className="daily-hot-actions">
              <button type="button" onClick={reload}><RefreshCw size={14} />重新加载</button>
              {service.state === 'ready' ? <a href={service.frontendUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />新窗口打开</a> : null}
            </div>
          </header>

          <div className="daily-hot-help" role="status" aria-live="polite">
            {service.state !== 'ready' ? '正在检查项目管理的热榜服务…' : frameState === 'loading' ? <><Loader2 size={13} className="daily-hot-spin" />正在加载本地热榜页面…</> : frameState === 'slow' ? '页面加载较慢，可以重新加载或在新窗口打开。' : frameState === 'error' ? '暂时无法打开本地页面，请重新加载。' : `本地服务运行中 · PID ${service.pid} · 各平台的获取结果以卡片显示为准。`}
          </div>

          <div className="daily-hot-frame-shell">
            {service.state === 'ready' ? <iframe
              key={`${service.frontendUrl}-${attempt}`}
              src={service.frontendUrl}
              title="DailyHot 今日热榜"
              className="daily-hot-frame"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              // The local child has a distinct port/origin to isolate storage.
              // A frame navigation does not imply every upstream board succeeded.
              onLoad={() => setFrameState('opened')}
              onError={() => setFrameState('error')}
            /> : <div className="daily-hot-service-state" role={service.state === 'error' ? 'alert' : 'status'}>
              {service.state === 'error' ? <AlertCircle size={26} /> : <Loader2 size={26} className="daily-hot-spin" />}
              <h2>{service.state === 'error' ? '本地热榜服务暂不可用' : '正在启动热榜服务'}</h2>
              <p>{service.error || 'DailyHot 前端和 API 由 SparkFlow 自动管理，无需单独开启终端。'}</p>
              {service.state === 'error' ? <button type="button" onClick={reload}>重试启动</button> : null}
            </div>}
          </div>
          <p className="daily-hot-footer">前端与 API 随 SparkFlow 启动和停止，使用独立内存缓存，不依赖作者演示站。不参与新闻评分；部分平台可能因登录验证、限流或接口变动而不可用。</p>
        </div>
      </div>
    </PageTransition>
  );
}
