/**
 * Sappers' works (J4, brief §9.4 and §9.8): filling the moat with fascines (fillTurns turns of
 * work on a slot) and undermining a curtain segment (mineTurns turns at its foot, after which it
 * collapses like a breach). A turn of work takes the sapper's whole turn — AP and action — and
 * leaves it exposed where it digs. Progress belongs to the site, not to the sapper: another one
 * can carry on. The preview and the resolution share the same checks.
 */
import type { CommandRejection } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import type { Vec2 } from '../math/vec2.ts';
import { battleStatus, faceTowards } from './combat.ts';
import type { BattleContext } from './context.ts';
import { fillCells, fillSiteAt } from './moat.ts';
import { findUnit, unitType } from './movement.ts';
import { bringDown, distanceToCells } from './siege.ts';
import { isBroken, structureDef, syncNav } from './structures.ts';
import type { BattleState, UnitState, WorkState } from './types.ts';

export const FILL_MOAT_TAG = 'fillMoat';
export const UNDERMINE_TAG = 'undermine';
export const MINE_SITE_PREFIX = 'mine:';

export type WorkKind = 'fill' | 'mine';

export interface WorkPreview {
  readonly unitId: string;
  readonly workId: string;
  readonly kind: WorkKind;
  /** Turns of work already done on the site, and needed in all. */
  readonly progress: number;
  readonly required: number;
  /** Where the work happens (the sapper faces it). */
  readonly at: Vec2;
}

export type WorkPreviewResult = { readonly ok: true; readonly preview: WorkPreview } | { readonly ok: false; readonly reason: CommandRejection };

export function workState(state: BattleState, workId: string): WorkState | undefined {
  return state.works.find((w) => w.id === workId);
}

function cellsCentre(ctx: BattleContext, cells: readonly number[]): Vec2 {
  const w = ctx.nav.width;
  let x = 0;
  let z = 0;
  for (const i of cells) {
    x += (i % w) + 0.5;
    z += Math.floor(i / w) + 0.5;
  }
  return { x: x / Math.max(1, cells.length), z: z / Math.max(1, cells.length) };
}

/** Checks shared by both works: the sapper can still work this turn. */
function workerCheck(ctx: BattleContext, state: BattleState, unitId: string, tag: string): { unit: UnitState } | { reason: CommandRejection } {
  const unit = findUnit(state, unitId);
  if (!unit) return { reason: 'unknownUnit' };
  if (!unit.alive) return { reason: 'unitDead' };
  if (unit.faction !== state.activeFaction) return { reason: 'notYourTurn' };
  if (!unitType(ctx, unit).tags.includes(tag)) return { reason: 'noSiegeSkill' };
  if (unit.actions <= 0) return { reason: 'noActionLeft' };
  if (unit.ap < ctx.rules.damage.attackApCost) return { reason: 'insufficientAp' };
  return { unit };
}

/** Filling the moat slot under `at` with fascines. */
export function previewFill(ctx: BattleContext, state: BattleState, unitId: string, at: Vec2): WorkPreviewResult {
  syncNav(ctx, state.structures, state.works);
  const check = workerCheck(ctx, state, unitId, FILL_MOAT_TAG);
  if ('reason' in check) return { ok: false, reason: check.reason };
  const workId = fillSiteAt(ctx, at);
  if (!workId) return { ok: false, reason: 'notAMoat' };
  const work = workState(state, workId);
  if (work?.done) return { ok: false, reason: 'workDone' };
  const cells = fillCells(ctx, workId);
  if (distanceToCells(ctx, cells, check.unit.position) > ctx.rules.damage.meleeReachM) return { ok: false, reason: 'outOfRange' };
  return { ok: true, preview: { unitId, workId, kind: 'fill', progress: work?.progress ?? 0, required: ctx.rules.structures.fillTurns, at: cellsCentre(ctx, cells) } };
}

/** Undermining a curtain segment from its foot. */
export function previewUndermine(ctx: BattleContext, state: BattleState, unitId: string, structureId: string): WorkPreviewResult {
  syncNav(ctx, state.structures, state.works);
  const check = workerCheck(ctx, state, unitId, UNDERMINE_TAG);
  if ('reason' in check) return { ok: false, reason: check.reason };
  const def = structureDef(ctx, structureId);
  if (!def) return { ok: false, reason: 'unknownStructure' };
  if (def.kind !== 'wall') return { ok: false, reason: 'notAWall' };
  if (isBroken(state.structures, def.id)) return { ok: false, reason: 'structureDown' };
  if (distanceToCells(ctx, def.cells, check.unit.position) > ctx.rules.damage.meleeReachM) return { ok: false, reason: 'outOfRange' };
  const workId = `${MINE_SITE_PREFIX}${def.id}`;
  return { ok: true, preview: { unitId, workId, kind: 'mine', progress: workState(state, workId)?.progress ?? 0, required: ctx.rules.structures.mineTurns, at: def.center } };
}

/** One turn of work: progress, and on completion the causeway laid or the segment brought down. */
export function resolveWork(ctx: BattleContext, state: BattleState, preview: WorkPreview): { state: BattleState; events: GameEvent[] } {
  const unit = findUnit(state, preview.unitId) as UnitState;
  const progress = preview.progress + 1;
  const done = progress >= preview.required;
  const events: GameEvent[] = [{ type: 'siegeWorkProgressed', unitId: unit.id, workId: preview.workId, kind: preview.kind, progress, required: preview.required }];
  const works = [...state.works.filter((w) => w.id !== preview.workId), { id: preview.workId, progress, done }].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const worked: UnitState = { ...unit, ap: 0, actions: 0, overwatch: null, facing: faceTowards(unit.position, preview.at, unit.facing) };
  let units: readonly UnitState[] = state.units.map((u) => (u.id === unit.id ? worked : u));
  let structures = state.structures;
  if (done && preview.kind === 'fill') events.push({ type: 'moatFilled', workId: preview.workId, byId: unit.id });
  if (done && preview.kind === 'mine') {
    const structureId = preview.workId.slice(MINE_SITE_PREFIX.length);
    const def = structureDef(ctx, structureId);
    if (def) {
      structures = structures.map((s) => (s.id === structureId ? { ...s, hp: 0, broken: true } : s));
      units = bringDown(ctx, units, def, unit.id, events);
    }
  }
  const status = battleStatus(units);
  if (status !== 'ongoing') events.push({ type: 'battleEnded', status });
  return { state: { ...state, units, structures, works, status }, events };
}
