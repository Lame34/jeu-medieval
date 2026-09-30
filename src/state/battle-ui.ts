/**
 * What the battle HUD shows. A mirror updated on events and input, never per frame, and never
 * the simulation truth (that is the BattleSession's state).
 */
import { create } from 'zustand';
import type { AttackPreview } from '../core/battle/combat.ts';
import type { MovePlan } from '../core/battle/movement.ts';
import type { BattleState } from '../core/battle/types.ts';
import type { CommandRejection } from '../core/commands/types.ts';
import type { Threat } from '../core/battle/overwatch.ts';

export type HoverPreview =
  | { readonly kind: 'none' }
  | { readonly kind: 'move'; readonly plan: MovePlan; readonly apLeft: number; readonly threats: readonly Threat[] }
  | { readonly kind: 'attack'; readonly preview: AttackPreview }
  | { readonly kind: 'blocked'; readonly reason: CommandRejection };

export interface BattleUiState {
  readonly battle: BattleState | null;
  readonly selectedId: string | null;
  readonly hover: HoverPreview;
  /** Animations playing or the AI thinking: no orders. */
  readonly busy: boolean;
  /** Short journal lines, newest last. */
  readonly log: readonly string[];
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
  setBattle: (battle) => set({ battle }),
  select: (selectedId) => set({ selectedId, hover: { kind: 'none' } }),
  setHover: (hover) => set({ hover }),
  setBusy: (busy) => set({ busy }),
  pushLog: (lines) => set((s) => ({ log: [...s.log, ...lines].slice(-LOG_LINES) })),
  reset: () => set({ battle: null, selectedId: null, hover: { kind: 'none' }, busy: false, log: [] }),
}));
