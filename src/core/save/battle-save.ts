/**
 * A battle in progress, kept so it can be taken up again after the page is closed (J7). A battle
 * is `seed + scenario + commands`: the orders given so far are enough to rebuild it exactly. The
 * state's hash after them is kept too: a version of the game that would replay them otherwise (its
 * rules or its maps changed) is caught, and the save is set aside instead of a corrupt battle.
 */
import type { BattleContext } from '../battle/context.ts';
import { hashBattleState } from '../battle/replay.ts';
import type { BattleState } from '../battle/types.ts';
import { applyCommand } from '../commands/apply.ts';
import type { Command } from '../commands/types.ts';

export const BATTLE_SAVE_VERSION = 1;

export interface BattleSave {
  readonly version: typeof BATTLE_SAVE_VERSION;
  /** The battle's identity (its kind, castle or map, plan): only that battle takes it up. */
  readonly key: string;
  /** The battle's address in the game (path and query), to take it up from the menu. */
  readonly url: string;
  /** Its name for the player: « Roche-Grise », « Bataille d’essai ». */
  readonly title: string;
  /** The round it was left at. */
  readonly turn: number;
  /** When it was saved, in milliseconds since 1970 (the browser's clock). */
  readonly savedAt: number;
  /** Heroes absent from this battle (resting), fixed when it began. */
  readonly absentHeroes: readonly string[];
  /** Every order given so far, the garrison's included. */
  readonly commands: readonly Command[];
  /** `hashBattleState` after the orders. */
  readonly hash: string;
}

/** Every kind of order, the compiler holding the list to `Command`'s: a new order cannot be forgotten. */
const COMMAND_KINDS = {
  move: true,
  attack: true,
  attackStructure: true,
  fillMoat: true,
  undermine: true,
  dockTower: true,
  climbTower: true,
  fireArrow: true,
  extinguish: true,
  overwatch: true,
  ability: true,
  summon: true,
  endTurn: true,
} as const satisfies Record<Command['type'], true>;
const COMMAND_TYPES: ReadonlySet<string> = new Set(Object.keys(COMMAND_KINDS));
/** More orders than any battle gives: a save beyond it is damaged. */
const MAX_COMMANDS = 20_000;
const MAX_TEXT_LENGTH = 512;

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT_LENGTH;

/**
 * A saved battle read back from storage (already parsed from JSON), checked: the envelope field
 * by field, each order's kind. The orders' own fields are checked by replaying them.
 */
export function parseBattleSave(raw: unknown): BattleSave | null {
  if (!isRecord(raw) || raw['version'] !== BATTLE_SAVE_VERSION) return null;
  const { key, url, title, turn, savedAt, absentHeroes, commands, hash } = raw;
  if (!isText(key) || !isText(url) || !url.startsWith('/') || !isText(title) || !isText(hash)) return null;
  if (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 1) return null;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
  if (!Array.isArray(absentHeroes) || !absentHeroes.every(isText)) return null;
  if (!Array.isArray(commands) || commands.length > MAX_COMMANDS) return null;
  if (!commands.every((c) => isRecord(c) && typeof c['type'] === 'string' && COMMAND_TYPES.has(c['type']))) return null;
  return { version: BATTLE_SAVE_VERSION, key, url, title, turn, savedAt, absentHeroes: [...absentHeroes], commands: commands as unknown as Command[], hash };
}

/**
 * The battle `initial` after the saved orders, or null when they do not lead where they led when
 * saved (another version of the game, a damaged order).
 */
export function replaySave(ctx: BattleContext, initial: BattleState, save: Pick<BattleSave, 'commands' | 'hash'>): BattleState | null {
  let state = initial;
  try {
    for (const command of save.commands) state = applyCommand(ctx, state, command).state;
  } catch {
    return null;
  }
  return hashBattleState(state) === save.hash ? state : null;
}
