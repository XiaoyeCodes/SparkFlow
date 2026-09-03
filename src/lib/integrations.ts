import type { NewsItem } from './newsTypes';

export type AiProviderId = 'openai' | 'zhipu' | 'deepseek' | 'qwen' | 'custom';

export type AiProviderConfig = {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  modelHint: string;
  useProxy: boolean;
};

export type IntegrationSettings = {
  ai: {
    provider: AiProviderId;
    apiKey: string;
    model: string;
    baseUrl: string;
    useProxy: boolean;
  };
  obsidian: {
    vaultPath: string;
    folder: string;
  };
};

export type { NewsCategory, NewsItem, NewsFeed } from './newsTypes';

export const aiProviders: AiProviderConfig[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelHint: '例如 gpt-4.1-mini / gpt-4o-mini',
    useProxy: true
  },
  {
    id: 'zhipu',
    label: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelHint: '例如 glm-4-flash / glm-4-plus',
    useProxy: false
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    modelHint: '例如 deepseek-chat / deepseek-reasoner',
    useProxy: false
  },
  {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelHint: '例如 qwen-plus / qwen-turbo',
    useProxy: false
  },
  {
    id: 'custom',
    label: '自定义',
    baseUrl: '',
    modelHint: '输入你的 OpenAI-compatible 模型名',
    useProxy: false
  }
];

export const defaultIntegrationSettings: IntegrationSettings = {
  ai: {
    provider: 'openai',
    apiKey: '',
    model: '',
    baseUrl: aiProviders[0].baseUrl,
    useProxy: aiProviders[0].useProxy
  },
  obsidian: {
    vaultPath: '',
    folder: 'SparkFlow/星图情报'
  }
};

export function getProviderConfig(provider: AiProviderId) {
  return aiProviders.find((item) => item.id === provider) || aiProviders[0];
}

export function loadIntegrationSettings(): IntegrationSettings {
  return defaultIntegrationSettings;
}

export async function loadLocalIntegrationSettings(): Promise<IntegrationSettings> {
  if (typeof window === 'undefined') return defaultIntegrationSettings;
  try {
    const response = await fetch('/api/integration-settings', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`读取本地配置失败（${response.status}）`);
    const payload = await response.json() as Partial<IntegrationSettings>;
    const settings: IntegrationSettings = {
      ai: { ...defaultIntegrationSettings.ai, ...(payload.ai || {}) },
      obsidian: { ...defaultIntegrationSettings.obsidian, ...(payload.obsidian || {}) },
    };
    return settings;
  } catch {
    return defaultIntegrationSettings;
  }
}

export async function saveIntegrationSettings(settings: IntegrationSettings): Promise<IntegrationSettings> {
  const response = await fetch('/api/integration-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ai: settings.ai }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(payload.detail || `保存本地配置失败（${response.status}）`);
  }
  const payload = await response.json() as Partial<IntegrationSettings>;
  const saved: IntegrationSettings = {
    ai: { ...defaultIntegrationSettings.ai, ...(payload.ai || {}) },
    obsidian: defaultIntegrationSettings.obsidian,
  };
  return saved;
}

export function buildAiPayload(_settings: IntegrationSettings, prompt: string) {
  return { prompt };
}

export function buildNewsMarkdown(items: NewsItem[], title = 'SparkFlow 新闻情报') {
  const date = new Date().toLocaleDateString('zh-CN');
  const lines = [
    `# ${title} - ${date}`,
    '',
    '## 高权重信号',
    ...items
      .slice(0, 12)
      .map((item, index) => `${index + 1}. [${item.categoryLabel} / 权重 ${item.weight}] ${item.title}（${item.source}）\n   ${item.url}`),
    '',
    '## 待验证问题',
    '- 哪些只是舆情噪声？',
    '- 哪些信号被价格、资金、政策或民生影响确认？',
    '- 哪些值得交给 AI 助手继续拆解？'
  ];
  return lines.join('\n');
}
