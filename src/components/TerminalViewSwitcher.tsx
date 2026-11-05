import { BrainCircuit, Globe2, Map, Newspaper } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { MacroAiRunState } from './MacroAiAnalyst';

export type TerminalView = 'globe' | 'map' | 'ai' | 'digests';

const views = [
  { id: 'globe', title: '全息地球', label: '全息地球', icon: Globe2 },
  { id: 'map', title: '平板地图', label: '平板地图', icon: Map },
  { id: 'ai', title: 'AI 市场分析', label: '打开 AI 市场分析舱', icon: BrainCircuit },
  { id: 'digests', title: '金十财经早餐', label: '打开金十财经早餐', icon: Newspaper },
] as const;

export function TerminalViewSwitcher({ activeView, aiRunState, onChange, autoFocus = false }: {
  activeView: TerminalView;
  aiRunState: MacroAiRunState;
  onChange: (view: TerminalView) => void;
  autoFocus?: boolean;
}) {
  const activeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (autoFocus) activeButton.current?.focus();
  }, [autoFocus]);

  return <div className="macro-mode-toggle" role="group" aria-label="终端视图切换">
    {views.map(({ id, title, label, icon: Icon }) => {
      const active = activeView === id;
      const aiClass = id === 'ai'
        ? `macro-ai-toggle ${aiRunState === 'connecting' || aiRunState === 'analyzing' ? 'is-running' : ''} ${aiRunState === 'completed' ? 'is-complete' : ''}`
        : '';
      return <button
        key={id}
        ref={active ? activeButton : undefined}
        type="button"
        className={`${aiClass} ${active ? 'active' : ''}`.trim()}
        onClick={() => onChange(id)}
        title={title}
        aria-label={label}
        aria-pressed={active}
        aria-expanded={id === 'ai' || id === 'digests' ? active : undefined}
      ><Icon size={id === 'globe' || id === 'map' ? 15 : 16} strokeWidth={id === 'ai' || id === 'digests' ? 1.45 : 2} /></button>;
    })}
  </div>;
}
