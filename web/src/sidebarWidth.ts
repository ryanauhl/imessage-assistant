import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'ima.sidebarWidth';
export const MIN_WIDTH = 220;
export const MAX_WIDTH = 620;
export const DEFAULT_WIDTH = 320;

const clamp = (n: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));

function load(): number {
  const raw = Number(localStorage.getItem(KEY));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : DEFAULT_WIDTH;
}

/** Drag-to-resize for the conversation list, persisted per browser. */
export function useSidebarWidth() {
  const [width, setWidth] = useState(load);
  const [dragging, setDragging] = useState(false);
  const frame = useRef(0);

  useEffect(() => {
    localStorage.setItem(KEY, String(width));
  }, [width]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      // Throttle to one update per frame so dragging stays smooth with long chat lists.
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => setWidth(clamp(ev.clientX)));
    };
    const onUp = () => {
      cancelAnimationFrame(frame.current);
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const reset = useCallback(() => setWidth(DEFAULT_WIDTH), []);
  return { width, startDrag, reset, dragging };
}
