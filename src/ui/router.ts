/** Minimal history router: three screens do not justify a routing dependency. */
import { useSyncExternalStore } from 'react';

export const ROUTES = {
  title: '/',
  lookdev: '/lookdev',
  battle: '/battle',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

const NAVIGATION_EVENT = 'siege:navigate';

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

export function navigate(path: RoutePath): void {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path + window.location.search);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}
