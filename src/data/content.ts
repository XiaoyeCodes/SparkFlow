import type { LucideIcon } from 'lucide-react';
import { BookOpenText, Boxes, ChartNoAxesCombined, Newspaper, PenLine } from 'lucide-react';

export type Gateway = {
  title: string;
  path: string;
  eyebrow: string;
  Icon: LucideIcon;
  tone: 'blue' | 'green' | 'white' | 'silver' | 'warm';
};

export const gateways: Gateway[] = [
  { title: '今日新闻', path: '/signals', eyebrow: '08:30 LIVE', Icon: Newspaper, tone: 'blue' },
  { title: '股票ETF定投软件', path: '/trader', eyebrow: 'ETF CORE', Icon: ChartNoAxesCombined, tone: 'green' },
  { title: '推荐书籍', path: '/stack', eyebrow: 'READING', Icon: BookOpenText, tone: 'warm' },
  { title: '个人项目集', path: '/artifacts', eyebrow: 'SHIPPED', Icon: Boxes, tone: 'silver' },
  { title: '个人随笔', path: '/logs', eyebrow: 'NOTES', Icon: PenLine, tone: 'white' }
];

export const textFlowCorpus = [
  '夜色里有低亮度的新闻字符慢慢下沉，像一条安静的电流。',
  '市场在开盘前调整呼吸，净值曲线把风险和耐心同时折成线。',
  '写作是一种把噪声清洗成秩序的方式。',
  'SparkFlow keeps signals sparse, deliberate, and alive.',
  '从新闻到投资，从阅读到项目，每一条流都应该先经过判断，再进入行动。',
  'The interface disappears. The thinking remains visible.',
  'LUMENARY 把灵感、事实、资产与作品放进同一个冷静的流场。'
].join('   ');

export const signals = [
  ['08:30:12', 'AI infrastructure demand keeps cloud capex elevated across large platforms.'],
  ['08:37:44', 'Asia session liquidity stays thin while semiconductor names lead futures.'],
  ['08:51:09', 'Policy desks watch long-end yields after the latest inflation print.'],
  ['09:02:31', 'Energy complex softens as supply headlines outrun realized demand.'],
  ['09:20:58', 'ETF flows remain concentrated in broad-market and dividend strategies.']
];

export const books = [
  ['The Beginning of Infinity', 'David Deutsch'],
  ['Poor Charlie’s Almanack', 'Charlie Munger'],
  ['Designing Data-Intensive Applications', 'Martin Kleppmann'],
  ['A Pattern Language', 'Christopher Alexander'],
  ['The Timeless Way of Building', 'Christopher Alexander']
];

export const projects = [
  ['Signal Desk', '实时新闻过滤与行动队列'],
  ['Flow Trader', 'ETF定投与净值边界排版'],
  ['Reading Stack', '书籍、摘录与复读系统'],
  ['Artifact Wall', '作品集与发布记录']
];

export const logEntries = [
  '真正的个人主页不是简历，也不是社交名片。它更像一个安静的控制台：只让必要的信号浮上来。',
  '设计里最难的克制，是知道哪些东西明明能做，却不该在第一屏做。',
  '当文本、行情和作品都变成流，界面的任务就是把流速调到适合判断。'
];
