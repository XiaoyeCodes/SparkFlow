import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  Binary,
  Bot,
  BrainCircuit,
  Check,
  ClipboardCheck,
  Copy,
  Crosshair,
  Eye,
  Loader2,
  NotebookPen,
  Radar,
  Satellite,
  Sparkles
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { BorderGlow } from '../components/BorderGlow';
import { GridScan } from '../components/GridScan';
import { PageTransition } from '../components/PageTransition';
import { loadIntegrationSettings } from '../lib/integrations';

type ScanState = 'idle' | 'scanning' | 'ready';

const watchlistKey = 'sparkflow.starmap.watchlist.v1';

const signalRows = [
  ['宏观轨道', '利率、美元、流动性仍是主控变量', 'WATCH', '63'],
  ['产业星座', 'AI 算力、电力设备、半导体链条保持活跃', 'ACTIVE', '82'],
  ['舆情噪声', '热点扩散过快，等待价格与成交二次确认', 'FILTER', '41'],
  ['资产引力', '高质量现金流仍在吸收长期资金', 'LONG', '76']
];

const intelCards = [
  {
    title: '观察焦点',
    body: '把新闻、行情和长期主题叠到同一张图上，优先寻找正在形成合力的信号。',
    Icon: Crosshair
  },
  {
    title: '情报分层',
    body: '先区分事实、解释、价格反应，再判断它是噪声、线索还是可执行机会。',
    Icon: BrainCircuit
  },
  {
    title: '行动窗口',
    body: '只在证据密度足够时推进下一步，避免被单点刺激拖进临时判断。',
    Icon: Satellite
  }
];

const scanSteps = ['读取新闻与信号流', '归并宏观、产业、社会与民生主题', '压缩成可行动的情报摘要'];

const themes = [
  ['AI 基建', 86, '#8ad7ff'],
  ['半导体链', 73, '#b9ffdc'],
  ['美元流动性', 58, '#f3d6a0'],
  ['民生政策', 64, '#c4b5fd']
];

const nextActions = [
  ['观察', '保留 AI 算力链，但等待成交量和政策信号二次确认。'],
  ['追踪', '把电力设备、半导体、云厂商资本开支放入同一主题组。'],
  ['复盘', '记录今天的主信号和未确认问题，明天对照验证。']
];

function buildMarkdown(dateLabel: string) {
  return [
    `# 星图情报 - ${dateLabel}`,
    '',
    '## 主信号',
    'AI 算力链继续升温，但情绪偏拥挤，需要等待价格、成交量与政策侧信号二次确认。',
    '',
    '## 相关主题',
    '- AI 基建',
    '- 半导体链',
    '- 美元流动性',
    '- 民生政策',
    '',
    '## 风险提示',
    '新闻热度高于价格确认，暂不进入强行动队列。',
    '',
    '## 下一步动作',
    '- 观察 AI 算力链成交量',
    '- 追踪电力设备与云厂商资本开支',
    '- 打开信号源，按综合权重查看相关新闻',
    '- 明日复盘主信号是否被价格确认'
  ].join('\n');
}

function addWatchItem(markdown: string) {
  const raw = window.localStorage.getItem(watchlistKey);
  const items = raw ? (JSON.parse(raw) as Array<{ id: string; title: string; createdAt: string; markdown: string }>) : [];
  const next = [
    {
      id: `starmap-${Date.now()}`,
      title: 'AI 算力链观察',
      createdAt: new Date().toISOString(),
      markdown
    },
    ...items
  ].slice(0, 30);
  window.localStorage.setItem(watchlistKey, JSON.stringify(next));
  return next.length;
}

export function Starmap() {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanTrigger, setScanTrigger] = useState(0);
  const [copied, setCopied] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteMessage, setNoteMessage] = useState('');
  const [watchlisted, setWatchlisted] = useState(false);
  const scanTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date()),
    []
  );
  const markdown = useMemo(() => buildMarkdown(dateLabel), [dateLabel]);

  useEffect(() => {
    return () => {
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const startScan = () => {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    setCopied(false);
    setNoteMessage('');
    setScanState('scanning');
    setScanTrigger((value) => value + 1);
    scanTimerRef.current = window.setTimeout(() => {
      setScanState('ready');
      scanTimerRef.current = null;
    }, 1850);
  };

  const addToWatchlist = () => {
    const count = addWatchItem(markdown);
    setWatchlisted(true);
    setNoteMessage(`已加入观察队列，目前保留 ${count} 条星图记录。`);
  };

  const writeMarkdown = async () => {
    const settings = loadIntegrationSettings();
    setNoteMessage('');
    if (settings.obsidian.vaultPath) {
      setSavingNote(true);
      try {
        const response = await fetch('/api/obsidian-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vaultPath: settings.obsidian.vaultPath,
            folder: settings.obsidian.folder,
            title: '星图情报',
            markdown
          })
        });
        const payload = (await response.json()) as { relativePath?: string; detail?: string };
        if (!response.ok) throw new Error(payload.detail || '写入 Obsidian 失败');
        setCopied(true);
        setNoteMessage(`已写入 Obsidian：${payload.relativePath}`);
      } catch (error) {
        setNoteMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setSavingNote(false);
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = markdown;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }

    setCopied(true);
    setNoteMessage('未配置 Obsidian Vault，已复制 Markdown。可从右上角头像菜单进入设置。');
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimerRef.current = null;
    }, 1800);
  };

  return (
    <PageTransition>
      <section className="relative min-h-[calc(100vh-var(--nav-height))] overflow-hidden bg-black text-white">
        <div className="absolute inset-0">
          <GridScan
            sensitivity={0.7}
            lineThickness={1.15}
            linesColor="#28506f"
            gridScale={0.078}
            lineStyle="solid"
            lineJitter={0.18}
            scanColor="#8ad7ff"
            scanOpacity={0.55}
            scanDirection="pingpong"
            scanSoftness={1.55}
            scanGlow={0.95}
            scanDuration={2.8}
            scanDelay={1.2}
            bloomIntensity={0.52}
            bloomThreshold={0.02}
            bloomSmoothing={0.18}
            chromaticAberration={0.0017}
            noiseIntensity={0.018}
            scanOnClick
            scanTrigger={scanTrigger}
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(138,215,255,0.18),transparent_26%),linear-gradient(90deg,rgba(0,0,0,0.74),rgba(0,0,0,0.26)_48%,rgba(0,0,0,0.78)),linear-gradient(180deg,rgba(0,0,0,0.28),rgba(0,0,0,0.82)_82%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8ad7ff]/50 to-transparent" />

        <div className="relative z-10 mx-auto grid w-full max-w-7xl gap-8 px-5 pb-10 pt-8 md:px-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end lg:pt-12">
          <motion.div
            initial={{ opacity: 0, y: 22, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.62, ease: [0.19, 1, 0.22, 1] }}
          >
            <p className="mb-5 inline-flex items-center gap-2 border-l border-[#8ad7ff]/45 pl-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#8ad7ff]/72">
              <Radar size={15} strokeWidth={1.7} />
              Starmap Intelligence
            </p>
            <h1 className="max-w-3xl text-balance text-6xl font-semibold leading-[0.92] text-white md:text-8xl">
              星图情报
            </h1>
            <p className="mt-7 max-w-xl text-base leading-8 text-white/62 md:text-lg">
              用一张动态信号网承接每日信息：从宏观轨道到产业星座，再到可执行的行动窗口。
            </p>

            <motion.div
              className="mt-10 flex max-w-xl justify-center md:justify-start lg:justify-center"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.48, delay: 0.18, ease: [0.19, 1, 0.22, 1] }}
            >
              <BorderGlow
                animated={scanState === 'idle'}
                edgeSensitivity={48}
                glowColor="198 96 72"
                backgroundColor="rgba(2, 8, 14, 0.78)"
                borderRadius={999}
                glowRadius={42}
                glowIntensity={1.15}
                coneSpread={30}
                fillOpacity={0.36}
                colors={['#8ad7ff', '#b9ffdc', '#f3d6a0']}
                className="starmap-action-glow"
              >
                <button
                  type="button"
                  onClick={startScan}
                  disabled={scanState === 'scanning'}
                  className="group inline-flex h-14 min-w-[220px] items-center justify-center gap-3 rounded-full px-6 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] outline-none transition hover:text-white focus-visible:ring-2 focus-visible:ring-[#8ad7ff]/70 disabled:cursor-wait disabled:text-white/62"
                >
                  {scanState === 'scanning' ? (
                    <Loader2 size={17} strokeWidth={1.8} className="animate-spin" />
                  ) : (
                    <Sparkles size={17} strokeWidth={1.8} />
                  )}
                  <span className="tracking-[0.08em]">
                    {scanState === 'idle' ? '启动星图扫描' : scanState === 'scanning' ? '扫描中...' : '重新扫描星图'}
                  </span>
                  {scanState !== 'scanning' ? (
                    <ArrowUpRight size={17} strokeWidth={1.8} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  ) : null}
                </button>
              </BorderGlow>
            </motion.div>

            <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-3">
              {intelCards.map((item, index) => {
                const Icon = item.Icon;
                return (
                  <motion.article
                    key={item.title}
                    className="rounded-lg border border-white/10 bg-black/34 p-4 backdrop-blur-2xl"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.42, delay: 0.12 + index * 0.06 }}
                  >
                    <Icon className="text-[#8ad7ff]" size={18} strokeWidth={1.7} />
                    <h2 className="mt-4 text-sm font-semibold text-white">{item.title}</h2>
                    <p className="mt-2 text-xs leading-5 text-white/48">{item.body}</p>
                  </motion.article>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            className="rounded-lg border border-white/10 bg-black/42 p-4 shadow-[0_0_90px_rgba(138,215,255,0.12)] backdrop-blur-2xl md:p-5"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.68, delay: 0.1, ease: [0.19, 1, 0.22, 1] }}
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-md border border-[#8ad7ff]/28 bg-[#8ad7ff]/10 text-[#8ad7ff]">
                  <Binary size={19} strokeWidth={1.7} />
                </span>
                <div>
                  <h2 className="text-xl font-semibold">{scanState === 'ready' ? '今日星图' : '情报扫描台'}</h2>
                  <p className="mt-1 text-xs text-white/42">
                    {scanState === 'ready' ? `${dateLabel} / signal synthesis` : 'Signal constellation / live synthesis'}
                  </p>
                </div>
              </div>
              <Link
                to="/signals?category=tech"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-white/5 text-white/68 transition hover:border-white/28 hover:text-white"
                aria-label="打开信号源"
              >
                <ArrowUpRight size={17} strokeWidth={1.8} />
              </Link>
            </div>

            {scanState === 'scanning' ? (
              <div className="mt-4 grid gap-3">
                {scanSteps.map((step, index) => (
                  <motion.div
                    key={step}
                    className="flex items-center gap-3 rounded-lg border border-[#8ad7ff]/18 bg-[#8ad7ff]/[0.055] p-4"
                    initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.32, delay: index * 0.12 }}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#8ad7ff]/22 bg-black/35 text-[#8ad7ff]">
                      <Loader2 size={16} className="animate-spin" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">{step}</p>
                      <p className="mt-1 text-xs text-white/40">Calibrating constellation node {index + 1}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : null}

            {scanState !== 'ready' ? (
              <div className="mt-4 grid gap-3">
                {signalRows.map(([name, body, status, score], index) => (
                  <motion.article
                    key={name}
                    className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.045] p-4 md:grid-cols-[1fr_auto]"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: scanState === 'scanning' ? 0.48 : 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.2 + index * 0.055 }}
                  >
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[#8ad7ff] shadow-[0_0_18px_rgba(138,215,255,0.85)]" />
                        <h3 className="text-base font-semibold text-white">{name}</h3>
                      </div>
                      <p className="text-sm leading-6 text-white/52">{body}</p>
                    </div>
                    <div className="flex items-center gap-3 md:justify-end">
                      <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-white/50">
                        {status}
                      </span>
                      <span className="font-mono text-2xl text-[#8ad7ff]">{score}</span>
                    </div>
                  </motion.article>
                ))}
              </div>
            ) : (
              <motion.div className="mt-4" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42 }}>
                <div className="rounded-lg border border-[#8ad7ff]/18 bg-[#8ad7ff]/[0.065] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#8ad7ff]/72">
                      <ClipboardCheck size={15} />
                      Primary signal
                    </div>
                    <span className="rounded-full border border-[#b9ffdc]/22 bg-[#b9ffdc]/10 px-3 py-1 text-[11px] font-semibold text-[#b9ffdc]/82">
                      CONFIDENCE 72
                    </span>
                  </div>
                  <p className="text-lg font-semibold leading-7 text-white">
                    AI 算力链继续升温，但情绪偏拥挤，需要等待价格、成交量与政策侧信号二次确认。
                  </p>
                  <p className="mt-3 text-sm leading-6 text-white/56">当前更适合进入观察与验证队列，而不是直接推进行动决策。</p>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {themes.map(([theme, score, color]) => (
                    <div key={theme} className="rounded-lg border border-white/10 bg-white/[0.045] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-white">{theme}</span>
                        <span className="font-mono text-sm text-white/52">{score}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: color as string }}
                          initial={{ width: 0 }}
                          animate={{ width: `${score}%` }}
                          transition={{ duration: 0.7, ease: [0.19, 1, 0.22, 1] }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid gap-3">
                  {nextActions.map(([label, body], index) => (
                    <div key={label} className="flex gap-3 rounded-lg border border-white/10 bg-black/28 p-4">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.045] font-mono text-xs text-[#f3d6a0]">
                        0{index + 1}
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold text-white">{label}</h3>
                        <p className="mt-1 text-sm leading-6 text-white/52">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={addToWatchlist}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.045] px-4 text-sm font-semibold text-white/72 transition hover:border-[#8ad7ff]/38 hover:text-white"
                  >
                    {watchlisted ? <Check size={16} /> : <Eye size={16} />}
                    {watchlisted ? '已加入观察' : '加入观察'}
                  </button>
                  <Link
                    to="/assistant"
                    state={{ starmapContext: markdown }}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.045] px-4 text-sm font-semibold text-white/72 transition hover:border-[#8ad7ff]/38 hover:text-white"
                  >
                    <Bot size={16} />
                    交给 AI 助手
                  </Link>
                  <Link
                    to="/signals?category=tech"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.045] px-4 text-sm font-semibold text-white/72 transition hover:border-[#8ad7ff]/38 hover:text-white"
                  >
                    <Activity size={16} />
                    打开信号源
                  </Link>
                  <button
                    type="button"
                    onClick={writeMarkdown}
                    disabled={savingNote}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/12 bg-white/[0.045] px-4 text-sm font-semibold text-white/72 transition hover:border-[#b9ffdc]/38 hover:text-white disabled:cursor-wait disabled:text-white/40"
                  >
                    {savingNote ? <Loader2 size={16} className="animate-spin" /> : copied ? <Copy size={16} /> : <NotebookPen size={16} />}
                    {savingNote ? '写入中...' : copied ? '已处理 Markdown' : '写入黑曜石'}
                  </button>
                </div>
                {noteMessage ? <p className="mt-3 text-sm text-[#b9ffdc]/72">{noteMessage}</p> : null}
              </motion.div>
            )}

            {scanState !== 'ready' ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-[#b9ffdc]/18 bg-[#b9ffdc]/8 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#b9ffdc]/70">
                    <Sparkles size={15} />
                    Next read
                  </div>
                  <p className="text-sm leading-6 text-white/62">等待价格、成交量和新闻叙事同步确认后，再把主题推进到行动队列。</p>
                </div>
                <div className="rounded-lg border border-[#ffd27a]/18 bg-[#ffd27a]/8 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#ffd27a]/70">
                    <Activity size={15} />
                    Risk note
                  </div>
                  <p className="text-sm leading-6 text-white/62">热度过高时降低仓位语言，只保留观察、验证和复盘三个动作。</p>
                </div>
              </div>
            ) : null}
          </motion.div>
        </div>
      </section>
    </PageTransition>
  );
}
