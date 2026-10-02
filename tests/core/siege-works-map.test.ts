/**
 * The sappers' works on a real generated map (seed 'siege-1', castle 1): the siege park holds a
 * sapper, and two turns of fascines on the moat slot facing a curtain segment open a way from the
 * outside to the berm at the foot of the wall. Targets are computed from the generated map the way
 * scripts/capture-works.ts does, from the sapper's real position. The 512 m map takes seconds to
 * generate: it is built once, in beforeAll.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, cellIndexOf, createBattle, createBattleContext, findPath, isPassable, type BattleContext, type BattleState, type MovementProfile, type Scenario, type Vec2 } from '@core/index.ts';
import { fillCells, fillSiteAt, moatsOf } from '@core/battle/moat.ts';
import { previewFill } from '@core/battle/siege-works.ts';
import { planStructures, syncNav, type StructureDef } from '@core/battle/structures.ts';
import { projectOnPolyline } from '@core/worldgen/geometry.ts';
import { generateBattleMap } from '@core/worldgen/battle.ts';
import type { UnitMarker } from '@core/worldgen/types.ts';
import { DEFAULT_RULES } from '@data/index.ts';

const SEED = 'siege-1';
const CASTLE_INDEX = 1;
/** Map generation takes seconds; the hook's budget is raised accordingly. */
const HEAVY_TIMEOUT_MS = 60_000;
const SIEGE_PREFIX = 'att-siege-';
/** The moat lies about this far outside the middle of a curtain segment. */
const MOAT_OUTSIDE_M = 11;
/** The outer bank, past the ditch, and the berm at the foot of the wall, from the segment's middle. */
const OUTER_BANK_M = 7.5;
const WALL_FOOT_M = 2.2;
/** Segments shorter than this are corner pieces. */
const MIN_WALL_CELLS = 40;
/** Radius searched for a bank cell where the sapper can stand next to the slot. */
const STAND_SEARCH_M = 7;
const PROFILE: MovementProfile = 'foot';

let ctx: BattleContext;
let state: BattleState;
let sapper: UnitMarker;
let wall: StructureDef;
let site: string;
let moatPoint: Vec2;
let stand: Vec2;
let outer: Vec2;
let foot: Vec2;

const snap = (p: Vec2): Vec2 => ({ x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

function hasPath(profile: MovementProfile, s: BattleState, from: Vec2, to: Vec2): boolean {
  syncNav(ctx, s.structures, s.works);
  return findPath(ctx.paths, { profile, start: cellIndexOf(ctx, from), goal: cellIndexOf(ctx, to) }) !== null;
}

beforeAll(() => {
  const { layout, castle } = generateBattleMap({ seed: SEED, castleIndex: CASTLE_INDEX });
  const defs = planStructures(layout, DEFAULT_RULES.structures);
  ctx = createBattleContext(layout.terrain, DEFAULT_RULES, layout.deck, defs, moatsOf(layout));
  const scenario: Scenario = {
    units: layout.units.flatMap((m) => {
      const type = DEFAULT_RULES.units[m.typeKey];
      if (!type || !isPassable(ctx.nav, type.movement, Math.floor(m.position.x), Math.floor(m.position.z))) return [];
      const a = m.facingTurns * 2 * Math.PI;
      return [{ id: m.id, typeKey: m.typeKey, position: m.position, facing: { x: Math.sin(a), z: Math.cos(a) } }];
    }),
    firstFaction: 'attacker',
  };
  state = createBattle(ctx, SEED, scenario);
  const found = layout.units.find((u) => u.id.startsWith(SIEGE_PREFIX) && u.typeKey === 'sapper');
  if (!found) throw new Error('no sapper in the siege park');
  sapper = found;

  const moat = ctx.moats[0];
  if (!moat) throw new Error('no moat');
  const centre = { x: castle.ring.reduce((a, p) => a + p.x, 0) / castle.ring.length, z: castle.ring.reduce((a, p) => a + p.z, 0) / castle.ring.length };
  const walls = ctx.structures.filter((d) => d.kind === 'wall' && d.cells.length > MIN_WALL_CELLS);
  wall = walls.reduce((best, d) => (dist(d.center, sapper.position) < dist(best.center, sapper.position) ? d : best));
  const len = Math.hypot(wall.center.x - centre.x, wall.center.z - centre.z) || 1;
  const outward = { x: (wall.center.x - centre.x) / len, z: (wall.center.z - centre.z) / len };
  moatPoint = projectOnPolyline({ x: wall.center.x + outward.x * MOAT_OUTSIDE_M, z: wall.center.z + outward.z * MOAT_OUTSIDE_M }, moat.centerline).point;
  site = fillSiteAt(ctx, moatPoint) ?? '';
  outer = snap({ x: moatPoint.x + outward.x * OUTER_BANK_M, z: moatPoint.z + outward.z * OUTER_BANK_M });
  foot = snap({ x: wall.center.x + outward.x * WALL_FOOT_M, z: wall.center.z + outward.z * WALL_FOOT_M });

  // The sapper stands on the outermost bank cell next to the slot from which the work is in reach.
  const slot = new Set(fillCells(ctx, site));
  const candidates: Vec2[] = [];
  for (let dz = -STAND_SEARCH_M; dz <= STAND_SEARCH_M; dz++) {
    for (let dx = -STAND_SEARCH_M; dx <= STAND_SEARCH_M; dx++) {
      const p = snap({ x: moatPoint.x + dx, z: moatPoint.z + dz });
      if (slot.has(cellIndexOf(ctx, p)) || !isPassable(ctx.nav, 'lightFoot', Math.floor(p.x), Math.floor(p.z))) continue;
      candidates.push(p);
    }
  }
  const outwardness = (p: Vec2) => (p.x - moatPoint.x) * outward.x + (p.z - moatPoint.z) * outward.z;
  candidates.sort((a, b) => outwardness(b) - outwardness(a));
  const reachable = candidates.find((p) => {
    const probe: BattleState = { ...state, units: state.units.map((u) => (u.id === sapper.id ? { ...u, position: p } : u)) };
    return previewFill(ctx, probe, sapper.id, moatPoint).ok;
  });
  if (!reachable) throw new Error('no bank cell within reach of the slot');
  stand = reachable;
}, HEAVY_TIMEOUT_MS);

describe('works on the real map (siege-1)', () => {
  it('the siege park has a sapper of type sapper, an attacker with the fill and undermine skills', () => {
    expect(sapper.id.startsWith(SIEGE_PREFIX)).toBe(true);
    const unit = state.units.find((u) => u.id === sapper.id);
    expect(unit?.faction).toBe('attacker');
    const tags = DEFAULT_RULES.units['sapper']?.tags ?? [];
    expect(tags).toEqual(expect.arrayContaining(['fillMoat', 'undermine']));
  });

  it('the moat is cut into slots, and the one facing the wall has cells', () => {
    expect(ctx.moats.length).toBeGreaterThan(0);
    expect(site.startsWith('fill:')).toBe(true);
    expect(fillCells(ctx, site).length).toBeGreaterThan(0);
  });

  it('before the works there is no foot path from the outside to the berm; two turns of fascines open one', { timeout: HEAVY_TIMEOUT_MS }, () => {
    expect(isPassable(ctx.nav, PROFILE, Math.floor(outer.x), Math.floor(outer.z))).toBe(true);
    expect(isPassable(ctx.nav, PROFILE, Math.floor(foot.x), Math.floor(foot.z))).toBe(true);
    expect(hasPath(PROFILE, state, outer, foot)).toBe(false);

    let s: BattleState = { ...state, units: state.units.map((u) => (u.id === sapper.id ? { ...u, position: stand } : u)) };
    const fillCommand = { type: 'fillMoat', unitId: sapper.id, at: moatPoint } as const;
    const first = applyCommand(ctx, s, fillCommand);
    expect(first.rejection).toBeNull();
    s = first.state;
    expect(hasPath(PROFILE, s, outer, foot)).toBe(false);
    s = applyCommand(ctx, applyCommand(ctx, s, { type: 'endTurn' }).state, { type: 'endTurn' }).state;
    const second = applyCommand(ctx, s, fillCommand);
    expect(second.rejection).toBeNull();
    expect(second.events.some((e) => e.type === 'moatFilled')).toBe(true);
    expect(hasPath(PROFILE, second.state, outer, foot)).toBe(true);
  });
});

