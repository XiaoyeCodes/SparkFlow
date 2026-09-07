import { useLayoutEffect, useRef, useState } from 'react';

/** Fill spare desktop card height without letting added rows enlarge the page. */
export function useAdaptiveRows(total: number, minimum: number, selector: string, enabled = true) {
  const ref = useRef<HTMLElement>(null);
  const [capacity, setCapacity] = useState(minimum);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel || !enabled) return;
    let frame = 0;
    const measure = () => {
      if (!window.matchMedia('(min-width:1500px)').matches) {
        setCapacity(minimum);
        return;
      }
      const rows = Array.from(panel.querySelectorAll<HTMLElement>(selector));
      const last = panel.lastElementChild;
      if (!rows.length || !last) return;
      const style = getComputedStyle(panel);
      const end = last.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(last).marginBottom) || 0);
      const bottom = Math.min(panel.getBoundingClientRect().bottom, window.innerHeight - 8)
        - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth);
      const step = Math.max(...rows.map(row => row.getBoundingClientRect().height
        + (parseFloat(getComputedStyle(row.parentElement!).rowGap) || 0)));
      if (step <= 0) return;
      const next = Math.min(total, Math.max(Math.min(minimum, total), rows.length + Math.floor((bottom - end + .5) / step)));
      setCapacity(previous => previous === next ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    for (const child of panel.children) observer.observe(child);
    window.addEventListener('resize', schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); };
  });
  return { ref, count: Math.min(total, capacity) };
}
