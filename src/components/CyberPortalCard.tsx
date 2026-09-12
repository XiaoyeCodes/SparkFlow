import {
  ArrowUpRight,
  Bot,
  ChartNoAxesCombined,
  CloudSun,
  Flame,
  Globe2,
  Newspaper,
  Orbit,
  Plane,
  Radar,
  type LucideIcon
} from 'lucide-react';
import { memo, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { CyberPortal, CyberPortalIcon } from '../data/cyberPortals';
import './CyberPortalCard.css';

const portalIcons: Record<CyberPortalIcon, LucideIcon> = {
  globe: Globe2,
  radar: Radar,
  weather: CloudSun,
  market: ChartNoAxesCombined,
  brief: Newspaper,
  trends: Orbit,
  flight: Plane,
  hot: Flame,
  ai: Bot
};

type PortalCardStyle = CSSProperties & {
  '--portal-accent': string;
  '--portal-accent-rgb': string;
};

type CyberPortalCardProps = {
  portal: CyberPortal;
  accent: string;
  accentRgb: string;
  order: number;
  reducedMotion: boolean;
};

function CyberPortalCardComponent({ portal, accent, accentRgb, order, reducedMotion }: CyberPortalCardProps) {
  const cardRef = useRef<HTMLAnchorElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const Icon = portalIcons[portal.icon];
  const style: PortalCardStyle = {
    '--portal-accent': accent,
    '--portal-accent-rgb': accentRgb
  };

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  const resetCard = () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty('--pointer-x', '50%');
    card.style.setProperty('--pointer-y', '50%');
    card.style.setProperty('--rotate-x', '0deg');
    card.style.setProperty('--rotate-y', '0deg');
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (reducedMotion || event.pointerType === 'touch') return;
    const card = event.currentTarget;
    const clientX = event.clientX;
    const clientY = event.clientY;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      const bounds = card.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
      const y = Math.min(1, Math.max(0, (clientY - bounds.top) / bounds.height));
      card.style.setProperty('--pointer-x', `${(x * 100).toFixed(2)}%`);
      card.style.setProperty('--pointer-y', `${(y * 100).toFixed(2)}%`);
      card.style.setProperty('--rotate-x', `${((0.5 - y) * 8).toFixed(2)}deg`);
      card.style.setProperty('--rotate-y', `${((x - 0.5) * 10).toFixed(2)}deg`);
      frameRef.current = null;
    });
  };

  return (
    <a
      ref={cardRef}
      className="cyber-portal-card"
      data-variant={portal.variant}
      href={portal.url}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetCard}
      onBlur={resetCard}
      aria-label={`打开${portal.title}（新标签页）`}
    >
      <span className="cyber-portal-card__aura" aria-hidden="true" />
      <span className="cyber-portal-card__geometry" aria-hidden="true" />
      <span className="cyber-portal-card__scanline" aria-hidden="true" />

      <span className="cyber-portal-card__topline">
        <span className="cyber-portal-card__node">NODE / {String(order + 1).padStart(2, '0')}</span>
        <span className="cyber-portal-card__status"><i /> LIVE LINK</span>
      </span>

      <span className="cyber-portal-card__icon" aria-hidden="true">
        <Icon size={23} strokeWidth={1.55} />
      </span>

      <span className="cyber-portal-card__body">
        <span className="cyber-portal-card__english">{portal.englishTitle}</span>
        <strong>{portal.title}</strong>
        <span className="cyber-portal-card__description">{portal.description}</span>
      </span>

      <span className="cyber-portal-card__footer">
        <span>{portal.domain}</span>
        <span className="cyber-portal-card__launch" aria-hidden="true">
          ENTER <ArrowUpRight size={16} strokeWidth={1.7} />
        </span>
      </span>
    </a>
  );
}

export const CyberPortalCard = memo(CyberPortalCardComponent);
