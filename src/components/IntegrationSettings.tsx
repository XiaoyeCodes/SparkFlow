import { useEffect, useState } from 'react';
import { Check, KeyRound, NotebookPen, PlugZap, Save } from 'lucide-react';
import {
  aiProviders,
  defaultIntegrationSettings,
  getProviderConfig,
  loadIntegrationSettings,
  saveIntegrationSettings,
  type AiProviderId,
  type IntegrationSettings
} from '../lib/integrations';

type IntegrationSettingsProps = {
  compact?: boolean;
  onChange?: (settings: IntegrationSettings) => void;
};

export function IntegrationSettingsPanel({ compact = false, onChange }: IntegrationSettingsProps) {
  const [settings, setSettings] = useState<IntegrationSettings>(defaultIntegrationSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const loaded = loadIntegrationSettings();
    setSettings(loaded);
    onChange?.(loaded);
  }, [onChange]);

  const updateSettings = (next: IntegrationSettings) => {
    setSettings(next);
    setSaved(false);
    onChange?.(next);
  };

  const updateProvider = (providerId: AiProviderId) => {
    const provider = getProviderConfig(providerId);
    updateSettings({
      ...settings,
      ai: {
        ...settings.ai,
        provider: providerId,
        baseUrl: provider.baseUrl,
        useProxy: provider.useProxy
      }
    });
  };

  const save = () => {
    saveIntegrationSettings(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const provider = getProviderConfig(settings.ai.provider);

  return (
    <section className="rounded-lg border border-white/10 bg-black/34 p-4 backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlugZap size={17} className="text-[#8ad7ff]" />
          <h2 className="text-base font-semibold text-white">集成设置</h2>
        </div>
        <button
          type="button"
          onClick={save}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/12 bg-white/[0.045] px-3 text-xs font-semibold text-white/72 transition hover:border-[#8ad7ff]/38 hover:text-white"
        >
          {saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? '已保存' : '保存'}
        </button>
      </div>

      <div className={`grid gap-3 ${compact ? '' : 'lg:grid-cols-2'}`}>
        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#8ad7ff]/72">
            <KeyRound size={14} />
            AI Provider
          </div>
          <label className="block text-xs text-white/42">
            服务商
            <select
              value={settings.ai.provider}
              onChange={(event) => updateProvider(event.target.value as AiProviderId)}
              className="mt-2 h-10 w-full rounded-md border border-white/10 bg-black/60 px-3 text-sm text-white outline-none focus:border-[#8ad7ff]/50"
            >
              {aiProviders.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-xs text-white/42">
            API Key
            <input
              value={settings.ai.apiKey}
              onChange={(event) => updateSettings({ ...settings, ai: { ...settings.ai, apiKey: event.target.value } })}
              type="password"
              className="mt-2 h-10 w-full rounded-md border border-white/10 bg-black/60 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#8ad7ff]/50"
              placeholder="只保存在本机浏览器"
            />
          </label>
          <label className="mt-3 block text-xs text-white/42">
            模型
            <input
              value={settings.ai.model}
              onChange={(event) => updateSettings({ ...settings, ai: { ...settings.ai, model: event.target.value } })}
              className="mt-2 h-10 w-full rounded-md border border-white/10 bg-black/60 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#8ad7ff]/50"
              placeholder={provider.modelHint}
            />
          </label>
          <label className="mt-3 block text-xs text-white/42">
            Base URL
            <input
              value={settings.ai.baseUrl}
              onChange={(event) => updateSettings({ ...settings, ai: { ...settings.ai, baseUrl: event.target.value } })}
              className="mt-2 h-10 w-full rounded-md border border-white/10 bg-black/60 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#8ad7ff]/50"
              placeholder={provider.baseUrl || 'https://your-api.example.com/v1'}
            />
          </label>
          <label className="mt-3 flex items-center gap-2 text-xs text-white/54">
            <input
              type="checkbox"
              checked={settings.ai.useProxy}
              onChange={(event) => updateSettings({ ...settings, ai: { ...settings.ai, useProxy: event.target.checked } })}
              className="h-4 w-4 accent-[#8ad7ff]"
            />
            这个 AI 请求走 VPN 7890
          </label>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#b9ffdc]/72">
            <NotebookPen size={14} />
            Obsidian
          </div>
          <label className="block text-xs text-white/42">
            Vault 本地路径
            <input
              value={settings.obsidian.vaultPath}
              onChange={(event) =>
                updateSettings({ ...settings, obsidian: { ...settings.obsidian, vaultPath: event.target.value } })
              }
              className="mt-2 h-10 w-full rounded-md border border-white/10 bg-black/60 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#b9ffdc]/50"
              placeholder="例如 C:\\Users\\happy\\Documents\\MyVault"
            />
          </label>
          <label className="mt-3 block text-xs text-white/42">
            写入文件夹
            <input
              value={settings.obsidian.folder}
              onChange={(event) =>
                updateSettings({ ...settings, obsidian: { ...settings.obsidian, folder: event.target.value } })
              }
              className="mt-2 h-10 w-full rounded-md border border-white/10 bg-black/60 px-3 text-sm text-white outline-none placeholder:text-white/28 focus:border-[#b9ffdc]/50"
              placeholder="SparkFlow/星图情报"
            />
          </label>
          <p className="mt-3 text-xs leading-5 text-white/42">
            没装 Obsidian 也没关系。等你创建 vault 后，把 vault 文件夹路径填进来，SparkFlow 就会直接写入 Markdown。
          </p>
        </div>
      </div>
    </section>
  );
}
