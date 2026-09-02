import { useEffect, useState } from 'react';
import { Check, KeyRound, PlugZap, Save } from 'lucide-react';
import {
  aiProviders,
  defaultIntegrationSettings,
  getProviderConfig,
  loadLocalIntegrationSettings,
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
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let active = true;
    void loadLocalIntegrationSettings().then((loaded) => {
      if (!active) return;
      setSettings(loaded);
      onChange?.(loaded);
    });
    return () => { active = false; };
  }, [onChange]);

  const updateSettings = (next: IntegrationSettings) => {
    setSettings(next);
    setSaved(false);
    setConnected(false);
    onChange?.(next);
  };

  const testConnection = async () => {
    setIsTesting(true);
    setConnected(false);
    setSaveError('');
    try {
      const response = await fetch('/api/integration-settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ai: settings.ai }),
      });
      const payload = await response.json().catch(() => ({})) as { detail?: string; connected?: boolean };
      if (!response.ok || !payload.connected) throw new Error(payload.detail || `连接测试失败（${response.status}）`);
      setConnected(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setIsTesting(false);
    }
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

  const save = async () => {
    setIsSaving(true);
    setSaveError('');
    try {
      const persisted = await saveIntegrationSettings(settings);
      setSettings(persisted);
      onChange?.(persisted);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存本地配置失败');
    } finally {
      setIsSaving(false);
    }
  };

  const provider = getProviderConfig(settings.ai.provider);

  return (
    <section className="rounded-lg border border-white/10 bg-black/34 p-4 backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlugZap size={17} className="text-[#8ad7ff]" />
          <h2 className="text-base font-semibold text-white">集成设置</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void testConnection()}
            disabled={isTesting || isSaving}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#8ad7ff]/25 bg-[#8ad7ff]/[0.055] px-3 text-xs font-semibold text-[#b9e9ff] transition hover:border-[#8ad7ff]/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
          >
            {connected ? <Check size={14} /> : <PlugZap size={14} />}
            {connected ? '已连通' : isTesting ? '检测中…' : '测试连接'}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving || isTesting}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/12 bg-white/[0.045] px-3 text-xs font-semibold text-white/72 transition hover:border-[#8ad7ff]/38 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
          >
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? '已保存' : isSaving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="grid gap-3">
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
              placeholder="保存到本地配置文件"
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

      </div>
      <p className="mt-3 text-xs leading-5 text-white/42">保存后会写入本机 <code className="text-white/58">.sparkflow/integration-settings.json</code>；再次打开设置会直接读取该文件。</p>
      {saveError ? <p className="mt-2 text-xs text-rose-300">{saveError}</p> : null}
    </section>
  );
}
