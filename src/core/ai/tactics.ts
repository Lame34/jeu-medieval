/**
 * Siege tactics of the utility AI (J5, brief §9.6), layered on the planner's moves and blows:
 * putting out fires that threaten our men or our timber; fire arrows — the attackers at a raised
 * drawbridge, a gate or defenders standing in crops, the defenders at the fields the attackers
 * cross (« incendie volontaire des champs ») —; the garrison falling back behind an open breach;
 * sallies against a siege engine left on its own. Fire options are weighed from where the unit
 * stands (a handful of targets, a line of sight each), so they stay cheap.
 *
 * Attackers' objectives (the sims of J7, a computer-led assault): while the garrison is out of
 * reach, the army gathers on the banks at the foot of the gatehouse (archers in range of the
 * walls and of the drawbridge); sappers lay a fascine causeway across the moat in front of a
 * breach the moat still guards, or, for a siege tower still to dock, in front of the intact
 * segment nearest to it; the tower crosses it and docks; the infantry climb it.
 */
import type { BattleContext } from '../battle/context.ts';
import { cellIndexOf } from '../battle/create.ts';
import { FIRE_ARROWS_TAG, previewExtinguish, previewFireArrow, woodenStructureAt } from '../battle/fire.ts';
import { facingSlot } from '../battle/approaches.ts';
import { fillCells, fillSites } from '../battle/moat.ts';
import { unitType } from '../battle/movement.ts';
import { distanceToCells, shieldOf, SIEGE_ENGINE_TAG } from '../battle/siege.ts';
import { CLIMB_REACH_M, dockOf, previewClimb, previewDock, TOWER_TAG } from '../battle/siege-tower.ts';
import { FILL_MOAT_TAG, previewFill, workState } from '../battle/siege-works.ts';
import { isBroken } from '../battle/structures.ts';
import type { BattleState, UnitState } from '../battle/types.ts';
import type { Command } from '../commands/types.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import { IMPASSABLE } from '../nav-grid/nav-grid.ts';
import { TerrainLayer, type MovementProfile } from '../rules/types.ts';

/** Utility weights of the siege tactics (tuned in J7 by simulated battles). */
export const TACTIC_WEIGHTS = {
  /** Putting out a fire: base value, per friend within threatRadiusM, if it eats our timber. */
  extinguishBase: 4,
  extinguishPerFriend: 7,
  extinguishOwnTimber: 22,
  threatRadiusM: 4,
  /** A fire arrow: per enemy within the blaze radius, per friend there (a cost), at a raised drawbridge, at a gate. */
  fireArrowPerEnemy: 14,
  fireArrowPerFriend: 12,
  fireArrowDrawbridge: 34,
  fireArrowGate: 14,
  blazeRadiusM: 2.6,
  /** Fire arrows are only worth it at enemies closer than this (m). */
  fireArrowEnemyRangeM: 45,
  /** Garrison: value of standing behind an open breach, within this distance of it (m). */
  breachGuard: 7,
  breachGuardRadiusM: 12,
  /** Sallies: an enemy engine with no escort within isolationM, as far as sallyRadiusM. */
  sallyRadiusM: 45,
  isolationM: 10,
  /** Attackers gather on the ground this far from the gatehouse's exposed obstacle (m). */
  stagingInnerM: 6,
  stagingOuterM: 16,
  /** A fill site guards a breach when it lies this close to the fallen segment (m). */
  breachFillReachM: 12,
  /** A turn of work on a causeway in front of a breach (or a tower's way to the wall). */
  fillWork: 40,
  /** Docking a siege tower at a wall, and climbing a docked one. */
  dock: 45,
  climb: 30,
} as const;

/** Burnable cells weighed around each enemy in reach (a line of sight each). */
const FIRE_CELLS_PER_ENEMY = 3;

export interface TacticDecision {
  readonly commands: Command[];
  readonly score: number;
}

function friendsNear(state: BattleState, unit: UnitState, at: Vec2, radius: number): number {
  return state.units.filter((u) => u.alive && u.faction === unit.faction && distance(u.position, at) <= radius).length;
}

function enemiesNear(state: BattleState, unit: UnitState, at: Vec2, radius: number): number {
  return state.units.filter((u) => u.alive && u.faction !== unit.faction && distance(u.position, at) <= radius).length;
}

function cellCentre(ctx: BattleContext, cell: number): Vec2 {
  return { x: (cell % ctx.nav.width) + 0.5, z: Math.floor(cell / ctx.nav.width) + 0.5 };
}

/** Timber that is ours: the castle's gate and drawbridge for the garrison, fascine causeways for the attackers. */
function isOwnTimber(ctx: BattleContext, state: BattleState, unit: UnitState, cell: number): boolean {
  if (unit.faction === 'defender') return woodenStructureAt(ctx, state, cell) !== null;
  return ctx.nav.terrain.layers[cell] === TerrainLayer.Fascine;
}

/** Putting out the fires within reach of where the unit stands. */
function extinguishDecisions(ctx: BattleContext, state: BattleState, unit: UnitState): TacticDecision[] {
  const out: TacticDecision[] = [];
  for (const fire of state.fires) {
    const at = cellCentre(ctx, fire.cell);
    if (distance(at, unit.position) > ctx.rules.fire.extinguishReachM) continue;
    const r = previewExtinguish(ctx, state, unit.id, at);
    if (!r.ok) continue;
    const w = TACTIC_WEIGHTS;
    const score = w.extinguishBase + friendsNear(state, unit, at, w.threatRadiusM) * w.extinguishPerFriend + (isOwnTimber(ctx, state, unit, fire.cell) ? w.extinguishOwnTimber : 0);
    out.push({ commands: [{ type: 'extinguish', unitId: unit.id, at }], score });
  }
  return out;
}

/** Cells worth a fire arrow: the flammable cell upwind of each enemy in reach, and (attackers) the gatehouse timber. */
function fireTargets(ctx: BattleContext, state: BattleState, unit: UnitState): { cell: number; bonus: number }[] {
  const targets = new Map<number, number>();
  const w = ctx.nav.width;
  const wind = state.wind;
  const r = TACTIC_WEIGHTS.blazeRadiusM;
  const span = Math.ceil(r);
  for (const enemy of state.units) {
    if (!enemy.alive || enemy.faction === unit.faction || distance(enemy.position, unit.position) > TACTIC_WEIGHTS.fireArrowEnemyRangeM) continue;
    // The burnable cells around them (roads do not burn, the crops and hedges beside them do),
    // upwind first so the blaze runs onto them, then the nearest.
    const ecx = Math.floor(enemy.position.x);
    const ecz = Math.floor(enemy.position.z);
    const near: { cell: number; rank: number }[] = [];
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const cx = ecx + dx;
        const cz = ecz + dz;
        if (cx < 0 || cz < 0 || cx >= w || cz >= ctx.nav.depth) continue;
        const cell = cz * w + cx;
        if (ctx.nav.flammable[cell] !== 1 || targets.has(cell)) continue;
        const off = { x: cx + 0.5 - enemy.position.x, z: cz + 0.5 - enemy.position.z };
        const d = Math.hypot(off.x, off.z);
        if (d > r) continue;
        // Upwind: the offset points against the wind.
        near.push({ cell, rank: d + (off.x * wind.x + off.z * wind.z) });
      }
    }
    near.sort((p, q) => p.rank - q.rank || p.cell - q.cell);
    for (const { cell } of near.slice(0, FIRE_CELLS_PER_ENEMY)) targets.set(cell, 0);
  }
  if (unit.faction === 'attacker') {
    for (const def of ctx.structures) {
      if (def.material !== 'wood' || isBroken(state.structures, def.id) || def.cells.length === 0) continue;
      const bonus = def.kind === 'drawbridge' ? TACTIC_WEIGHTS.fireArrowDrawbridge : def.kind === 'gate' ? TACTIC_WEIGHTS.fireArrowGate : 0;
      if (bonus > 0) targets.set(def.cells[Math.floor(def.cells.length / 2)] as number, bonus);
    }
  }
  return [...targets.entries()].map(([cell, bonus]) => ({ cell, bonus }));
}

/** Fire arrows from where the unit stands. */
function fireArrowDecisions(ctx: BattleContext, state: BattleState, unit: UnitState): TacticDecision[] {
  if (!unitType(ctx, unit).tags.includes(FIRE_ARROWS_TAG)) return [];
  const out: TacticDecision[] = [];
  const w = TACTIC_WEIGHTS;
  for (const { cell, bonus } of fireTargets(ctx, state, unit)) {
    const at = cellCentre(ctx, cell);
    const r = previewFireArrow(ctx, state, unit.id, at);
    if (!r.ok) continue;
    const worth = enemiesNear(state, unit, at, w.blazeRadiusM) * w.fireArrowPerEnemy - friendsNear(state, unit, at, w.blazeRadiusM) * w.fireArrowPerFriend + bonus;
    if (worth <= 0) continue;
    out.push({ commands: [{ type: 'fireArrow', unitId: unit.id, at }], score: r.preview.chance * worth });
  }
  return out;
}

/** Fire tactics for a unit able to act (where it stands). */
export function fireDecisions(ctx: BattleContext, state: BattleState, unit: UnitState): TacticDecision[] {
  if (unit.actions <= 0) return [];
  return [...extinguishDecisions(ctx, state, unit), ...fireArrowDecisions(ctx, state, unit)];
}

/** Garrison: value of a spot behind an open breach (inside the walls, near the gap). */
export function breachGuardValue(ctx: BattleContext, state: BattleState, unit: UnitState, at: Vec2): number {
  if (unit.faction !== 'defender') return 0;
  const walls = ctx.structures.filter((d) => d.kind === 'wall');
  const breaches = walls.filter((d) => isBroken(state.structures, d.id));
  if (breaches.length === 0) return 0;
  const centre = walls.reduce((c, d) => ({ x: c.x + d.center.x / walls.length, z: c.z + d.center.z / walls.length }), { x: 0, z: 0 });
  let best = 0;
  for (const b of breaches) {
    const inside = distance(at, centre) < distance(b.center, centre) - 1.5;
    if (!inside) continue;
    best = Math.max(best, TACTIC_WEIGHTS.breachGuard * Math.max(0, 1 - distance(at, b.center) / TACTIC_WEIGHTS.breachGuardRadiusM));
  }
  return best;
}

/** An enemy siege engine left without escort within sally range of the unit. */
export function sallyTarget(ctx: BattleContext, state: BattleState, unit: UnitState): UnitState | null {
  if (unit.faction !== 'defender') return null;
  const w = TACTIC_WEIGHTS;
  for (const e of state.units) {
    if (!e.alive || e.faction === unit.faction || !unitType(ctx, e).tags.includes(SIEGE_ENGINE_TAG)) continue;
    if (distance(e.position, unit.position) > w.sallyRadiusM) continue;
    const escorted = state.units.some((u) => u.alive && u.faction === e.faction && u.id !== e.id && !unitType(ctx, u).tags.includes(SIEGE_ENGINE_TAG) && distance(u.position, e.position) <= w.isolationM);
    if (!escorted) return e;
  }
  return null;
}

/** Cells passable for `profile` from which a unit stands within `reach` of any of `cells`. */
export function cellsWithinReach(ctx: BattleContext, profile: MovementProfile, cells: readonly number[], reach: number, minReach = 0): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const span = Math.ceil(reach) + 1;
  const ap = ctx.nav.apPerMeter[profile];
  for (const cell of cells) {
    const cx0 = cell % ctx.nav.width;
    const cz0 = Math.floor(cell / ctx.nav.width);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= ctx.nav.width || cz >= ctx.nav.depth) continue;
        const i = cz * ctx.nav.width + cx;
        if (seen.has(i)) continue;
        seen.add(i);
        if ((ap[i] as number) === IMPASSABLE) continue;
        const d = distanceToCells(ctx, cells, cellCentre(ctx, i));
        if (d <= reach && d >= minReach) out.push(i);
      }
    }
  }
  return out;
}

/** Attackers: ground cells at the foot of each gatehouse's exposed obstacle (raised drawbridge, gate, portcullis). */
export function stagingOrigins(ctx: BattleContext, state: BattleState, profile: MovementProfile): number[] {
  const w = TACTIC_WEIGHTS;
  const out: number[] = [];
  for (const def of ctx.structures) {
    if (def.gateId === undefined || isBroken(state.structures, def.id) || shieldOf(ctx, state.structures, def)) continue;
    for (const i of cellsWithinReach(ctx, profile, def.cells, w.stagingOuterM, w.stagingInnerM)) {
      // On the ground: not on the bridge's deck, where the ram passes.
      if ((ctx.nav.deck[i] as number) <= 0) out.push(i);
    }
  }
  return out;
}

/** Attackers' siege towers still to dock. */
export function waitingTowers(ctx: BattleContext, state: BattleState): UnitState[] {
  return state.units.filter((u) => u.alive && u.faction === 'attacker' && unitType(ctx, u).tags.includes(TOWER_TAG) && !dockOf(state, u.id));
}

/**
 * The causeway a waiting tower needs: the slot facing the intact segment nearest to a tower,
 * while no finished causeway faces an intact segment yet.
 */
function towerFillSite(ctx: BattleContext, state: BattleState): { readonly id: string; readonly cells: readonly number[] } | null {
  const towers = waitingTowers(ctx, state);
  const moat = ctx.moats[0];
  if (towers.length === 0 || !moat) return null;
  let best: { id: string; d: number } | null = null;
  for (const wall of ctx.structures) {
    if (wall.kind !== 'wall' || isBroken(state.structures, wall.id)) continue;
    const slot = facingSlot(ctx, wall, moat.centerline);
    if (!slot) continue;
    if (workState(state, slot)?.done) return null;
    const d = towers.reduce((m, t) => Math.min(m, distance(t.position, wall.center)), Number.POSITIVE_INFINITY);
    if (!best || d < best.d || (d === best.d && slot < best.id)) best = { id: slot, d };
  }
  return best ? { id: best.id, cells: fillCells(ctx, best.id) } : null;
}

/**
 * Fill sites worth a causeway: in front of a breach the moat still guards (no causeway done there
 * yet), and the way of a tower still to dock.
 */
export function worthyFillSites(ctx: BattleContext, state: BattleState): { readonly id: string; readonly cells: readonly number[] }[] {
  const out: { id: string; cells: readonly number[] }[] = [];
  const forTower = towerFillSite(ctx, state);
  if (forTower) out.push(forTower);
  const breaches = ctx.structures.filter((d) => d.kind === 'wall' && isBroken(state.structures, d.id));
  if (breaches.length === 0) return out;
  const sites = [...fillSites(ctx)].map(([id, cells]) => ({ id, cells, centre: cellsCentre(ctx, cells) }));
  for (const breach of breaches) {
    const near = sites.filter((s) => distanceToCells(ctx, breach.cells, s.centre) <= TACTIC_WEIGHTS.breachFillReachM);
    if (near.some((s) => workState(state, s.id)?.done)) continue;
    for (const s of near) if (!out.some((o) => o.id === s.id)) out.push({ id: s.id, cells: s.cells });
  }
  return out;
}

/** Sappers: a turn of work on a worthy causeway within reach of where they stand. */
export function worksDecisions(ctx: BattleContext, state: BattleState, unit: UnitState): TacticDecision[] {
  if (unit.actions <= 0 || !unitType(ctx, unit).tags.includes(FILL_MOAT_TAG)) return [];
  const out: TacticDecision[] = [];
  for (const site of worthyFillSites(ctx, state)) {
    const first = site.cells[0];
    if (first === undefined) continue;
    const r = previewFill(ctx, state, unit.id, cellCentre(ctx, first));
    if (r.ok) out.push({ commands: [{ type: 'fillMoat', unitId: unit.id, at: r.preview.at }], score: TACTIC_WEIGHTS.fillWork });
  }
  return out;
}

/** Siege towers: the cells from which they dock at an intact segment. */
export function dockOrigins(ctx: BattleContext, state: BattleState, profile: MovementProfile): number[] {
  const out: number[] = [];
  for (const wall of ctx.structures) {
    if (wall.kind !== 'wall' || isBroken(state.structures, wall.id)) continue;
    out.push(...cellsWithinReach(ctx, profile, wall.cells, ctx.rules.structures.towerDockReachM));
  }
  return out;
}

/** Attackers: the cells next to a docked tower with room left to climb. */
export function climbOrigins(ctx: BattleContext, state: BattleState, profile: MovementProfile): number[] {
  if (profile === 'engine' || profile === 'mounted') return [];
  const out: number[] = [];
  for (const dock of state.docks) {
    const tower = state.units.find((u) => u.id === dock.towerId && u.alive);
    if (!tower || dock.climbs >= ctx.rules.structures.towerCapacity) continue;
    out.push(...cellsWithinReach(ctx, profile, [cellIndexOf(ctx, tower.position)], CLIMB_REACH_M - 0.5));
  }
  return out;
}

/** A tower docking where it stands; a unit climbing a docked tower next to it. */
export function towerDecisions(ctx: BattleContext, state: BattleState, unit: UnitState): TacticDecision[] {
  const out: TacticDecision[] = [];
  if (unitType(ctx, unit).tags.includes(TOWER_TAG)) {
    if (dockOf(state, unit.id)) return out;
    for (const wall of ctx.structures) {
      if (wall.kind !== 'wall') continue;
      if (previewDock(ctx, state, unit.id, wall.id).ok) out.push({ commands: [{ type: 'dockTower', unitId: unit.id, structureId: wall.id }], score: TACTIC_WEIGHTS.dock });
    }
    return out;
  }
  for (const dock of state.docks) {
    if (previewClimb(ctx, state, unit.id, dock.towerId).ok) out.push({ commands: [{ type: 'climbTower', unitId: unit.id, towerId: dock.towerId }], score: TACTIC_WEIGHTS.climb });
  }
  return out;
}

function cellsCentre(ctx: BattleContext, cells: readonly number[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const i of cells) {
    const c = cellCentre(ctx, i);
    x += c.x;
    z += c.z;
  }
  return { x: x / Math.max(1, cells.length), z: z / Math.max(1, cells.length) };
}
