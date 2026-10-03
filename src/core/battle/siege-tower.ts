/**
 * The siege tower (J4, brief §9.4 and §9.8 « Tour de siège »): pushed against a curtain segment —
 * across a filled stretch of moat, or along the berm once the drawbridge is down — it docks,
 * lowering its gangway onto the wall-walk, and from then on carries up to `towerCapacity` units a
 * turn from its foot onto the rampart, `towerClimbAp` AP each. A docked tower no longer moves;
 * it is released when its segment comes down or when it is destroyed.
 */
import type { CommandRejection } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import { distance, normalize, sub, type Vec2 } from '../math/vec2.ts';
import { isPassable } from '../nav-grid/nav-grid.ts';
import { faceTowards } from './combat.ts';
import type { BattleContext } from './context.ts';
import { findUnit, occupancy, unitType } from './movement.ts';
import { distanceToCells } from './siege.ts';
import { isBroken, structureDef, syncNav } from './structures.ts';
import type { BattleState, DockState, UnitState } from './types.ts';

/** Units carrying others onto a wall (the siege tower). */
export const TOWER_TAG = 'transport4';
/** A unit climbs from within this distance of the tower's centre (m). */
export const CLIMB_REACH_M = 2.2;

export function dockOf(state: BattleState, towerId: string): DockState | undefined {
  return state.docks.find((d) => d.towerId === towerId);
}

export interface DockPreview {
  readonly towerId: string;
  readonly structureId: string;
}

export interface ClimbPreview {
  readonly unitId: string;
  readonly towerId: string;
  readonly to: Vec2;
  readonly apCost: number;
}

export type DockPreviewResult = { readonly ok: true; readonly preview: DockPreview } | { readonly ok: false; readonly reason: CommandRejection };
export type ClimbPreviewResult = { readonly ok: true; readonly preview: ClimbPreview } | { readonly ok: false; readonly reason: CommandRejection };

function actingUnit(state: BattleState, unitId: string): UnitState | CommandRejection {
  const unit = findUnit(state, unitId);
  if (!unit) return 'unknownUnit';
  if (!unit.alive) return 'unitDead';
  if (unit.faction !== state.activeFaction) return 'notYourTurn';
  return unit;
}

export function previewDock(ctx: BattleContext, state: BattleState, towerId: string, structureId: string): DockPreviewResult {
  syncNav(ctx, state.structures, state.works);
  const tower = actingUnit(state, towerId);
  if (typeof tower === 'string') return { ok: false, reason: tower };
  if (!unitType(ctx, tower).tags.includes(TOWER_TAG)) return { ok: false, reason: 'notATower' };
  if (dockOf(state, towerId)) return { ok: false, reason: 'alreadyDocked' };
  const def = structureDef(ctx, structureId);
  if (!def) return { ok: false, reason: 'unknownStructure' };
  if (def.kind !== 'wall') return { ok: false, reason: 'notAWall' };
  if (isBroken(state.structures, def.id)) return { ok: false, reason: 'structureDown' };
  if (tower.actions <= 0) return { ok: false, reason: 'noActionLeft' };
  if (tower.ap < ctx.rules.damage.attackApCost) return { ok: false, reason: 'insufficientAp' };
  if (distanceToCells(ctx, def.cells, tower.position) > ctx.rules.structures.towerDockReachM) return { ok: false, reason: 'outOfRange' };
  return { ok: true, preview: { towerId, structureId } };
}

export function resolveDock(ctx: BattleContext, state: BattleState, preview: DockPreview): { state: BattleState; events: GameEvent[] } {
  const tower = findUnit(state, preview.towerId) as UnitState;
  const def = structureDef(ctx, preview.structureId);
  const docked: UnitState = { ...tower, ap: 0, actions: 0, overwatch: null, facing: def ? faceTowards(tower.position, def.center, tower.facing) : tower.facing };
  const docks = [...state.docks, { towerId: tower.id, structureId: preview.structureId, climbs: 0 }].sort((a, b) => (a.towerId < b.towerId ? -1 : a.towerId > b.towerId ? 1 : 0));
  return {
    state: { ...state, units: state.units.map((u) => (u.id === tower.id ? docked : u)), docks },
    events: [{ type: 'towerDocked', towerId: tower.id, structureId: preview.structureId }],
  };
}

export function previewClimb(ctx: BattleContext, state: BattleState, unitId: string, towerId: string): ClimbPreviewResult {
  syncNav(ctx, state.structures, state.works);
  const unit = actingUnit(state, unitId);
  if (typeof unit === 'string') return { ok: false, reason: unit };
  const dock = dockOf(state, towerId);
  const tower = findUnit(state, towerId);
  if (!dock || !tower?.alive) return { ok: false, reason: 'notDocked' };
  const profile = unitType(ctx, unit).movement;
  if (profile === 'engine' || profile === 'mounted') return { ok: false, reason: 'cannotClimb' };
  if (dock.climbs >= ctx.rules.structures.towerCapacity) return { ok: false, reason: 'towerFull' };
  if (distance(unit.position, tower.position) > CLIMB_REACH_M) return { ok: false, reason: 'outOfRange' };
  const apCost = ctx.rules.structures.towerClimbAp;
  if (unit.ap < apCost) return { ok: false, reason: 'insufficientAp' };
  // The free wall-walk cell of the docked segment nearest to the tower.
  const def = structureDef(ctx, dock.structureId);
  if (!def) return { ok: false, reason: 'notDocked' };
  const occupied = occupancy(ctx, state);
  const w = ctx.nav.width;
  let best: { p: Vec2; d: number } | null = null;
  for (const i of def.cells) {
    const cx = i % w;
    const cz = Math.floor(i / w);
    if (occupied.has(i) || !isPassable(ctx.nav, profile, cx, cz)) continue;
    const p = { x: (cx + 0.5) * ctx.nav.cellSize, z: (cz + 0.5) * ctx.nav.cellSize };
    const d = distance(p, tower.position);
    if (!best || d < best.d) best = { p, d };
  }
  if (!best) return { ok: false, reason: 'noRoomOnWall' };
  return { ok: true, preview: { unitId, towerId, to: best.p, apCost } };
}

export function resolveClimb(ctx: BattleContext, state: BattleState, preview: ClimbPreview): { state: BattleState; events: GameEvent[] } {
  const unit = findUnit(state, preview.unitId) as UnitState;
  const dock = dockOf(state, preview.towerId) as DockState;
  const def = structureDef(ctx, dock.structureId);
  const inward = def ? normalize(sub(def.center, unit.position)) : unit.facing;
  const climbed: UnitState = { ...unit, position: preview.to, ap: unit.ap - preview.apCost, overwatch: null, facing: inward.x === 0 && inward.z === 0 ? unit.facing : inward };
  return {
    state: {
      ...state,
      units: state.units.map((u) => (u.id === unit.id ? climbed : u)),
      docks: state.docks.map((d) => (d.towerId === dock.towerId ? { ...d, climbs: d.climbs + 1 } : d)),
    },
    events: [{ type: 'unitClimbed', unitId: unit.id, towerId: preview.towerId, from: unit.position, to: preview.to }],
  };
}

/** Docks whose tower fell or whose segment came down are released. Appends the events. */
export function releaseDocks(state: BattleState, events: GameEvent[]): BattleState {
  const kept = state.docks.filter((d) => {
    const tower = findUnit(state, d.towerId);
    const holds = Boolean(tower?.alive) && !isBroken(state.structures, d.structureId);
    if (!holds) events.push({ type: 'towerUndocked', towerId: d.towerId });
    return holds;
  });
  return kept.length === state.docks.length ? state : { ...state, docks: kept };
}

/** A new turn: every tower carries its full load again. */
export function refillDocks(state: BattleState): BattleState {
  return state.docks.some((d) => d.climbs > 0) ? { ...state, docks: state.docks.map((d) => ({ ...d, climbs: 0 })) } : state;
}
