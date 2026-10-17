import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'ima.pins';
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    cache = [];
  }
  return cache!;
}

function write(next: string[]) {
  cache = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

/** Pinned chat guids, persisted per browser. */
export function usePins() {
  const pins = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => e.key === KEY && ((cache = null), l());
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener('storage', onStorage);
      };
    },
    read,
  );
  const toggle = useCallback((guid: string) => {
    const cur = read();
    write(cur.includes(guid) ? cur.filter((g) => g !== guid) : [...cur, guid]);
  }, []);
  return { pins, isPinned: (guid: string) => pins.includes(guid), toggle };
}
