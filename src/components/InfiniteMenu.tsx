import { ArrowUpRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import './InfiniteMenu.css';

export type InfiniteMenuItem = {
  image: string;
  link: string;
  title: string;
  description: string;
};

type PointerState = {
  x: number;
  y: number;
  rotationX: number;
  rotationY: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function InfiniteMenu({ items, scale = 1 }: { items: InfiniteMenuItem[]; scale?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<PointerState | null>(null);
  const velocityRef = useRef({ x: 0.0018, y: 0.0028 });
  const [rotation, setRotation] = useState({ x: -0.18, y: 0.2 });
  const [activeIndex, setActiveIndex] = useState(0);

  const points = useMemo(() => {
    const count = Math.max(items.length, 1);
    return items.map((_, index) => {
      const t = (index + 0.5) / count;
      const inclination = Math.acos(1 - 2 * t);
      const azimuth = Math.PI * (1 + Math.sqrt(5)) * index;

      return {
        x: Math.sin(inclination) * Math.cos(azimuth),
        y: Math.cos(inclination),
        z: Math.sin(inclination) * Math.sin(azimuth)
      };
    });
  }, [items]);

  const projected = useMemo(() => {
    const sinX = Math.sin(rotation.x);
    const cosX = Math.cos(rotation.x);
    const sinY = Math.sin(rotation.y);
    const cosY = Math.cos(rotation.y);

    return points.map((point, index) => {
      const x1 = point.x * cosY - point.z * sinY;
      const z1 = point.x * sinY + point.z * cosY;
      const y1 = point.y * cosX - z1 * sinX;
      const z2 = point.y * sinX + z1 * cosX;
      const depth = (z2 + 1) / 2;
      const radius = 34 * scale;

      return {
        index,
        x: x1 * radius,
        y: y1 * radius,
        z: z2,
        depth,
        size: 0.62 + depth * 0.64,
        opacity: clamp(0.26 + depth * 0.86, 0.16, 1)
      };
    });
  }, [points, rotation.x, rotation.y, scale]);

  useEffect(() => {
    if (!projected.length) return;
    const nearest = [...projected].sort((a, b) => b.z - a.z)[0];
    setActiveIndex(nearest.index);
  }, [projected]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (!pointerRef.current) {
        velocityRef.current.x *= 0.992;
        velocityRef.current.y *= 0.992;
        velocityRef.current.x += (0.0018 - velocityRef.current.x) * 0.008;
        velocityRef.current.y += (0.0028 - velocityRef.current.y) * 0.008;

        setRotation((current) => ({
          x: clamp(current.x + velocityRef.current.x, -1.1, 1.1),
          y: current.y + velocityRef.current.y
        }));
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    containerRef.current?.setPointerCapture(event.pointerId);
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      rotationX: rotation.x,
      rotationY: rotation.y
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer) return;

    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    const nextX = clamp(pointer.rotationX - dy * 0.006, -1.1, 1.1);
    const nextY = pointer.rotationY + dx * 0.006;

    velocityRef.current = {
      x: (nextX - rotation.x) * 0.085,
      y: (nextY - rotation.y) * 0.085
    };
    setRotation({ x: nextX, y: nextY });
  };

  const releasePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId);
    }
    pointerRef.current = null;
  };

  const activeItem = items[activeIndex];

  const openActiveItem = () => {
    if (!activeItem?.link) return;
    window.open(activeItem.link, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      ref={containerRef}
      className="infinite-menu"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
    >
      <div className="infinite-menu__stage">
        {[...projected]
          .sort((a, b) => a.z - b.z)
          .map((item) => (
            <button
              key={items[item.index].title}
              type="button"
              className={`infinite-menu__item ${item.index === activeIndex ? 'active' : ''}`}
              style={{
                transform: `translate3d(calc(-50% + ${item.x}vw), calc(-50% + ${item.y}vh), 0) scale(${item.size})`,
                opacity: item.opacity,
                zIndex: Math.round(item.depth * 100)
              }}
              onDoubleClick={() => window.open(items[item.index].link, '_blank', 'noopener,noreferrer')}
              aria-label={`打开${items[item.index].title}`}
            >
              <img src={items[item.index].image} alt="" draggable={false} />
            </button>
          ))}
      </div>

      {activeItem ? (
        <div className="infinite-menu__hud">
          <h2 className="infinite-menu__title">{activeItem.title}</h2>
          <p className="infinite-menu__description">{activeItem.description}</p>
          <button type="button" className="infinite-menu__button" onClick={openActiveItem} aria-label={`打开${activeItem.title}`}>
            <ArrowUpRight size={24} strokeWidth={1.8} />
          </button>
          <p className="infinite-menu__hint">drag to rotate / double click to open</p>
        </div>
      ) : null}
    </div>
  );
}

export default InfiniteMenu;
