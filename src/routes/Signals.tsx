import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowDownWideNarrow,
  Bot,
  ExternalLink,
  Flame,
  Gauge,
  Loader2,
  Newspaper,
  NotebookPen,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { ModuleFrame } from '../components/ModuleFrame';
import { useSearchParams } from 'react-router-dom';
import {
  buildAiPayload,
  buildNewsMarkdown,
  loadIntegrationSettings,
  type NewsCategory,
  type NewsFeed,
  type NewsItem
} from '../lib/integrations';

type SortMode = 'weight' | 'time' | 'heat' | 'importance';
type CategoryFilter = 'all' | NewsCategory;

const sortOptions: Array<[SortMode, string]> = [
  ['weight', '综合权重'],
  ['time', '时间最新'],
  ['heat', '热度优先'],
  ['importance', '重要程度']
];

export function Signals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aiText, setAiText] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('weight');

  const visibleItems = useMemo(() => {
    const items = feed?.items || [];
    const filtered = category === 'all' ? items : items.filter((item) => item.category === category);
    return [...filtered].sort((a, b) => {
      if (sortMode === 'time') return new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
      if (sortMode === 'heat') return b.heat - a.heat || b.weight - a.weight;
      if (sortMode === 'importance') return b.importance - a.importance || b.weight - a.weight;
      return b.weight - a.weight || new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
    });
  }, [category, feed?.items, sortMode]);

  const markdown = useMemo(() => buildNewsMarkdown(visibleItems), [visibleItems]);

  const fetchNews = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/news-feed');
      const payload = (await response.json()) as NewsFeed & { detail?: string };
      if (!response.ok) throw new Error(payload.detail || '新闻源拉取失败');
      setFeed(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  useEffect(() => {
    const categoryParam = searchParams.get('category') as CategoryFilter | null;
    if (categoryParam && ['tech', 'finance', 'society', 'livelihood', 'world'].includes(categoryParam)) {
      setCategory(categoryParam);
    }
  }, [searchParams]);

  const summarizeWithAi = async () => {
    if (!visibleItems.length) return;
    const settings = loadIntegrationSettings();
    if (!settings.ai.apiKey || !settings.ai.model) {
      setError('请先从右上角头像菜单进入“设置”，填写 AI API Key 和模型。');
      return;
    }

    setAiLoading(true);
    setError('');
    setAiText('');
    try {
      const prompt = [
        '请把以下新闻压缩成 SparkFlow 星图情报简报。',
        '要求：1. 按分类给主信号；2. 解释权重最高的原因；3. 标注噪声与待验证问题；4. 给出下一步行动。',
        '',
        markdown
      ].join('\n');
      const response = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAiPayload(settings, prompt))
      });
      const payload = (await response.json()) as { text?: string; detail?: string };
      if (!response.ok) throw new Error(payload.detail || 'AI 摘要失败');
      setAiText(payload.text || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  };

  const saveToObsidian = async () => {
    const settings = loadIntegrationSettings();
    if (!settings.obsidian.vaultPath) {
      setError('请先从右上角头像菜单进入“设置”，填写 Obsidian Vault 本地路径。');
      return;
    }

    setSaving(true);
    setError('');
    setSaveMessage('');
    try {
      const response = await fetch('/api/obsidian-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vaultPath: settings.obsidian.vaultPath,
          folder: settings.obsidian.folder,
          title: '新闻情报',
          markdown: aiText ? `${markdown}\n\n## AI 摘要\n${aiText}` : markdown
        })
      });
      const payload = (await response.json()) as { relativePath?: string; detail?: string };
      if (!response.ok) throw new Error(payload.detail || '写入 Obsidian 失败');
      setSaveMessage(`已写入 ${payload.relativePath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModuleFrame title="今日新闻" kicker="Signals">
      <div className="grid gap-5">
        <section className="rounded-lg border border-white/10 bg-black/34 p-4 backdrop-blur-2xl">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#8ad7ff]/72">
                <Newspaper size={15} />
                News Sources
              </div>
              <p className="mt-2 text-sm leading-6 text-white/52">
                当前只显示中文新闻源。按权重综合“时间新旧、来源重要性、关键词影响、点击/讨论热度”排序。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton onClick={fetchNews} loading={loading} icon={<RefreshCw size={16} />} label="刷新新闻" />
              <ActionButton
                onClick={summarizeWithAi}
                loading={aiLoading}
                icon={<Bot size={16} />}
                label="AI 摘要"
                disabled={!visibleItems.length}
              />
              <ActionButton
                onClick={saveToObsidian}
                loading={saving}
                icon={<NotebookPen size={16} />}
                label="写入 Obsidian"
                disabled={!visibleItems.length}
              />
            </div>
          </div>

          {error ? (
            <div className="mt-4 flex gap-2 rounded-md border border-red-400/20 bg-red-400/10 p-3 text-sm leading-6 text-red-100/80">
              <AlertCircle size={16} className="mt-1 shrink-0" />
              {error}
            </div>
          ) : null}
          {saveMessage ? <p className="mt-4 text-sm text-[#b9ffdc]/78">{saveMessage}</p> : null}

          {feed ? (
            <>
              <div className="mt-4 grid gap-2 md:grid-cols-5">
                <CategoryButton
                  active={category === 'all'}
                  label="全部"
                  count={feed.items.length}
                  score={feed.items[0]?.weight || 0}
                    onClick={() => {
                      setCategory('all');
                      setSearchParams({});
                    }}
                  />
                {feed.categories.map((item) => (
                  <CategoryButton
                    key={item.id}
                    active={category === item.id}
                    label={item.label}
                    count={item.count}
                    score={item.topWeight}
                    onClick={() => {
                      setCategory(item.id);
                      setSearchParams({ category: item.id });
                    }}
                  />
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2 text-xs text-white/42">
                  <Gauge size={15} className="text-[#8ad7ff]/70" />
                  当前显示 {visibleItems.length} 条，最高权重 {visibleItems[0]?.weight || 0}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-xs text-white/42">
                    <ArrowDownWideNarrow size={14} />
                    排序
                  </span>
                  {sortOptions.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSortMode(id)}
                      className={[
                        'h-8 rounded-md border px-3 text-xs font-semibold transition',
                        sortMode === id
                          ? 'border-[#8ad7ff]/45 bg-[#8ad7ff]/12 text-white'
                          : 'border-white/10 bg-white/[0.035] text-white/48 hover:text-white'
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </section>

        {aiText ? (
          <motion.section
            className="rounded-lg border border-[#8ad7ff]/18 bg-[#8ad7ff]/[0.055] p-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#8ad7ff]/72">
              <Sparkles size={15} />
              AI Brief
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7 text-white/72">{aiText}</p>
          </motion.section>
        ) : null}

        <div className="divide-y divide-white/10 border-y border-white/10">
          {visibleItems.map((item, index) => (
            <NewsRow key={item.id} item={item} index={index} />
          ))}
          {loading && !feed ? <div className="py-10 text-center text-sm text-white/42">正在连接新闻源...</div> : null}
        </div>
      </div>
    </ModuleFrame>
  );
}

function ActionButton({
  onClick,
  loading,
  disabled,
  icon,
  label
}: {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/12 bg-white/[0.045] px-4 text-sm font-semibold text-white/72 transition hover:border-[#8ad7ff]/38 hover:text-white disabled:cursor-not-allowed disabled:text-white/35"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

function CategoryButton({
  active,
  label,
  count,
  score,
  onClick
}: {
  active: boolean;
  label: string;
  count: number;
  score: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-md border p-3 text-left transition',
        active ? 'border-[#8ad7ff]/42 bg-[#8ad7ff]/10' : 'border-white/10 bg-white/[0.035] hover:border-white/20'
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className="font-mono text-sm text-[#8ad7ff]">{score}</span>
      </div>
      <p className="mt-2 text-xs text-white/38">{count} 条 / 最高权重</p>
    </button>
  );
}

function NewsRow({ item, index }: { item: NewsItem; index: number }) {
  const time = item.publishedAt
    ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
        new Date(item.publishedAt)
      )
    : '--';

  return (
    <motion.article
      className="group grid gap-5 px-1 py-7 md:grid-cols-[170px_1fr]"
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.025, 0.4) }}
    >
      <div>
        <time className="font-mono text-sm text-[#8ad7ff]/75">{time}</time>
        <p className="mt-2 text-xs text-white/36">
          {item.source} / {item.route === 'proxy' ? 'VPN' : '直连'}
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-xs text-white/54">
          <Flame size={13} className="text-[#f3d6a0]" />
          权重 {item.weight}
        </div>
      </div>
      <div>
        <div className="mb-3 flex flex-wrap gap-2">
          <span className="rounded-full border border-[#8ad7ff]/18 bg-[#8ad7ff]/10 px-3 py-1 text-xs font-semibold text-[#8ad7ff]/78">
            {item.categoryLabel}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/48">{item.weightLabel}</span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/48">时效 {item.recency}</span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/48">重要 {item.importance}</span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/48">热度 {item.heat}</span>
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-start gap-3 text-balance text-2xl font-medium leading-[1.16] text-white/80 transition group-hover:text-white group-hover:[text-shadow:0_0_30px_rgba(138,215,255,0.42)] md:text-3xl"
        >
          <span>{item.title}</span>
          <ExternalLink size={18} className="mt-1 shrink-0 text-white/36" />
        </a>
        {item.summary ? <p className="mt-3 max-w-3xl text-sm leading-6 text-white/42">{item.summary}</p> : null}
      </div>
    </motion.article>
  );
}
