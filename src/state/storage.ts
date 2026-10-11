/**
 * The browser's storage, used with care (J7): every read and write may fail (a private window,
 * storage full or switched off), so each is guarded and the game carries on with what it has in
 * memory. What is read back is only parsed here; its checking belongs to the caller. Other tabs'
 * writes are announced so a store can take them in, and the browser is asked once to keep the
 * game's data when it frees space.
 */

/** The JSON stored under `key`, parsed; undefined when nothing is stored or it cannot be read. */
export function readStored(key: string): unknown {
  try {
    const text = window.localStorage.getItem(key);
    return text === null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** Stores `text` under `key`; false when the browser refused (the game keeps it in memory). */
export function writeStored(key: string, text: string): boolean {
  try {
    window.localStorage.setItem(key, text);
    keepStorage();
    return true;
  } catch {
    return false;
  }
}

export function removeStored(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to remove, or no storage: nothing to do.
  }
}

/** Calls `onChange` with the new parsed value whenever another tab writes `key`. */
export function onOtherTabWrite(key: string, onChange: (value: unknown) => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key !== key) return;
    try {
      onChange(e.newValue === null ? undefined : (JSON.parse(e.newValue) as unknown));
    } catch {
      // Unreadable: ignored, our own copy stands.
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

let asked = false;

/**
 * Asks the browser, once, to keep the game's storage when it clears space (it may grant it
 * silently, or refuse: the progress is saved either way).
 */
function keepStorage(): void {
  if (asked) return;
  asked = true;
  void navigator.storage?.persist?.().catch(() => false);
}
