export type PrimaryNavigationItem = { label: string; path: string; disabled?: boolean };

export const primaryNavigation: PrimaryNavigationItem[] = [
  { label: '终端大屏', path: '/terminal' },
  { label: '股票市场', path: '/market' },
  { label: '每日简报', path: '/council' },
  { label: '今日新闻', path: '/signals' },
  { label: 'AI助手', path: '/assistant' },
  { label: '定投工具', path: '/trader' }
];
