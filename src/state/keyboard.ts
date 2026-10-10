/**
 * The letters printed on the player's keys. The camera and the orders listen to physical key
 * codes (KeyW is Z on an AZERTY keyboard, W on a QWERTY one); the lessons and the options name
 * the keys as the player's own keyboard prints them, read through the Keyboard API where the
 * browser has it (Chromium), AZERTY otherwise (the game speaks French).
 */
import { create } from 'zustand';

/** The camera's keys on an AZERTY keyboard (the default when the layout cannot be read). */
const AZERTY: Readonly<Record<string, string>> = { KeyW: 'Z', KeyA: 'Q', KeyS: 'S', KeyD: 'D', KeyQ: 'A', KeyE: 'E' };

interface KeyboardLayoutMap {
  get(code: string): string | undefined;
}
interface KeyboardApi {
  getLayoutMap(): Promise<KeyboardLayoutMap>;
}

interface KeyLabels {
  readonly layout: KeyboardLayoutMap | null;
}

export const useKeyLabels = create<KeyLabels>(() => ({ layout: null }));

/** Reads the layout once (silently ignored where the API is missing or refused). */
export function loadKeyboardLayout(): void {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard;
  keyboard
    ?.getLayoutMap()
    .then((layout) => useKeyLabels.setState({ layout }))
    .catch(() => undefined);
}

/** The letter printed on the key of `code` (e.g. KeyW → "Z" on AZERTY). */
export function keyLabel(layout: KeyboardLayoutMap | null, code: string): string {
  return (layout?.get(code) ?? AZERTY[code] ?? code.replace(/^Key/, '')).toUpperCase();
}

/** The camera's keys as printed: move (forward, left, back, right) and turn (left, right). */
export function cameraKeys(layout: KeyboardLayoutMap | null): { readonly move: readonly string[]; readonly turn: readonly string[] } {
  return { move: ['KeyW', 'KeyA', 'KeyS', 'KeyD'].map((c) => keyLabel(layout, c)), turn: ['KeyQ', 'KeyE'].map((c) => keyLabel(layout, c)) };
}
