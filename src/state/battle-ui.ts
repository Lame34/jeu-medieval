/**
 * What the battle HUD shows. A mirror updated on events and input, never per frame, and never
 * the simulation truth (that is the BattleSession's state).
 */
import { create } from 'zustand';
import type { AttackPreview } from '../core/battle/combat.ts';
import type { MovePlan } from '../core/battle/movement.ts';
import type { BattleState } from '../core/battle/types.ts';
import type { CommandRejection } from '../core/commands/types.ts';
import type { BattleEndedEvent } from '../core/events/types.ts';
import type { Threat } from '../core/battle/overwatch.ts';
import type { StructureAttackPreview } from '../core/battle/siege.ts';
import type { StructureKind } from '../core/battle/structures.ts';
import type { AbilityPreview } from '../core/battle/heroes.ts';
import type { ShotModifier } from '../core/battle/conditions.ts';

export type HoverPreview =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly plan: MovePlan; readonly apLeft: number; readonly threats: readonly Threat[] }
  | { readonly kind: 'attack'; readonly preview: AttackPreview }
  | { readonly kind: 'structure'; readonly preview: StructureAttackPreview; readonly structure: StructureKind; readonly hp: number; readonly maxHp: number }
  | { readonly kind: 'ability'; readonly preview: AbilityPreview }
  /** An armed action's order: what it does here (and the shot's conditions, for a fire arrow). */
  | { readonly kind: 'order'; readonly title: string; readonly lines: readonly string[]; readonly conditions?: readonly ShotModifier[] }
  | { readonly kind: 'blocked'; readonly reason: CommandRejection };

export interface BattleUiState {
  readonly battle: BattleState | null;
  readonly selectedId: string | null;
  readonly hover: HoverPreview;
  /** Animations playing or the AI thinking: no orders. */
  readonly busy: boolean;
  /** Short journal lines, newest last. */
  readonly log: readonly string[];
  /** How the battle ended (the end panel). */
  readonly ending: BattleEndedEvent | null;
  /** Ending the turn with units still able to act asks twice. */
  readonly endTurnArmed: boolean;
  /** The opening briefing was read (dismissed, or the first order given). */
  readonly briefed: boolean;
  /** A unit was selected once (the "click a blue unit" hint is gone for good). */
  readonly hasSelected: boolean;
  setBriefed(): void;
  /** An action waiting for its target (ui/battle/actions.ts: the pointer aims it, a click orders it). */
  readonly armedAction: string | null;
  armAction(id: string | null): void;
  setEnding(ending: BattleEndedEvent): void;
  armEndTurn(armed: boolean): void;
  setBattle(battle: BattleState): void;
  select(id: string | null): void;
  setHover(hover: HoverPreview): void;
  setBusy(busy: boolean): void;
  pushLog(lines: readonly string[]): void;
  reset(): void;
}

const LOG_LINES = 5;
/** "Pas assez de PA. ×3": a line repeating the last one bumps its count. */
const REPEAT_MARK = ' ×';

/** Appends lines, folding a line equal to the one before it into a count. */
function appendLog(log: readonly string[], lines: readonly string[]): string[] {
  const out = [...log];
  for (const line of lines) {
    const last = out[out.length - 1];
    const base = last?.includes(REPEAT_MARK) ? last.slice(0, last.lastIndexOf(REPEAT_MARK)) : last;
    if (last !== undefined && base === line) {
      const n = last.includes(REPEAT_MARK) ? Number(last.slice(last.lastIndexOf(REPEAT_MARK) + REPEAT_MARK.length)) : 1;
      out[out.length - 1] = `${line}${REPEAT_MARK}${n + 1}`;
    } else out.push(line);
  }
  return out.slice(-LOG_LINES);
}

export const useBattleUi = create<BattleUiState>((set) => ({
  battle: null,
  selectedId: null,
  hover: { kind: 'none' },
  busy: false,
  log: [],
  ending: null,
  endTurnArmed: false,
  briefed: false,
  hasSelected: false,
  setBriefed: () => set({ briefed: true }),
  armedAction: null,
  armAction: (armedAction) => set({ armedAction, hover: { kind: 'none' } }),
  setEnding: (ending) => set({ ending }),
  armEndTurn: (endTurnArmed) => set({ endTurnArmed }),
  setBattle: (battle) => set({ battle }),
  select: (selectedId) => set((s) => ({ selectedId, hover: { kind: 'none' }, armedAction: null, hasSelected: s.hasSelected || selectedId !== null })),
  setHover: (hover) => set({ hover }),
  setBusy: (busy) => set({ busy }),
  pushLog: (lines) => set((s) => ({ log: appendLog(s.log, lines) })),
  reset: () => set({ battle: null, selectedId: null, hover: { kind: 'none' }, busy: false, log: [], ending: null, endTurnArmed: false, armedAction: null, briefed: false, hasSelected: false }),
}));
