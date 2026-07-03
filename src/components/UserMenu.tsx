import { useEffect, useRef, useState } from 'react';
import { Bot, Info, Settings, UserRound } from 'lucide-react';
import { IntegrationSettingsPanel } from './IntegrationSettings';

type UserMenuTab = 'profile' | 'settings' | 'about';

const tabs: Array<[UserMenuTab, string]> = [
  ['profile', '个人信息'],
  ['settings', '设置'],
  ['about', '关于']
];

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<UserMenuTab>('profile');
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/5 text-white/74 transition hover:border-[#8ad7ff]/35 hover:text-white"
        aria-label="打开个人菜单"
      >
        <UserRound size={17} strokeWidth={1.8} />
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,560px)] rounded-lg border border-white/10 bg-[#05070a]/95 p-3 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <div className="mb-3 flex items-center gap-3 border-b border-white/10 pb-3">
            <span className="grid h-11 w-11 place-items-center rounded-full border border-[#8ad7ff]/24 bg-[#8ad7ff]/10 text-[#8ad7ff]">
              <UserRound size={19} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">SparkFlow 用户</p>
              <p className="mt-1 truncate text-xs text-white/42">本地优先的情报与行动工作台</p>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-3 gap-2">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={[
                  'h-9 rounded-md border px-3 text-xs font-semibold transition',
                  tab === id ? 'border-[#8ad7ff]/42 bg-[#8ad7ff]/12 text-white' : 'border-white/10 bg-white/[0.035] text-white/52 hover:text-white'
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'profile' ? (
            <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Bot size={16} className="text-[#8ad7ff]" />
                当前能力
              </div>
              <p className="text-sm leading-6 text-white/56">
                新闻源分流、AI 模型配置、Obsidian 写入都会使用这里的本地设置。API Key 仅保存在你的浏览器 localStorage。
              </p>
            </div>
          ) : null}

          {tab === 'settings' ? <IntegrationSettingsPanel compact /> : null}

          {tab === 'about' ? (
            <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Info size={16} className="text-[#b9ffdc]" />
                关于 SparkFlow
              </div>
              <p className="text-sm leading-6 text-white/56">
                SparkFlow 是一个本地优先的个人情报控制台。国外新闻源和 OpenAI 默认可走 VPN 7890，国内服务保持直连。
              </p>
              <div className="flex items-center gap-2 text-xs text-white/38">
                <Settings size={14} />
                通用设置入口已经统一到这个个人菜单。
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
