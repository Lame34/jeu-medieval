/** Minimal history router: a handful of screens do not justify a routing dependency. */
import { useSyncExternalStore } from 'react';

export const ROUTES = {
  title: '/',
  lookdev: '/lookdev',
  battle: '/battle',
  campaign: '/campagne',
  options: '/options',
  lexicon: '/lexique',
  chronicle: '/chronique',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

const NAVIGATION_EVENT = 'siege:navigate';
/** Flags of the test and bench scripts, kept from screen to screen. */
const STICKY_FLAGS = ['e2e', 'fast', 'nosound', 'bench'] as const;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATION_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATION_EVENT, onChange);
  };
}

function currentPath(): string {
  return window.location.pathname;
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

/** Goes to `path` with `params` in the query (the scripts' flags stay). */
export function navigate(path: RoutePath, params: Readonly<Record<string, string>> = {}): void {
  const current = new URLSearchParams(window.location.search);
  const parts: string[] = [];
  for (const flag of STICKY_FLAGS) if (current.has(flag)) parts.push(flag);
  for (const [k, v] of Object.entries(params)) parts.push(v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const url = path + (parts.length > 0 ? `?${parts.join('&')}` : '');
  if (url === window.location.pathname + window.location.search) return;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}
