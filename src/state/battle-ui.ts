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

const LOG_LINES = 8;

export const useBattleUi = create<BattleUiState>((set) => ({
  battle: null,
  selectedId: null,
  hover: { kind: 'none' },
  busy: false,
  log: [],
  ending: null,
  endTurnArmed: false,
  armedAction: null,
  armAction: (armedAction) => set({ armedAction, hover: { kind: 'none' } }),
  setEnding: (ending) => set({ ending }),
  armEndTurn: (endTurnArmed) => set({ endTurnArmed }),
  setBattle: (battle) => set({ battle }),
  select: (selectedId) => set({ selectedId, hover: { kind: 'none' }, armedAction: null }),
  setHover: (hover) => set({ hover }),
  setBusy: (busy) => set({ busy }),
  pushLog: (lines) => set((s) => ({ log: [...s.log, ...lines].slice(-LOG_LINES) })),
  reset: () => set({ battle: null, selectedId: null, hover: { kind: 'none' }, busy: false, log: [], ending: null, endTurnArmed: false, armedAction: null }),
}));
