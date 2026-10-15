/**
 * Fire (J4, brief §9.9): fields, hedges, timber (bridges, fascines, houses), wooden gates and the
 * drawbridge burn for a few rounds, spread with the wind, hurt the units in and beside them and
 * shake those nearby. Archers light them with fire arrows; any unit beside a fire can put it out
 * with its action. Burnt-out cells never catch again; a drawbridge whose timbers burn through
 * drops across the moat (brief §9.8: « incendier le pont »). Everything rolls on the battle's RNG stream.
 *
 * A round of fire runs when a new round starts (the attackers' turn comes back): every fire burns
 * the units on and around it and the wooden structure it sits on, then may spread to each
 * flammable neighbour (more likely downwind), then loses a turn of fuel.
 */
import type { CommandRejection } from '../commands/types.ts';
import { moraleLossFactor } from './hero-auras.ts';
import type { GameEvent } from '../events/types.ts';
import { distance, normalize, type Vec2 } from '../math/vec2.ts';
import { lineOfSight } from '../nav-grid/line-of-sight.ts';
import { Rng } from '../rng.ts';
import { heightSteps, statusAfterBlows } from './combat.ts';
import { deckAt, type BattleContext } from './context.ts';
import { cellIndexOf } from './create.ts';
import { findUnit, unitType } from './movement.ts';
import { isBroken, syncNav, type StructureDef } from './structures.ts';
import { conditionedRange, fireFactors, shotConditions, type ShotModifier } from './conditions.ts';
import type { BattleState, FireState, UnitState } from './types.ts';

export const FIRE_ARROWS_TAG = 'fireArrows';
/** A fire arrow aims this far above the top of what it sets alight (m). */
const FIRE_AIM_ABOVE_M = 0.2;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** The wooden structure (gate, drawbridge) standing on a cell, if intact. */
export function woodenStructureAt(ctx: BattleContext, state: BattleState, cell: number): StructureDef | null {
  for (const d of ctx.structures) {
    if (d.material !== 'wood' || isBroken(state.structures, d.id)) continue;
    if (d.cells.includes(cell)) return d;
  }
  return null;
}

/** Rounds a cell burns for (0: it does not burn): its layer's material, or a wooden structure on it. */
function dryFuelOf(ctx: BattleContext, state: BattleState, cell: number, burnt: ReadonlySet<number> = new Set(state.burnt)): number {
  if (burnt.has(cell)) return 0;
  const f = ctx.rules.fire;
  if (woodenStructureAt(ctx, state, cell)) return f.woodTurns;
  if (ctx.nav.flammable[cell] !== 1) return 0;
  const layer = ctx.rules.terrainLayers[ctx.nav.terrain.layers[cell] as number];
  return layer?.material === 'wood' ? f.woodTurns : f.vegetationTurns;
}

/** Rounds `cell` would burn (0: it does not burn); the rain shortens it, to one round at least. */
export function fuelOf(ctx: BattleContext, state: BattleState, cell: number, burnt: ReadonlySet<number> = new Set(state.burnt)): number {
  const dry = dryFuelOf(ctx, state, cell, burnt);
  return dry <= 0 ? 0 : Math.max(1, Math.round(dry * fireFactors(ctx.rules, state.weather).fuel));
}

function isBurning(state: BattleState, cell: number): boolean {
  return state.fires.some((x) => x.cell === cell);
}

function sortFires(fires: FireState[]): FireState[] {
  return fires.sort((a, b) => a.cell - b.cell);
}

export interface FireArrowPreview {
  readonly unitId: string;
  readonly cell: number;
  readonly at: Vec2;
  readonly chance: number;
  readonly apCost: number;
  /** Weather, night and wind modifiers of the shot. */
  readonly conditions: readonly ShotModifier[];
}

export type FireArrowPreviewResult = { readonly ok: true; readonly preview: FireArrowPreview } | { readonly ok: false; readonly reason: CommandRejection };

/** A fire arrow at the point `at`: in range and in sight, onto something that burns. */
export function previewFireArrow(ctx: BattleContext, state: BattleState, unitId: string, at: Vec2): FireArrowPreviewResult {
  syncNav(ctx, state.structures, state.works);
  const unit = findUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'unknownUnit' };
  if (!unit.alive) return { ok: false, reason: 'unitDead' };
  if (unit.faction !== state.activeFaction) return { ok: false, reason: 'notYourTurn' };
  const type = unitType(ctx, unit);
  const attack = type.attack;
  if (!type.tags.includes(FIRE_ARROWS_TAG) || !attack || attack.rangeM === 0) return { ok: false, reason: 'noFireArrows' };
  if (unit.actions <= 0) return { ok: false, reason: 'noActionLeft' };
  const d = ctx.rules.damage;
  const apCost = d.attackApCost + ctx.rules.fire.arrowExtraAp;
  if (unit.ap < apCost) return { ok: false, reason: 'insufficientAp' };
  const nav = ctx.nav;
  if (at.x < 0 || at.z < 0 || at.x >= nav.width * nav.cellSize || at.z >= nav.depth * nav.cellSize) return { ok: false, reason: 'outOfBounds' };
  const cell = cellIndexOf(ctx, at);
  if (isBurning(state, cell)) return { ok: false, reason: 'alreadyBurning' };
  if (fuelOf(ctx, state, cell) <= 0) return { ok: false, reason: 'notFlammable' };
  const centre = { x: (cell % nav.width) + 0.5, z: Math.floor(cell / nav.width) + 0.5 };
  const steps = heightSteps(ctx, unit.position, centre);
  const conditions = shotConditions(ctx, state, unit.position, centre, false, unit);
  const range = conditionedRange(attack.rangeM * Math.max(0, 1 + steps * d.rangePerHeightStep), conditions);
  if (distance(unit.position, centre) > range) return { ok: false, reason: 'outOfRange' };
  // Aimed at the top of what burns there (the crop, the hedge, the roof).
  const top = Math.max(0, (nav.sightHeight[cell] as number) - deckAt(ctx, centre));
  const sight = lineOfSight(nav, {
    from: unit.position,
    to: centre,
    eyeHeightM: ctx.rules.movement.eyeHeightM,
    targetHeightM: Math.max(ctx.rules.fire.targetHeightM, top + FIRE_AIM_ABOVE_M),
    fromElevationM: deckAt(ctx, unit.position),
    toElevationM: deckAt(ctx, centre),
  });
  if (!sight.visible) return { ok: false, reason: 'noLineOfSight' };
  // Rain: the shot is worse and the arrow sputters out more often.
  const hit = Math.min(d.hitChanceMax, Math.max(d.hitChanceMin, attack.accuracy + steps * d.accuracyPerHeightStep - sight.obscurance * d.obscurancePenalty + conditions.accuracy));
  const chance = hit * fireFactors(ctx.rules, state.weather).ignite;
  return { ok: true, preview: { unitId, cell, at: centre, chance, apCost, conditions: conditions.modifiers } };
}

export function resolveFireArrow(ctx: BattleContext, state: BattleState, preview: FireArrowPreview): { state: BattleState; events: GameEvent[] } {
  const rng = Rng.fromState(state.rng);
  const unit = findUnit(state, preview.unitId) as UnitState;
  const caught = rng.next() < preview.chance;
  const dir = normalize({ x: preview.at.x - unit.position.x, z: preview.at.z - unit.position.z });
  const shooter: UnitState = { ...unit, ap: unit.ap - preview.apCost, actions: unit.actions - 1, facing: dir.x === 0 && dir.z === 0 ? unit.facing : dir };
  const events: GameEvent[] = [{ type: 'fireArrowShot', unitId: unit.id, at: preview.at, hitChance: preview.chance, caught }];
  const fires = caught ? sortFires([...state.fires, { cell: preview.cell, turnsLeft: fuelOf(ctx, state, preview.cell) }]) : state.fires;
  if (caught) events.push({ type: 'fireStarted', cells: [preview.cell] });
  return { state: { ...state, units: state.units.map((u) => (u.id === unit.id ? shooter : u)), fires, rng: rng.getState() }, events };
}

/** Putting out the fire at `at` (and the fires around it) from beside it. */
export function previewExtinguish(ctx: BattleContext, state: BattleState, unitId: string, at: Vec2): { ok: true; cells: number[] } | { ok: false; reason: CommandRejection } {
  const unit = findUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'unknownUnit' };
  if (!unit.alive) return { ok: false, reason: 'unitDead' };
  if (unit.faction !== state.activeFaction) return { ok: false, reason: 'notYourTurn' };
  if (unit.actions <= 0) return { ok: false, reason: 'noActionLeft' };
  if (unit.ap < ctx.rules.damage.attackApCost) return { ok: false, reason: 'insufficientAp' };
  const w = ctx.nav.width;
  const cell = cellIndexOf(ctx, at);
  if (!isBurning(state, cell)) return { ok: false, reason: 'notBurning' };
  const centre = { x: (cell % w) + 0.5, z: Math.floor(cell / w) + 0.5 };
  if (distance(unit.position, centre) > ctx.rules.fire.extinguishReachM) return { ok: false, reason: 'outOfRange' };
  const cx = cell % w;
  const cz = Math.floor(cell / w);
  const cells = [cell];
  for (const [dx, dz] of NEIGHBOURS) {
    const n = (cz + dz) * w + (cx + dx);
    if (isBurning(state, n)) cells.push(n);
  }
  return { ok: true, cells: cells.sort((a, b) => a - b) };
}

export function resolveExtinguish(ctx: BattleContext, state: BattleState, unitId: string, cells: readonly number[]): { state: BattleState; events: GameEvent[] } {
  const unit = findUnit(state, unitId) as UnitState;
  const out = new Set(cells);
  const worked: UnitState = { ...unit, ap: unit.ap - ctx.rules.damage.attackApCost, actions: unit.actions - 1 };
  return {
    state: { ...state, units: state.units.map((u) => (u.id === unit.id ? worked : u)), fires: state.fires.filter((x) => !out.has(x.cell)) },
    events: [{ type: 'fireOut', cells: [...cells], byId: unit.id }],
  };
}

/** One round of fire (a new round starts). Appends the events; returns the new state. */
export function fireRound(ctx: BattleContext, state: BattleState, events: GameEvent[]): BattleState {
  if (state.fires.length === 0) return state;
  const f = ctx.rules.fire;
  const w = ctx.nav.width;
  const rng = Rng.fromState(state.rng);
  const hurt = new Map<string, number>();
  const structureDamage = new Map<string, number>();
  for (const fire of state.fires) {
    const cx = fire.cell % w;
    const cz = Math.floor(fire.cell / w);
    const centre = { x: cx + 0.5, z: cz + 0.5 };
    for (const u of state.units) {
      if (!u.alive) continue;
      const d = distance(u.position, centre);
      const damage = d < 0.75 ? f.burnDamage : d <= f.nearRadiusM ? f.nearDamage : 0;
      if (damage > 0) hurt.set(u.id, Math.max(hurt.get(u.id) ?? 0, damage));
    }
    const wooden = woodenStructureAt(ctx, state, fire.cell);
    if (wooden && wooden.maxHp > 0) structureDamage.set(wooden.id, (structureDamage.get(wooden.id) ?? 0) + f.structureDamage);
  }
  // Units: burns (an engine of wood burns worst), and morale for those caught near.
  const units = state.units.map((u) => {
    const base = hurt.get(u.id);
    if (base === undefined) return u;
    const damage = Math.max(1, Math.round(base * ctx.rules.damage.multipliers.fire[unitType(ctx, u).armor]));
    const hpAfter = Math.max(0, u.hp - damage);
    events.push({ type: 'unitBurned', unitId: u.id, damage, hpAfter });
    if (hpAfter === 0) events.push({ type: 'unitDied', unitId: u.id, byId: u.id });
    const morale = Math.max(0, u.morale - Math.round(f.moraleLoss * moraleLossFactor(ctx, state.units, u)));
    if (hpAfter > 0 && morale !== u.morale) events.push({ type: 'moraleChanged', unitId: u.id, morale, delta: morale - u.morale, reason: 'fire' });
    return { ...u, hp: hpAfter, alive: hpAfter > 0, morale: hpAfter > 0 ? morale : u.morale, overwatch: hpAfter > 0 ? u.overwatch : null };
  });
  // Wooden structures: the gate burns away; fire on the drawbridge burns through its chains.
  const burnedDown: string[] = [];
  let structures = state.structures.map((s) => {
    const dmg = structureDamage.get(s.id);
    if (dmg === undefined || s.broken) return s;
    const hp = Math.max(0, s.hp - dmg);
    events.push({ type: 'structureBurned', structureId: s.id, damage: dmg, hpAfter: hp });
    if (hp === 0) {
      const def = ctx.structures.find((d) => d.id === s.id);
      if (def) events.push({ type: 'structureBroken', structureId: s.id, kind: def.kind, byId: null, fallen: [] });
      burnedDown.push(s.id);
    }
    return { ...s, hp, broken: hp === 0 };
  });
  // Spread, then fuel.
  const burning = new Set(state.fires.map((x) => x.cell));
  const burnt = new Set(state.burnt);
  const lit: number[] = [];
  const wind = state.wind;
  const rain = fireFactors(ctx.rules, state.weather);
  for (const fire of state.fires) {
    const cx = fire.cell % w;
    const cz = Math.floor(fire.cell / w);
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= w || nz >= ctx.nav.depth) continue;
      const n = nz * w + nx;
      if (burning.has(n) || burnt.has(n) || lit.includes(n)) continue;
      if (fuelOf(ctx, state, n, burnt) <= 0) continue;
      const len = Math.hypot(dx, dz);
      const downwind = (dx * wind.x + dz * wind.z) / len;
      const chance = (Math.min(f.spreadMax, Math.max(0, f.spreadChance + downwind * wind.strength * f.windSpread)) / (len > 1 ? Math.SQRT2 : 1)) * rain.spread;
      if (rng.next() < chance) lit.push(n);
    }
  }
  const fires: FireState[] = [];
  const out: number[] = [];
  for (const fire of state.fires) {
    if (fire.turnsLeft > 1) {
      fires.push({ cell: fire.cell, turnsLeft: fire.turnsLeft - 1 });
      continue;
    }
    out.push(fire.cell);
    burnt.add(fire.cell);
    // A drawbridge whose timbers have burnt through drops across the moat.
    const wooden = woodenStructureAt(ctx, { ...state, structures }, fire.cell);
    if (wooden?.kind === 'drawbridge') {
      structures = structures.map((st) => (st.id === wooden.id ? { ...st, broken: true } : st));
      events.push({ type: 'structureBroken', structureId: wooden.id, kind: wooden.kind, byId: null, fallen: [] });
      burnedDown.push(wooden.id);
    }
  }
  for (const n of lit) fires.push({ cell: n, turnsLeft: fuelOf(ctx, state, n) });
  if (lit.length > 0) events.push({ type: 'fireStarted', cells: [...lit].sort((a, b) => a - b) });
  if (out.length > 0) events.push({ type: 'fireOut', cells: out.sort((a, b) => a - b), byId: null });
  const status = statusAfterBlows(ctx.rules, units, events);
  const burned = burnedDown.length > 0 ? { burned: [...new Set([...(state.burned ?? []), ...burnedDown])].sort() } : {};
  return { ...state, units, structures, fires: sortFires(fires), burnt: [...burnt].sort((a, b) => a - b), ...burned, status, rng: rng.getState() };
}
