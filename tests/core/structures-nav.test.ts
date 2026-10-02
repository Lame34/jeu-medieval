/**
 * The navigation grid follows the castle structures (structures.ts: syncNav, navSignature), the
 * deck-step rule (nav-grid.ts: deckStepCost), edgePassable / connectedComponents (pathfinding.ts)
 * and the early stop of computeCostField (reachable.ts: `settle`).
 */
import { describe, expect, it } from 'vitest';
import {
  IMPASSABLE,
  NEIGHBOR_DX,
  NEIGHBOR_DZ,
  Rng,
  TerrainLayer,
  applyCommand,
  buildNavGrid,
  computeCostField,
  connectedComponents,
  createBattle,
  createPathContext,
  deckStepCost,
  edgeCost,
  edgePassable,
  findPath,
  isPassable,
  segmentCost,
  type MovementProfile,
  type NavGrid,
} from '@core/index.ts';
import { initialStructures, navSignature, syncNav } from '@core/battle/structures.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { DECK_HEIGHT_M, freshBattle, GATE_Z0, IDS, MAP_W, MOAT_X0, MOAT_X1, WALL_X, withBroken } from './siege-fixture.ts';
import { centerOf, fillRect, flatTerrain, randomTerrain, setPlaneHeights } from './helpers.ts';

const FOOT: MovementProfile = 'foot';
const ENGINE: MovementProfile = 'engine';
const NO_SEED_TRIALS = 40;
const FUZZ_SEED = 'test-structures-nav-fuzz';
/** A deck step well under / over DEFAULT_RULES.movement.maxDeckStepM (1.2 m). */
const LOW_DECK_M = 1;
const HIGH_DECK_M = 2;
const MAX_STEP_M = DEFAULT_RULES.movement.maxDeckStepM;

const cell = (cx: number, cz: number, w = MAP_W) => cz * w + cx;

describe('syncNav: the grid follows the broken structures', () => {
  it('a wall breach turns the wall-walk into walkable rubble at ground level', () => {
    const { ctx, state } = freshBattle();
    const wall = ctx.structures.find((d) => d.id === IDS.wallA)!;
    const i = wall.cells[0] as number;
    syncNav(ctx, state.structures);
    expect(ctx.nav.deck[i]).toBeGreaterThan(0);
    expect(isPassable(ctx.nav, FOOT, WALL_X, 3)).toBe(true);
    // Sealed from the bank: the wall-walk is out of reach from the ground.
    expect(findPath(ctx.paths, { profile: FOOT, start: cell(17, 3), goal: cell(24, 3) })).toBeNull();
    const broken = withBroken(state, IDS.wallA);
    syncNav(ctx, broken.structures);
    expect(ctx.nav.deck[i]).toBe(0);
    expect(ctx.nav.terrain.layers[i]).toBe(TerrainLayer.Rubble);
    const path = findPath(ctx.paths, { profile: FOOT, start: cell(17, 3), goal: cell(24, 3) });
    expect(path).not.toBeNull();
    // The other segment is still intact.
    const wallB = new Set(ctx.structures.find((d) => d.id === IDS.wallB)!.cells);
    const viaA = findPath(ctx.paths, { profile: FOOT, start: cell(17, 15), goal: cell(24, 15) });
    expect(viaA?.cells.some((c) => wallB.has(c))).toBe(false);
  });

  it('the gatehouse opens only when the gate AND the portcullis are down', () => {
    const { ctx, state } = freshBattle();
    const cross = () => findPath(ctx.paths, { profile: FOOT, start: cell(17, GATE_Z0 + 1), goal: cell(24, GATE_Z0 + 1) });
    for (const down of [[IDS.bridge], [IDS.bridge, IDS.gate], [IDS.bridge, IDS.portcullis]]) {
      syncNav(ctx, withBroken(state, ...down).structures);
      expect(cross(), `broken: ${down.join(',')}`).toBeNull();
    }
    syncNav(ctx, withBroken(state, IDS.bridge, IDS.gate, IDS.portcullis).structures);
    expect(cross()).not.toBeNull();
    expect(ctx.nav.terrain.layers[cell(WALL_X, GATE_Z0 + 1)]).toBe(TerrainLayer.Road);
  });

  it('a lowered drawbridge puts a deck level with the sill and joins both banks; raised: no way across', () => {
    const { ctx, state } = freshBattle();
    const across = () => findPath(ctx.paths, { profile: FOOT, start: cell(5, GATE_Z0 + 1), goal: cell(16, GATE_Z0 + 1) });
    syncNav(ctx, state.structures);
    expect(across()).toBeNull();
    expect(isPassable(ctx.nav, FOOT, MOAT_X0 + 1, GATE_Z0 + 1)).toBe(false);
    syncNav(ctx, withBroken(state, IDS.bridge).structures);
    const mid = cell(MOAT_X0 + 1, GATE_Z0 + 1);
    expect(ctx.nav.terrain.layers[mid]).toBe(TerrainLayer.Bridge);
    expect((ctx.nav.centerHeight[mid] as number) + (ctx.nav.deck[mid] as number)).toBeCloseTo(DECK_HEIGHT_M, 6);
    expect(across()).not.toBeNull();
    // Only the corridor under the bridge is crossable, not the whole moat.
    expect(isPassable(ctx.nav, FOOT, MOAT_X1, GATE_Z0 - 2)).toBe(false);
  });

  it('engines cross the bridge too (the ram reaches the gate front once it is down)', () => {
    const { ctx, state } = freshBattle();
    syncNav(ctx, withBroken(state, IDS.bridge).structures);
    expect(findPath(ctx.paths, { profile: ENGINE, start: cell(5, GATE_Z0 + 1), goal: cell(WALL_X - 1, GATE_Z0 + 1) })).not.toBeNull();
  });

  it('a signature already seen gives back the very same cached grid', () => {
    const { ctx, state } = freshBattle();
    syncNav(ctx, state.structures);
    const intact = ctx.nav;
    const intactPaths = ctx.paths;
    const downA = withBroken(state, IDS.wallA);
    syncNav(ctx, downA.structures);
    expect(ctx.nav).not.toBe(intact);
    const builtOnce = ctx.nav;
    // A fresh array with the same broken set (as a replay would build it).
    syncNav(ctx, withBroken(state, IDS.wallA).structures);
    expect(ctx.nav).toBe(builtOnce);
    syncNav(ctx, initialStructures(ctx.structures));
    expect(ctx.nav).toBe(intact);
    expect(ctx.paths).toBe(intactPaths);
    // Syncing the same array twice is a no-op.
    const before = ctx.navFor;
    syncNav(ctx, before!);
    expect(ctx.nav).toBe(intact);
  });

  it('navSignature lists broken structures only, in state order', () => {
    const { state } = freshBattle();
    expect(navSignature(state.structures)).toBe('');
    expect(navSignature(withBroken(state, IDS.wallA, IDS.gate).structures)).toBe([IDS.gate, IDS.wallA].join('|'));
  });

  it('applyCommand leaves the grid synced with the resulting state', () => {
    const { ctx, state } = freshBattle();
    const dead = { ...state, units: state.units.map((u) => (u.id === IDS.winch ? { ...u, alive: false, hp: 0 } : u)) };
    const res = applyCommand(ctx, dead, { type: 'endTurn' });
    expect(ctx.navKey).toBe(IDS.bridge);
    expect(ctx.navFor).toBe(res.state.structures);
    const scenarioBattle = createBattle(ctx, 'again', { units: [] });
    expect(ctx.navKey).toBe(navSignature(scenarioBattle.structures));
  });
});

describe('deckStepCost', () => {
  function twoCells(heightA: number, heightB: number, deckA: number, deckB: number): NavGrid {
    const t = flatTerrain(2, 1, 1);
    // Corner layout of a 2 x 1 map: 3 corners per row, 2 rows.
    t.heights.fill(0);
    for (const iz of [0, 1]) {
      t.heights[iz * 3 + 0] = heightA;
      t.heights[iz * 3 + 1] = (heightA + heightB) / 2;
      t.heights[iz * 3 + 2] = heightB;
    }
    fillRect(t, 0, 0, 1, 0, TerrainLayer.Bridge);
    return buildNavGrid(t, DEFAULT_RULES, Float32Array.from([deckA, deckB]));
  }

  it('is 0 between two ground cells whatever the relief', () => {
    const nav = twoCells(0, 0.8, 0, 0);
    expect(deckStepCost(nav, 1, 0, 1)).toBe(0);
    expect(deckStepCost(nav, 1, 1, 0)).toBe(0);
  });

  it('measures surfaces (relief + deck) once a cell carries a deck: climbing costs, descending is free', () => {
    const nav = twoCells(0, 0, 0, LOW_DECK_M);
    const costTo = 2;
    expect(deckStepCost(nav, costTo, 0, 1)).toBeCloseTo(costTo * DEFAULT_RULES.movement.uphillPenaltyPerGrade * LOW_DECK_M, 9);
    expect(deckStepCost(nav, costTo, 1, 0)).toBe(0);
  });

  it('a deck level with a lower bank meets it: the relief gap is cancelled by the deck', () => {
    const nav = twoCells(0, -LOW_DECK_M, 0, LOW_DECK_M);
    expect(deckStepCost(nav, 1, 0, 1)).toBeLessThan(IMPASSABLE);
    expect(Math.abs((nav.centerHeight[1] as number) + (nav.deck[1] as number) - (nav.centerHeight[0] as number))).toBeLessThan(MAX_STEP_M);
  });

  it('a step above maxDeckStepM is IMPASSABLE, up or down', () => {
    const nav = twoCells(0, 0, 0, HIGH_DECK_M);
    expect(HIGH_DECK_M).toBeGreaterThan(MAX_STEP_M);
    expect(deckStepCost(nav, 1, 0, 1)).toBe(IMPASSABLE);
    expect(deckStepCost(nav, 1, 1, 0)).toBe(IMPASSABLE);
    expect(edgePassable(nav, FOOT, 0, 0, 1, 0)).toBe(false);
    expect(edgeCost(nav, FOOT, 0, 0, 1, 0)).toBe(IMPASSABLE);
    expect(segmentCost(nav, FOOT, 0.5, 0.5, 1.5, 0.5)).toBe(IMPASSABLE);
  });

  it('edgeCost is bit-for-bit segmentCost between neighbouring centres on maps with decks (fuzz)', () => {
    const rng = Rng.create(FUZZ_SEED);
    const DECK_CHOICES = [0, 0, 0.3, 0.9, LOW_DECK_M, HIGH_DECK_M];
    let finite = 0;
    for (let trial = 0; trial < NO_SEED_TRIALS; trial++) {
      const t = randomTerrain(rng, { minSize: 4, maxSize: 7, heightRange: 0.5 });
      const deck = new Float32Array(t.width * t.depth);
      for (let i = 0; i < deck.length; i++) deck[i] = rng.pick(DECK_CHOICES);
      const nav = buildNavGrid(t, DEFAULT_RULES, deck);
      for (const profile of ['foot', 'engine'] as const) {
        for (let cz = 0; cz < t.depth; cz++) {
          for (let cx = 0; cx < t.width; cx++) {
            for (let n = 0; n < NEIGHBOR_DX.length; n++) {
              const dx = NEIGHBOR_DX[n] as number;
              const dz = NEIGHBOR_DZ[n] as number;
              const a = centerOf(cx, cz);
              const b = centerOf(cx + dx, cz + dz);
              const e = edgeCost(nav, profile, cx, cz, dx, dz);
              const s = segmentCost(nav, profile, a.x, a.z, b.x, b.z);
              if (cx + dx < 0 || cz + dz < 0 || cx + dx >= t.width || cz + dz >= t.depth) {
                expect(e).toBe(IMPASSABLE);
                continue;
              }
              expect(Object.is(e, s), `trial ${trial} seed ${FUZZ_SEED} ${profile} (${cx},${cz})+(${dx},${dz}): ${e} vs ${s}`).toBe(true);
              expect(edgePassable(nav, profile, cx, cz, dx, dz)).toBe(e !== IMPASSABLE);
              if (e !== IMPASSABLE) finite++;
            }
          }
        }
      }
    }
    expect(finite).toBeGreaterThan(0);
  });
});

describe('connectedComponents', () => {
  function pockets(): NavGrid {
    // 9 x 3 plain; a wall column at x = 4 splits it; a lone cell at (7, 1) is walled in.
    const t = flatTerrain(9, 3, 1);
    fillRect(t, 4, 0, 4, 2, TerrainLayer.Wall);
    fillRect(t, 6, 0, 8, 2, TerrainLayer.Wall);
    fillRect(t, 7, 1, 7, 1, TerrainLayer.Plain);
    return buildNavGrid(t, DEFAULT_RULES);
  }

  it('labels connected cells alike, sealed pockets differently, blocked cells -1', () => {
    const nav = pockets();
    const label = connectedComponents(createPathContext(nav), FOOT);
    expect(label[cell(0, 0, 9)]).toBe(label[cell(3, 2, 9)]);
    expect(label[cell(5, 1, 9)]).not.toBe(label[cell(0, 0, 9)]);
    expect(label[cell(7, 1, 9)]).not.toBe(label[cell(5, 1, 9)]);
    expect(label[cell(7, 1, 9)]).not.toBe(label[cell(0, 0, 9)]);
    expect(label[cell(4, 1, 9)]).toBe(-1);
  });

  it('is cached per grid and profile', () => {
    const ctx = createPathContext(pockets());
    expect(connectedComponents(ctx, FOOT)).toBe(connectedComponents(ctx, FOOT));
    expect(connectedComponents(ctx, ENGINE)).not.toBe(connectedComponents(ctx, FOOT));
  });

  it('two cells touching only by a corner (both sides blocked) are not connected', () => {
    const t = flatTerrain(2, 2, 1);
    fillRect(t, 1, 0, 1, 0, TerrainLayer.Wall);
    fillRect(t, 0, 1, 0, 1, TerrainLayer.Wall);
    const nav = buildNavGrid(t, DEFAULT_RULES);
    expect(edgePassable(nav, FOOT, 0, 0, 1, 1)).toBe(false);
    const label = connectedComponents(createPathContext(nav), FOOT);
    expect(label[0]).not.toBe(label[3]);
  });

  it('agrees with findPath on random grids (reachable iff same label)', () => {
    const rng = Rng.create(`${FUZZ_SEED}-components`);
    for (let trial = 0; trial < NO_SEED_TRIALS; trial++) {
      const nav = buildNavGrid(randomTerrain(rng, { minSize: 4, maxSize: 7 }), DEFAULT_RULES);
      const ctx = createPathContext(nav);
      const label = connectedComponents(ctx, FOOT);
      const count = nav.width * nav.depth;
      for (let a = 0; a < count; a++) {
        for (let b = 0; b < count; b++) {
          if ((label[a] as number) < 0 || (label[b] as number) < 0) continue;
          const found = findPath(ctx, { profile: FOOT, start: a, goal: b }) !== null;
          expect(found, `trial ${trial} ${a}->${b}`).toBe(label[a] === label[b]);
        }
      }
    }
  });
});

describe('computeCostField with settle', () => {
  /** 30 x 6 plain strip with a wall column at x = 20 (right side sealed) and some relief. */
  function strip(): NavGrid {
    const t = flatTerrain(30, 6, 1);
    setPlaneHeights(t, 0.02, 0.01);
    fillRect(t, 20, 0, 20, 5, TerrainLayer.Wall);
    return buildNavGrid(t, DEFAULT_RULES);
  }
  const BUDGET = 40;
  const SLACK_AP = 1.5;

  it('matches the full field up to the limit and is IMPASSABLE beyond', () => {
    const nav = strip();
    const ctx = createPathContext(nav);
    const origins = [cell(2, 2, 30)];
    const target = cell(10, 3, 30);
    const full = computeCostField(ctx, FOOT, origins, BUDGET).slice();
    const early = computeCostField(ctx, FOOT, origins, BUDGET, { cells: [target], slackAp: SLACK_AP });
    const limit = (full[target] as number) + SLACK_AP;
    let cut = 0;
    for (let i = 0; i < full.length; i++) {
      if ((full[i] as number) <= limit) expect(early[i], `cell ${i}`).toBe(full[i]);
      else {
        expect(early[i]).toBe(IMPASSABLE);
        if (full[i] !== IMPASSABLE) cut++;
      }
    }
    expect(cut).toBeGreaterThan(0);
  });

  it('stops at once when no settle cell can be reached from the origins (sealed pocket)', () => {
    const nav = strip();
    const ctx = createPathContext(nav);
    const sealed = cell(25, 3, 30);
    const field = computeCostField(ctx, FOOT, [cell(2, 2, 30)], BUDGET, { cells: [sealed], slackAp: SLACK_AP });
    expect(field.every((v) => v === IMPASSABLE)).toBe(true);
    // The unsettled call from inside the pocket does reach it.
    expect(computeCostField(ctx, FOOT, [cell(24, 3, 30)], BUDGET)[sealed]).toBeLessThan(IMPASSABLE);
  });

  it('ignores unreachable settle cells when others are reachable', () => {
    const nav = strip();
    const ctx = createPathContext(nav);
    const origins = [cell(2, 2, 30)];
    const reachable = cell(8, 2, 30);
    const full = computeCostField(ctx, FOOT, origins, BUDGET).slice();
    const early = computeCostField(ctx, FOOT, origins, BUDGET, { cells: [cell(25, 3, 30), reachable], slackAp: 0 });
    expect(early[reachable]).toBe(full[reachable]);
    expect(early.filter((v) => v !== IMPASSABLE).length).toBeLessThan(full.filter((v) => v !== IMPASSABLE).length);
  });

  it('impassable origins give an empty field; budget still caps the search', () => {
    const nav = strip();
    const ctx = createPathContext(nav);
    expect(computeCostField(ctx, FOOT, [cell(20, 2, 30)], BUDGET, { cells: [cell(3, 3, 30)], slackAp: 1 }).every((v) => v === IMPASSABLE)).toBe(true);
    const small = computeCostField(ctx, FOOT, [cell(2, 2, 30)], 1, { cells: [cell(18, 2, 30)], slackAp: 1 });
    expect(small[cell(18, 2, 30)]).toBe(IMPASSABLE);
  });

  it('is exact on random grids: same values as the full field wherever below the limit (fuzz)', () => {
    const rng = Rng.create(`${FUZZ_SEED}-settle`);
    for (let trial = 0; trial < NO_SEED_TRIALS; trial++) {
      const nav = buildNavGrid(randomTerrain(rng, { minSize: 5, maxSize: 8 }), DEFAULT_RULES);
      const ctx = createPathContext(nav);
      const count = nav.width * nav.depth;
      const origins = [rng.int(0, count - 1), rng.int(0, count - 1)];
      const targets = [rng.int(0, count - 1), rng.int(0, count - 1)];
      const slackAp = rng.float(0, 2);
      const full = computeCostField(ctx, FOOT, origins, BUDGET).slice();
      const early = computeCostField(ctx, FOOT, origins, BUDGET, { cells: targets, slackAp });
      const label = connectedComponents(ctx, FOOT);
      const reachedLabels = new Set(origins.map((o) => label[o] as number).filter((l) => l >= 0));
      const live = targets.filter((c) => reachedLabels.has(label[c] as number));
      const limit = live.length === 0 ? -1 : Math.max(...live.map((c) => full[c] as number)) + slackAp;
      for (let i = 0; i < count; i++) {
        if ((full[i] as number) <= limit) expect(early[i], `trial ${trial} cell ${i}`).toBe(full[i]);
        else expect(early[i], `trial ${trial} cell ${i}`).toBe(IMPASSABLE);
      }
    }
  });
});
