/**
 * The battle in progress, saved in the browser after every order (J7) so that closing the page,
 * a reload or a crash costs nothing: one battle at a time, taken up from the title menu, the
 * castle's letter or the battle itself. The format and its checks are in core/save/battle-save.ts.
 */
import { BATTLE_SAVE_VERSION, parseBattleSave, type BattleSave } from '../core/save/battle-save.ts';
import { readStored, removeStored, writeStored } from './storage.ts';

export const BATTLE_SAVE_KEY = 'siege.battle.v1';

/** The saved battle, checked, or null. */
export function loadBattleSave(): BattleSave | null {
  return parseBattleSave(readStored(BATTLE_SAVE_KEY));
}

/** Saves the battle (replacing any other one); false when the browser refused. */
export function storeBattleSave(save: Omit<BattleSave, 'version'>): boolean {
  return writeStored(BATTLE_SAVE_KEY, JSON.stringify({ version: BATTLE_SAVE_VERSION, ...save }));
}

export function clearBattleSave(): void {
  removeStored(BATTLE_SAVE_KEY);
}

/** The query that takes the saved battle up at once (its address, and `resume`). */
export function resumeParams(save: BattleSave): Record<string, string> {
  const query = save.url.includes('?') ? save.url.slice(save.url.indexOf('?') + 1) : '';
  return { ...Object.fromEntries(new URLSearchParams(query)), resume: '' };
}

/** Is the save this campaign castle's battle (or the trial's, for the lesson)? */
export function isSaveOf(save: BattleSave | null, castleId: string, lesson: boolean): boolean {
  if (!save) return false;
  return lesson ? save.key === 'tutorial' : save.key.startsWith(`campaign:${castleId}:`);
}

/** « le 11 octobre à 15 h 20 », the save's date for the player. */
export function savedAtLabel(savedAt: number): string {
  const d = new Date(savedAt);
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `le ${day} à ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
}
