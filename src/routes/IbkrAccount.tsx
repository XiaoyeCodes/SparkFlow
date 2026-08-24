import { motion } from 'framer-motion';
import {
  Cable,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  Landmark,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleFrame } from '../components/ModuleFrame';

type IbkrStatus = {
  ok: boolean;
  connected: boolean;
  mode: 'paper';
  readonly: boolean;
  gateway: { host: string; port: number; clientId: number };
  sdkInstalled?: boolean;
  account?: string[];
  detail?: string;
  checkedAt?: string;
};

type AccountSummaryRow = {
  account?: string;
  tag?: string;
  value?: string | number;
  currency?: string;
};

type IbkrPosition = {
  account?: string;
  symbol?: string;
  local_symbol?: string;
  sec_type?: string;
  exchange?: string;
  currency?: string;
  position?: string | number;
  avg_cost?: string | number;
};

type IbkrSnapshot = IbkrStatus & {
  accounts?: string[];
  summary?: AccountSummaryRow[];
  positions?: IbkrPosition[];
  syncedAt?: string;
};

const summaryMetrics = [
  { tag: 'NetLiquidation', label: '账户净值', Icon: Landmark },
  { tag: 'TotalCashValue', label: '现金余额', Icon: CircleDollarSign },
  { tag: 'BuyingPower', label: '可用购买力', Icon: WalletCards },
  { tag: 'UnrealizedPnL', label: '未实现盈亏', Icon: RefreshCw },
] as const;

function localizeConnectionDetail(detail?: string) {
  if (!detail) return '等待检查 IB Gateway 模拟盘连接';
  if (/No TWS|socket is listening/i.test(detail)) return '未检测到 IB Gateway，请先登录模拟盘并启用 Socket API 端口 4002。';
  if (/ib_async|dependency/i.test(detail)) return 'IBKR 运行依赖尚未准备，请重新运行 start-sparkflow.bat。';
  if (/paper accounts|profile is paper/i.test(detail)) return '当前连接不是模拟账户，SparkFlow 已拒绝读取。';
  return detail;
}

function formatTime(value?: string) {
  if (!value) return '尚未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: unknown, digits = 2) {
  const parsed = toNumber(value);
  if (parsed === null) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(parsed);
}

function formatMoney(row?: AccountSummaryRow) {
  if (!row) return '—';
  const parsed = toNumber(row.value);
  if (parsed === null) return String(row.value || '—');
  const currency = row.currency && row.currency !== 'BASE' ? row.currency : '';
  return `${currency ? `${currency} ` : ''}${new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parsed)}`;
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(payload.detail || 'IBKR 请求失败');
  return payload;
}

export function IbkrAccount() {
  const [status, setStatus] = useState<IbkrStatus | null>(null);
  const [snapshot, setSnapshot] = useState<IbkrSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const checkStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const nextStatus = await requestJson<IbkrStatus>('/api/ibkr/status');
      setStatus(nextStatus);
      if (nextStatus.connected) {
        setSyncing(true);
        const nextSnapshot = await requestJson<IbkrSnapshot>('/api/ibkr/sync', { method: 'POST' });
        setSnapshot(nextSnapshot);
        setStatus(nextSnapshot);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const syncPositions = async () => {
    setSyncing(true);
    setError('');
    try {
      const next = await requestJson<IbkrSnapshot>('/api/ibkr/sync', { method: 'POST' });
      setSnapshot(next);
      setStatus(next);
      if (!next.ok) setError(localizeConnectionDetail(next.detail));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSyncing(false);
    }
  };

  const connected = Boolean(status?.connected || snapshot?.connected);
  const rowsByTag = useMemo(() => {
    const rows = snapshot?.summary || [];
    return new Map(summaryMetrics.map(({ tag }) => {
      const matches = rows.filter((row) => row.tag === tag);
      const preferred = matches.find((row) => row.currency === 'BASE') || matches.find((row) => row.currency === 'USD') || matches[0];
      return [tag, preferred] as const;
    }));
  }, [snapshot]);
  const positions = snapshot?.positions || [];
  const accountLabels = snapshot?.accounts || status?.account || [];
  const statusDetail = error || localizeConnectionDetail(status?.detail);

  return (
    <ModuleFrame title="IBKR 账户" kicker="Paper Portfolio / Read Only">
      <div className="space-y-8">
        <section className="relative overflow-hidden border-y border-white/10 bg-[#070b0d] px-5 py-6 md:px-8">
          <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(138,215,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(138,215,255,0.04)_1px,transparent_1px)] [background-size:38px_38px]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-[#75efbd]/24 bg-[#75efbd]/8 text-[#75efbd]">
                <Landmark size={22} strokeWidth={1.7} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">IB Gateway 模拟盘</h2>
                  <span className="rounded-sm border border-[#75efbd]/28 bg-[#75efbd]/8 px-2 py-1 text-[10px] font-bold tracking-[0.16em] text-[#75efbd]">PAPER</span>
                  <span className="rounded-sm border border-[#8ad7ff]/25 bg-[#8ad7ff]/8 px-2 py-1 text-[10px] font-bold tracking-[0.16em] text-[#8ad7ff]">READ ONLY</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-white/48">
                  仅从本机 <span className="font-mono text-white/72">127.0.0.1:4002</span> 读取账户摘要与持仓，不保存 IBKR 登录信息，也不开放下单接口。
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-10 items-center gap-2 border border-white/10 bg-black/20 px-3 text-xs text-white/56">
                <span className={`h-2 w-2 rounded-full ${loading ? 'animate-pulse bg-[#8ad7ff]' : connected ? 'bg-[#75efbd]' : 'bg-white/24'}`} />
                {loading ? '正在检查' : connected ? '已连接' : '未连接'}
              </div>
              <button
                type="button"
                onClick={() => void syncPositions()}
                disabled={syncing}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-[#75efbd]/34 bg-[#75efbd]/10 px-4 text-sm font-semibold text-[#b9ffdc] transition hover:bg-[#75efbd]/16 disabled:cursor-wait disabled:opacity-50"
              >
                <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                {syncing ? '正在同步' : '同步持仓'}
              </button>
            </div>
          </div>
        </section>

        {!connected ? (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-0 border border-white/10 bg-[#080a0c] lg:grid-cols-[0.8fr_1.2fr]"
          >
            <div className="border-b border-white/10 p-6 lg:border-b-0 lg:border-r lg:p-8">
              <div className="flex items-center gap-3 text-white">
                <WifiOff size={18} className="text-[#ffcf78]" />
                <h3 className="text-base font-semibold">等待 IB Gateway</h3>
              </div>
              <p className="mt-4 text-sm leading-7 text-white/52">{statusDetail}</p>
              <button
                type="button"
                onClick={() => void checkStatus()}
                disabled={loading}
                className="mt-6 inline-flex h-9 items-center gap-2 rounded-md border border-white/14 px-3 text-xs font-semibold text-white/72 transition hover:border-white/28 hover:text-white disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                重新检查
              </button>
            </div>
            <div className="p-6 lg:p-8">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-white">首次连接检查</h3>
                <a
                  href="https://www.interactivebrokers.com/en/trading/ibgateway-latest.php?menu=B"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-[#8ad7ff]/72 transition hover:text-[#8ad7ff]"
                >
                  下载 IB Gateway <ExternalLink size={13} />
                </a>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  [Cable, '登录模拟交易', '在 IB Gateway 中选择 Paper Trading 并完成登录验证。'],
                  [CheckCircle2, '启用 Socket API', 'API 设置中启用套接字客户端，端口保持 4002。'],
                  [LockKeyhole, '保持只读', '勾选 Read-Only API；SparkFlow 本身也不含订单接口。'],
                  [ShieldCheck, '只允许本机', '连接地址固定为 127.0.0.1，账户号进入浏览器前会脱敏。'],
                ].map(([Icon, title, description]) => {
                  const ItemIcon = Icon as typeof Cable;
                  return (
                    <div key={String(title)} className="flex gap-3 border-t border-white/10 pt-4">
                      <ItemIcon size={16} className="mt-0.5 shrink-0 text-[#75efbd]" />
                      <div>
                        <p className="text-sm font-semibold text-white/82">{String(title)}</p>
                        <p className="mt-1 text-xs leading-5 text-white/42">{String(description)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.section>
        ) : (
          <>
            <section>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.2em] text-[#75efbd]">ACCOUNT SNAPSHOT</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">模拟账户概览</h3>
                </div>
                <div className="text-right text-xs leading-5 text-white/38">
                  <p>{accountLabels.length ? accountLabels.join(' / ') : '账户已脱敏'}</p>
                  <p>最后同步 {formatTime(snapshot?.syncedAt || status?.checkedAt)}</p>
                </div>
              </div>
              <div className="grid border-l border-t border-white/10 sm:grid-cols-2 xl:grid-cols-4">
                {summaryMetrics.map(({ tag, label, Icon }) => {
                  const row = rowsByTag.get(tag);
                  const value = toNumber(row?.value);
                  const pnl = tag === 'UnrealizedPnL';
                  return (
                    <div key={tag} className="min-h-32 border-b border-r border-white/10 bg-[#080b0d] p-5">
                      <div className="flex items-center justify-between gap-3 text-white/42">
                        <span className="text-xs font-semibold">{label}</span>
                        <Icon size={16} />
                      </div>
                      <p className={`mt-5 break-words font-mono text-2xl font-semibold ${pnl && value !== null ? value >= 0 ? 'text-[#75efbd]' : 'text-[#ff7185]' : 'text-white'}`}>
                        {formatMoney(row)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="border-t border-white/10 pt-6">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.2em] text-[#8ad7ff]">POSITIONS</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">当前持仓</h3>
                </div>
                <span className="font-mono text-xs text-white/36">{positions.length} 项</span>
              </div>
              <div className="overflow-x-auto border border-white/10 bg-[#07090b]">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead className="border-b border-white/10 bg-white/[0.025] text-[10px] font-bold tracking-[0.14em] text-white/38">
                    <tr>
                      <th className="px-4 py-3">证券</th>
                      <th className="px-4 py-3">类型</th>
                      <th className="px-4 py-3">市场</th>
                      <th className="px-4 py-3 text-right">数量</th>
                      <th className="px-4 py-3 text-right">平均成本</th>
                      <th className="px-4 py-3">币种</th>
                      <th className="px-4 py-3">账户</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.065] text-sm text-white/70">
                    {positions.length ? positions.map((position, index) => (
                      <tr key={`${position.account}-${position.local_symbol || position.symbol}-${index}`} className="transition hover:bg-white/[0.025]">
                        <td className="px-4 py-4">
                          <p className="font-semibold text-white">{position.local_symbol || position.symbol || '—'}</p>
                          {position.local_symbol && position.symbol && position.local_symbol !== position.symbol ? <p className="mt-1 text-[10px] text-white/32">{position.symbol}</p> : null}
                        </td>
                        <td className="px-4 py-4 font-mono text-xs">{position.sec_type || '—'}</td>
                        <td className="px-4 py-4">{position.exchange || 'SMART'}</td>
                        <td className="px-4 py-4 text-right font-mono text-white">{formatNumber(position.position, 4)}</td>
                        <td className="px-4 py-4 text-right font-mono">{formatNumber(position.avg_cost)}</td>
                        <td className="px-4 py-4 font-mono text-xs">{position.currency || '—'}</td>
                        <td className="px-4 py-4 font-mono text-xs text-white/42">{position.account || '—'}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-sm text-white/38">模拟账户当前没有持仓。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <footer className="flex flex-col gap-2 border-t border-white/10 pt-5 text-xs leading-5 text-white/34 sm:flex-row sm:items-center sm:justify-between">
          <span>安全边界：模拟盘 · 只读 · 本机连接 · 账户脱敏</span>
          <span>行情权限由你的 IBKR 账户订阅决定</span>
        </footer>
      </div>
    </ModuleFrame>
  );
}
