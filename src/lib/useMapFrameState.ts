import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

// Accumulate every input delta immediately, but commit at most once per frame.
// The ref is essential: several wheel/pointer events can arrive before React renders.
export function useMapFrameState<T>(initialValue: T) {
  const [value, setValue] = useState(initialValue);
  const latest = useRef(initialValue);
  const frame = useRef<number | null>(null);
  const update = useCallback((action: SetStateAction<T>) => {
    latest.current = typeof action === 'function'
      ? (action as (current: T) => T)(latest.current) : action;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setValue(latest.current);
    });
  }, []);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  return [value, update] as const;
}
