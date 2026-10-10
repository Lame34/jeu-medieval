/**
 * Combat (brief §9.7): previewAttack/resolveAttack rejection reasons, the hit-chance and damage
 * formulas (cross-checked against an independent reference written in this file), range, line of
 * sight, riposte, and end-to-end resolution (AP/actions, death, battleEnded, RNG advance).
 */
import { describe, expect, it } from 'vitest';
import {
  ARMOR_CLASSES,
  COVER_LEVELS,
  DAMAGE_TYPES,
  applyCommand,
  battleStatus,
  blowOdds,
  coverAgainst,
  createBattle,
  createBattleContext,
  findUnit,
  garrisonStrength,
  hashBattleState,
  hashValue,
  heightSteps,
  previewAttack,
  replay,
  resolveAttack,
  setHeightAtCorner,
  statusAfterBlows,
  TerrainLayer,
  vec2,
  type ArmorClass,
  type BattleContext,
  type BattleState,
  type Command,
  type CoverLevel,
  type DamageType,
  type GameEvent,
  type GameRules,
  type Scenario,
  type TerrainData,
  type Vec2,
} from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { centerOf, fillRect, flatTerrain, rulesWithDamageOverrides, rulesWithMultiplier, SEEDS, setPlaneHeights } from './helpers.ts';

const SEED = SEEDS.combat;
const RULES = DEFAULT_RULES;
const D = RULES.damage;

function makeCtx(width = 10, depth = 10, rules: GameRules = RULES) {
  return createBattleContext(flatTerrain(width, depth, 1), rules);
}

/**
 * Raises all four corners of cell (cx, cz) to `height`, keeping that single cell perfectly flat
 * (and therefore walkable) while every other cell keeps its original height. Neighbouring cells
 * become steep at the seam — harmless here, since no unit spawns there.
 */
function raiseCellPlateau(terrain: TerrainData, cx: number, cz: number, height: number): void {
  setHeightAtCorner(terrain, cx, cz, height);
  setHeightAtCorner(terrain, cx + 1, cz, height);
  setHeightAtCorner(terrain, cx, cz + 1, height);
  setHeightAtCorner(terrain, cx + 1, cz + 1, height);
}

/**
 * Moves already-spawned units straight to new positions, bypassing createBattle's spawn-cell
 * passability check: useful to place a unit on a steep plateau built only to create a height
 * difference for combat maths, which (unlike movement) never needs the cell to be walkable.
 */
function relocate(state: BattleState, positions: Readonly<Record<string, Vec2>>): BattleState {
  return { ...state, units: state.units.map((u) => (positions[u.id] ? { ...u, position: positions[u.id] as Vec2 } : u)) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Independent re-implementation of the documented hit-chance formula, read from `rules`. */
function referenceHitChance(rules: GameRules, accuracy: number, accuracyFactor: number, steps: number, cover: CoverLevel, obscurance: number): number {
  const raw = accuracy * accuracyFactor + steps * rules.damage.accuracyPerHeightStep - rules.damage.coverPenalty[cover] - obscurance * rules.damage.obscurancePenalty;
  return clamp(raw, rules.damage.hitChanceMin, rules.damage.hitChanceMax);
}

/** Independent re-implementation of the documented damage formula, read from `rules`. */
function referenceDamage(rules: GameRules, power: number, type: DamageType, armor: ArmorClass): { min: number; max: number } {
  const base = power * (1 - rules.damage.armorReduction[armor]) * rules.damage.multipliers[type][armor];
  return {
    min: Math.max(rules.damage.minDamageOnHit, Math.round(base)),
    max: Math.max(rules.damage.minDamageOnHit, Math.round(base * rules.damage.critMultiplier)),
  };
}

// ---------------------------------------------------------------------------------------------
// blowOdds: formula (unit-level, no terrain/positions involved beyond what is passed in)
// ---------------------------------------------------------------------------------------------

describe('blowOdds: hit-chance formula matches the reference, over every type × armor × cover', () => {
  const ctx = makeCtx();
  const archerAttack = RULES.units['archer']!.attack!;
  const STEPS_CASES = [-3, -1, 0, 1, 3];
  const OBSCURANCE_CASES = [0, 0.4, 1];

  it('cross-checks hitChance for every combination of height step, cover level and obscurance', () => {
    const officer = RULES.units['officer']!;
    for (const steps of STEPS_CASES) {
      for (const cover of COVER_LEVELS) {
        for (const obscurance of OBSCURANCE_CASES) {
          const odds = blowOdds(ctx, archerAttack, officer, 1, steps, cover, obscurance);
          const expected = referenceHitChance(RULES, archerAttack.accuracy, 1, steps, cover, obscurance);
          expect(odds.hitChance).toBeCloseTo(expected, 10);
        }
      }
    }
  });

  it('applies the riposte accuracy factor as a plain multiplier on accuracy', () => {
    const wallGuardAttack = RULES.units['wallGuard']!.attack!;
    const soldier = RULES.units['soldier']!;
    const odds = blowOdds(ctx, wallGuardAttack, soldier, D.riposteAccuracyFactor, 0, 'none', 0);
    expect(odds.hitChance).toBeCloseTo(referenceHitChance(RULES, wallGuardAttack.accuracy, D.riposteAccuracyFactor, 0, 'none', 0), 10);
  });

  it('is bounded to [hitChanceMin, hitChanceMax] when the raw formula overshoots either side', () => {
    const officer = RULES.units['officer']!;
    const high = blowOdds(ctx, archerAttack, officer, 1, 1000, 'none', 0); // absurd height advantage
    expect(high.hitChance).toBe(D.hitChanceMax);
    const low = blowOdds(ctx, archerAttack, officer, 1, -1000, 'heavy', 1); // absurd disadvantage
    expect(low.hitChance).toBe(D.hitChanceMin);
  });
});

describe('blowOdds: damage formula matches the reference, over every type × armor pair', () => {
  const ctx = makeCtx();

  it('cross-checks min (normal hit) and max (critical) damage for every damage type × armor class', () => {
    for (const type of DAMAGE_TYPES) {
      for (const armor of ARMOR_CLASSES) {
        const attack = { type, power: 10, rangeM: 0, accuracy: 0.5 };
        const target = { ...RULES.units['officer']!, armor };
        const odds = blowOdds(ctx, attack, target, 1, 0, 'none', 0);
        expect(odds.damage).toEqual(referenceDamage(RULES, 10, type, armor));
        expect(Number.isInteger(odds.damage.min)).toBe(true);
        expect(Number.isInteger(odds.damage.max)).toBe(true);
      }
    }
  });

  it('armour table: piercing is weak against heavy armour, blunt is strong against it (current J3 balance)', () => {
    // Pinned to the shipped damage.json; update alongside the data at the J7 balancing pass.
    expect(RULES.damage.multipliers.piercing.heavy).toBe(0.5);
    expect(RULES.damage.multipliers.blunt.heavy).toBe(1.5);
    const archer = RULES.units['archer']!.attack!;
    const soldier = RULES.units['soldier']!.attack!;
    const heavyTarget = RULES.units['officer']!;
    expect(blowOdds(ctx, archer, heavyTarget, 1, 0, 'none', 0).damage).toEqual(referenceDamage(RULES, archer.power, 'piercing', 'heavy'));
    expect(blowOdds(ctx, soldier, heavyTarget, 1, 0, 'none', 0).damage).toEqual(referenceDamage(RULES, soldier.power, 'blunt', 'heavy'));
  });

  it('damage of a landed blow never falls below minDamageOnHit, even when the multiplier is ~0', () => {
    const nearZero = rulesWithMultiplier('piercing', 'heavy', 0.0001);
    const ctxNearZero = makeCtx(2, 2, nearZero);
    const archer = nearZero.units['archer']!.attack!;
    const heavyTarget = nearZero.units['officer']!;
    const odds = blowOdds(ctxNearZero, archer, heavyTarget, 1, 0, 'none', 0);
    expect(odds.damage.min).toBe(nearZero.damage.minDamageOnHit);
    expect(odds.damage.max).toBe(nearZero.damage.minDamageOnHit);
  });
});

// ---------------------------------------------------------------------------------------------
// heightSteps: truncation towards zero, symmetric
// ---------------------------------------------------------------------------------------------

describe('heightSteps', () => {
  const GRADE = 1; // 1 m of height per metre of x: sampleHeight(x) = GRADE * x exactly (a plane).

  function ctxWithRamp(width: number) {
    const terrain = flatTerrain(width, 3, 1);
    setPlaneHeights(terrain, GRADE, 0, 0);
    return createBattleContext(terrain, RULES);
  }

  it('truncates a non-exact ratio towards zero (not floor/ceil)', () => {
    const ctx = ctxWithRamp(40);
    const from = vec2(8.9, 1.5); // height 8.9
    const to = vec2(0.5, 1.5); // height 0.5
    const diff = 8.9 - 0.5; // = 8.4; 8.4 / heightStepM(3) = 2.8 -> truncates to 2, not 3.
    expect(Math.trunc(diff / D.heightStepM)).toBe(2);
    expect(heightSteps(ctx, from, to)).toBe(2);
  });

  it('is symmetric: heightSteps(A, B) === -heightSteps(B, A)', () => {
    const ctx = ctxWithRamp(40);
    const a = vec2(35.5, 1.5);
    const b = vec2(1.5, 1.5);
    expect(heightSteps(ctx, a, b)).toBe(-heightSteps(ctx, b, a));
    expect(heightSteps(ctx, a, b)).not.toBe(0); // sanity: the pair is not trivially flat
  });

  it('returns 0 for two points inside the same height band, even with a slope between them', () => {
    const ctx = ctxWithRamp(10);
    // Heights 0.5 and 1.4: both below one heightStepM (3), so both truncate to step 0 apart.
    // (toBeCloseTo, not toBe: Math.trunc can yield -0 here, and -0 !== 0 under Object.is.)
    expect(heightSteps(ctx, vec2(0.5, 1.5), vec2(1.4, 1.5))).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------------------------
// coverAgainst: target cell cover + directional hedge cover
// ---------------------------------------------------------------------------------------------

describe('coverAgainst', () => {
  it("uses the target cell's own cover when nothing directional is in the way (forest: partial)", () => {
    const terrain = flatTerrain(6, 3, 1);
    fillRect(terrain, 4, 1, 4, 1, TerrainLayer.Forest); // target's cell only
    const ctx = createBattleContext(terrain, RULES);
    expect(coverAgainst(ctx, centerOf(0, 1), centerOf(4, 1))).toBe('partial');
  });

  it('a hedge just in front of the target, on the shooter’s side, raises its cover', () => {
    const terrain = flatTerrain(8, 3, 1);
    fillRect(terrain, 5, 1, 5, 1, TerrainLayer.Hedge); // adjacent to the target, towards the shooter
    const ctx = createBattleContext(terrain, RULES);
    const shooter = centerOf(0, 1);
    const target = centerOf(6, 1); // target cell itself is Plain (cover 'none')
    expect(coverAgainst(ctx, shooter, target)).toBe('partial'); // Hedge cover level
  });

  it('a hedge behind the target (away from the shooter) does not protect it', () => {
    const terrain = flatTerrain(8, 3, 1);
    fillRect(terrain, 7, 1, 7, 1, TerrainLayer.Hedge); // on the far side of the target from the shooter
    const ctx = createBattleContext(terrain, RULES);
    const shooter = centerOf(0, 1);
    const target = centerOf(6, 1); // Plain
    expect(coverAgainst(ctx, shooter, target)).toBe('none');
  });

  it('a hedge farther than directionalCoverReachM from the target does not count', () => {
    const targetCx = 6;
    // Strictly between the shooter and the target, but more than directionalCoverReachM of
    // travelled distance away from the target's edge: outside the reach window entirely.
    const farCx = targetCx - Math.ceil(D.directionalCoverReachM) - 1;
    expect(farCx).toBeGreaterThanOrEqual(0); // sanity: still on the map, between shooter and target
    const terrain = flatTerrain(12, 3, 1);
    fillRect(terrain, farCx, 1, farCx, 1, TerrainLayer.Hedge);
    const ctx = createBattleContext(terrain, RULES);
    const shooter = centerOf(0, 1);
    const target = centerOf(targetCx, 1); // Plain
    expect(coverAgainst(ctx, shooter, target)).toBe('none');
  });

  it('picks whichever protects more: the target’s own heavy cover beats a lighter hedge', () => {
    const terrain = flatTerrain(8, 3, 1);
    fillRect(terrain, 6, 1, 6, 1, TerrainLayer.Rock); // target's own cell: heavy cover
    fillRect(terrain, 5, 1, 5, 1, TerrainLayer.Hedge); // partial, in front of it
    const ctx = createBattleContext(terrain, RULES);
    expect(coverAgainst(ctx, centerOf(0, 1), centerOf(6, 1))).toBe('heavy');
  });
});

// ---------------------------------------------------------------------------------------------
// previewAttack: every rejection reason
// ---------------------------------------------------------------------------------------------

describe('previewAttack: rejections', () => {
  function twoUnitScenario(): Scenario {
    return {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
      ],
    };
  }

  it('unknownUnit: the attacker id does not exist', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, twoUnitScenario());
    expect(previewAttack(ctx, state, 'ghost', 'def')).toEqual({ ok: false, reason: 'unknownUnit' });
  });

  it('unitDead: the attacker exists but is not alive', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, twoUnitScenario());
    const dead: BattleState = { ...state, units: state.units.map((u) => (u.id === 'atk' ? { ...u, alive: false } : u)) };
    expect(previewAttack(ctx, dead, 'atk', 'def')).toEqual({ ok: false, reason: 'unitDead' });
  });

  it('notYourTurn: the attacker belongs to the faction that is not currently active', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, twoUnitScenario()); // attacker's turn
    expect(previewAttack(ctx, state, 'def', 'atk')).toEqual({ ok: false, reason: 'notYourTurn' });
  });

  it('unknownTarget: the target id does not exist', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, twoUnitScenario());
    expect(previewAttack(ctx, state, 'atk', 'ghost')).toEqual({ ok: false, reason: 'unknownTarget' });
  });

  it('targetDead: the target exists but is not alive', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, twoUnitScenario());
    const dead: BattleState = { ...state, units: state.units.map((u) => (u.id === 'def' ? { ...u, alive: false } : u)) };
    expect(previewAttack(ctx, dead, 'atk', 'def')).toEqual({ ok: false, reason: 'targetDead' });
  });

  it('targetFriendly: the target belongs to the attacker’s own faction', () => {
    const ctx = makeCtx();
    const scenario: Scenario = {
      units: [
        { id: 'atk1', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'atk2', typeKey: 'knight', position: centerOf(2, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'atk1', 'atk2')).toEqual({ ok: false, reason: 'targetFriendly' });
  });

  it('noAttack: the attacker’s unit type has no attack rule (siegeTower)', () => {
    const ctx = makeCtx();
    const scenario: Scenario = {
      units: [
        { id: 'tower', typeKey: 'siegeTower', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'tower', 'def')).toEqual({ ok: false, reason: 'noAttack' });
  });

  it('noActionLeft: the attacker has already spent this turn’s attacks', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, twoUnitScenario());
    const spent: BattleState = { ...state, units: state.units.map((u) => (u.id === 'atk' ? { ...u, actions: 0 } : u)) };
    expect(previewAttack(ctx, spent, 'atk', 'def')).toEqual({ ok: false, reason: 'noActionLeft' });
  });

  it('insufficientAp: the attacker has less AP than attackApCost', () => {
    const ctx = makeCtx();
    const state = createBattle(ctx, SEED, twoUnitScenario());
    const starved: BattleState = { ...state, units: state.units.map((u) => (u.id === 'atk' ? { ...u, ap: D.attackApCost - 0.5 } : u)) };
    expect(previewAttack(ctx, starved, 'atk', 'def')).toEqual({ ok: false, reason: 'insufficientAp' });
  });

  it('outOfRange: the target is farther than the attacker’s effective range', () => {
    const ctx = makeCtx(20, 20);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(0, 0) }, // melee, reach meleeReachM
        { id: 'def', typeKey: 'wallGuard', position: centerOf(10, 0) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'atk', 'def')).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('noLineOfSight: a wall between a ranged attacker and its target blocks the shot', () => {
    const terrain = flatTerrain(6, 3, 1);
    fillRect(terrain, 2, 1, 3, 1, TerrainLayer.Wall);
    const ctx = createBattleContext(terrain, RULES);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: centerOf(0, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(5, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'atk', 'def')).toEqual({ ok: false, reason: 'noLineOfSight' });
  });
});

describe('applyCommand attack: forwards previewAttack rejections and leaves the state untouched', () => {
  it('targetFriendly, forwarded through the command layer', () => {
    const ctx = makeCtx();
    const scenario: Scenario = {
      units: [
        { id: 'atk1', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'atk2', typeKey: 'knight', position: centerOf(2, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    const command: Command = { type: 'attack', unitId: 'atk1', targetId: 'atk2' };
    const result = applyCommand(ctx, state, command);
    expect(result.rejection).toBe('targetFriendly');
    expect(result.state).toBe(state);
    expect(result.events).toEqual([{ type: 'commandRejected', command, reason: 'targetFriendly' }]);
  });
});

// ---------------------------------------------------------------------------------------------
// previewAttack: range (melee reach constant, ranged range extended by height)
// ---------------------------------------------------------------------------------------------

// Unit spawns snap to cell centres (…, 0.5), so only *integer* metre separations survive
// exactly: every scenario below places units via centerOf(cx, cz) and reasons in whole cells.
describe('previewAttack: range', () => {
  it('melee reach is exactly meleeReachM: the first whole-cell distance beyond it is rejected', () => {
    const justBeyondReach = Math.ceil(D.meleeReachM); // smallest integer distance > meleeReachM
    const ctx = makeCtx(justBeyondReach + 5, 3);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(0, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(justBeyondReach, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'atk', 'def')).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('melee reach is not extended by a height advantage (unlike ranged attacks)', () => {
    const reachCells = Math.ceil(D.meleeReachM) + 1;
    const width = reachCells + 5;
    const terrain = flatTerrain(width, 3, 1);
    raiseCellPlateau(terrain, 0, 1, D.heightStepM * 5); // attacker's cell: a tall, flat plateau
    const ctx = createBattleContext(terrain, RULES);
    // Spawn on safe, flat ground (a walkable plateau footprint is not guaranteed at the seam),
    // then relocate: previewAttack needs no walkable path, only positions and terrain height.
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(width - 1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(width - 2, 1) },
      ],
    };
    const spawned = createBattle(ctx, SEED, scenario);
    const state = relocate(spawned, { atk: centerOf(0, 1), def: centerOf(reachCells, 1) });
    expect(heightSteps(ctx, findUnit(state, 'atk')!.position, findUnit(state, 'def')!.position)).toBeGreaterThan(0); // sanity
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('a ranged shot one metre beyond rangeM is rejected on flat ground', () => {
    const archerRangeM = RULES.units['archer']!.attack!.rangeM;
    const distanceCells = archerRangeM + 1;
    const ctx = makeCtx(distanceCells + 5, 3);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: centerOf(0, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(distanceCells, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'atk', 'def')).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('the same shot becomes possible once the shooter stands high enough (rangePerHeightStep)', () => {
    const archerRangeM = RULES.units['archer']!.attack!.rangeM;
    const distanceCells = archerRangeM + 1;
    const width = distanceCells + 5;
    const terrain = flatTerrain(width, 3, 1);
    // A height difference of 1.5 heightStepM gives exactly +1 step (truncated), enough extra
    // range (rangePerHeightStep * rangeM) to comfortably clear the 1 m overshoot.
    const grade = -(D.heightStepM * 1.5) / distanceCells; // shooter (lower x) ends up higher
    setPlaneHeights(terrain, grade, 0, 0);
    const ctx = createBattleContext(terrain, RULES);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: centerOf(0, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(distanceCells, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    const result = previewAttack(ctx, state, 'atk', 'def');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.heightSteps).toBe(1);
      expect(result.preview.effectiveRangeM).toBeCloseTo(archerRangeM * (1 + 1 * D.rangePerHeightStep), 6);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// previewAttack: line of sight (relief blocks it, indirect fire bypasses it)
// ---------------------------------------------------------------------------------------------

describe('previewAttack: line of sight', () => {
  it('a hill between a ranged attacker and its target blocks the shot ("terrain")', () => {
    const width = 20;
    const terrain = flatTerrain(width, 3, 1);
    const PLATEAU_HEIGHT_M = 20; // well above eye/target height: cannot be shot over
    for (let iz = 0; iz <= 3; iz++) {
      for (let ix = 8; ix <= 12; ix++) terrain.heights[iz * (width + 1) + ix] = PLATEAU_HEIGHT_M;
    }
    const ctx = createBattleContext(terrain, RULES);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: vec2(0.5, 1.5) },
        { id: 'def', typeKey: 'wallGuard', position: vec2(19.5, 1.5) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'atk', 'def')).toEqual({ ok: false, reason: 'noLineOfSight' });
  });

  it('an indirect-fire unit (catapult, tag indirectFire) needs no line of sight', () => {
    const terrain = flatTerrain(8, 3, 1);
    fillRect(terrain, 3, 1, 4, 1, TerrainLayer.Wall); // would block a direct shot
    const ctx = createBattleContext(terrain, RULES);
    const scenario: Scenario = {
      units: [
        { id: 'cat', typeKey: 'catapult', position: vec2(0.5, 1.5) },
        { id: 'def', typeKey: 'wallGuard', position: vec2(7.5, 1.5) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    const result = previewAttack(ctx, state, 'cat', 'def');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.obscurance).toBe(0);
  });

  it('a direct-fire shot along the very same line, from a non-indirect unit, is blocked', () => {
    const terrain = flatTerrain(8, 3, 1);
    fillRect(terrain, 3, 1, 4, 1, TerrainLayer.Wall);
    const ctx = createBattleContext(terrain, RULES);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: vec2(0.5, 1.5) },
        { id: 'def', typeKey: 'wallGuard', position: vec2(7.5, 1.5) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    expect(previewAttack(ctx, state, 'atk', 'def')).toEqual({ ok: false, reason: 'noLineOfSight' });
  });
});

// ---------------------------------------------------------------------------------------------
// previewAttack: riposte
// ---------------------------------------------------------------------------------------------

describe('previewAttack: riposte', () => {
  it('is present for a melee attack against a unit that can also fight at contact', () => {
    const ctx = makeCtx();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    const result = previewAttack(ctx, state, 'atk', 'def');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.riposte).not.toBeNull();
  });

  it('is absent for a ranged attack, even against a melee-capable target', () => {
    const ctx = makeCtx();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    const result = previewAttack(ctx, state, 'atk', 'def');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.riposte).toBeNull();
  });

  it('is absent when the target has no attack at all (siegeTower)', () => {
    const ctx = makeCtx();
    const scenario: Scenario = {
      units: [
        { id: 'def', typeKey: 'wallGuard', position: centerOf(1, 1) },
        { id: 'tower', typeKey: 'siegeTower', position: centerOf(2, 1) },
      ],
      firstFaction: 'defender',
    };
    const state = createBattle(ctx, SEED, scenario);
    const result = previewAttack(ctx, state, 'def', 'tower');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.riposte).toBeNull();
  });

  it('is absent when the target’s own weapon is ranged (cannot fight back at contact)', () => {
    const ctx = makeCtx();
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'crossbowman', position: centerOf(2, 1) }, // melee range, ranged weapon
      ],
    };
    const state = createBattle(ctx, SEED, scenario);
    const result = previewAttack(ctx, state, 'atk', 'def');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.riposte).toBeNull();
  });

  it('accuracy is scaled by riposteAccuracyFactor and height is inverted from the attacker’s', () => {
    const width = 10;
    const terrain = flatTerrain(width, 3, 1);
    raiseCellPlateau(terrain, 0, 1, D.heightStepM * 5); // attacker's cell: a tall, flat plateau
    const ctx = createBattleContext(terrain, RULES);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(width - 1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(width - 2, 1) },
      ],
    };
    const spawned = createBattle(ctx, SEED, scenario);
    const state = relocate(spawned, { atk: centerOf(0, 1), def: centerOf(1, 1) }); // melee range, atk higher
    const result = previewAttack(ctx, state, 'atk', 'def');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = result.preview.heightSteps;
    expect(steps).not.toBe(0);
    const wallGuardAttack = RULES.units['wallGuard']!.attack!;
    const expected = referenceHitChance(RULES, wallGuardAttack.accuracy, D.riposteAccuracyFactor, -steps, 'none', 0);
    expect(result.preview.riposte?.hitChance).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------------------------
// resolveAttack: AP/actions, facing, hp, death, battleEnded, RNG advance
// ---------------------------------------------------------------------------------------------

/** Forces every roll to hit, and to never critical: damage is then always exactly the min value. */
const ALWAYS_HIT_NEVER_CRIT = { hitChanceMin: 1, hitChanceMax: 1, critChance: 0 };

function meleeDuelState(ctx: BattleContext, scenario?: Partial<Scenario>): BattleState {
  const base: Scenario = {
    units: [
      { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
      { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
    ],
  };
  return createBattle(ctx, SEED, { ...base, ...scenario });
}

describe('resolveAttack: resource cost, facing, RNG advance', () => {
  it('deducts attackApCost AP and one action from the attacker', () => {
    const ctx = makeCtx();
    const state = meleeDuelState(ctx);
    const before = findUnit(state, 'atk')!;
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const { state: after } = resolveAttack(ctx, state, preview.preview);
    const atkAfter = findUnit(after, 'atk')!;
    expect(atkAfter.ap).toBeCloseTo(before.ap - D.attackApCost, 10);
    expect(atkAfter.actions).toBe(before.actions - 1);
  });

  it('turns the attacker to face the target', () => {
    const ctx = makeCtx();
    const state = meleeDuelState(ctx); // def is due east of atk
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const { state: after } = resolveAttack(ctx, state, preview.preview);
    const facing = findUnit(after, 'atk')!.facing;
    expect(facing.x).toBeGreaterThan(0);
    expect(Math.hypot(facing.x, facing.z)).toBeCloseTo(1, 6);
  });

  it('turns the melee target to face its attacker back, but leaves a ranged target’s facing untouched', () => {
    const ctx = makeCtx();
    const state = meleeDuelState(ctx);
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const { state: after } = resolveAttack(ctx, state, preview.preview);
    const defFacing = findUnit(after, 'def')!.facing;
    expect(defFacing.x).toBeLessThan(0); // faces back west, towards atk

    const rangedCtx = makeCtx();
    const rangedScenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: centerOf(0, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(9, 1) },
      ],
    };
    const rangedState = createBattle(rangedCtx, SEED, rangedScenario);
    const rangedBeforeFacing = findUnit(rangedState, 'def')!.facing;
    const rangedPreview = previewAttack(rangedCtx, rangedState, 'atk', 'def');
    expect(rangedPreview.ok).toBe(true);
    if (!rangedPreview.ok) return;
    const { state: rangedAfter } = resolveAttack(rangedCtx, rangedState, rangedPreview.preview);
    expect(findUnit(rangedAfter, 'def')!.facing).toEqual(rangedBeforeFacing);
  });

  it('advances the battle’s RNG stream', () => {
    const ctx = makeCtx();
    const state = meleeDuelState(ctx);
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const { state: after } = resolveAttack(ctx, state, preview.preview);
    expect(after.rng).not.toEqual(state.rng);
  });
});

describe('resolveAttack: deterministic outcomes under guaranteed hit / no crit', () => {
  const rules = rulesWithDamageOverrides(ALWAYS_HIT_NEVER_CRIT);

  it('a non-lethal blow deals exactly the min damage and draws a riposte that also always hits', () => {
    const ctx = makeCtx(10, 10, rules);
    const state = meleeDuelState(ctx);
    const soldierAttack = rules.units['soldier']!.attack!;
    const wallGuardAttack = rules.units['wallGuard']!.attack!;
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const expectedBlow = referenceDamage(rules, soldierAttack.power, soldierAttack.type, rules.units['wallGuard']!.armor);
    const expectedRiposte = referenceDamage(rules, wallGuardAttack.power, wallGuardAttack.type, rules.units['soldier']!.armor);

    const { state: after, events } = resolveAttack(ctx, state, preview.preview);
    const attacked = events.filter((e) => e.type === 'unitAttacked');
    expect(attacked).toHaveLength(2); // blow + riposte
    expect(attacked[0]).toMatchObject({ riposte: false, hit: true, crit: false, damage: expectedBlow.min });
    expect(attacked[1]).toMatchObject({ riposte: true, hit: true, crit: false, damage: expectedRiposte.min });
    expect(events.some((e) => e.type === 'unitDied')).toBe(false);

    const defHp = rules.units['wallGuard']!.hp - expectedBlow.min;
    const atkHp = rules.units['soldier']!.hp - expectedRiposte.min;
    expect(findUnit(after, 'def')!.hp).toBe(defHp);
    expect(findUnit(after, 'atk')!.hp).toBe(atkHp);
  });

  it('a lethal blow kills the target, skips the riposte, and ends the battle if it was the last defender', () => {
    const ctx = makeCtx(10, 10, rules);
    const state = meleeDuelState(ctx);
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const lowHp: BattleState = { ...state, units: state.units.map((u) => (u.id === 'def' ? { ...u, hp: preview.preview.blow.damage.min } : u)) };
    const { state: after, events } = resolveAttack(ctx, lowHp, preview.preview);
    expect(findUnit(after, 'def')!.hp).toBe(0);
    expect(findUnit(after, 'def')!.alive).toBe(false);
    const attacked = events.filter((e) => e.type === 'unitAttacked');
    expect(attacked).toHaveLength(1); // no riposte: the target died
    expect(events.filter((e) => e.type === 'unitDied')).toEqual([{ type: 'unitDied', unitId: 'def', byId: 'atk' }]);
    expect(events.filter((e) => e.type === 'battleEnded')).toEqual([{ type: 'battleEnded', status: 'attackerWon', reason: 'eliminated' }]);
    expect(after.status).toBe('attackerWon');
  });

  it('a riposte that kills the attacker ends the battle if it was the last attacker', () => {
    const ctx = makeCtx(10, 10, rules);
    const state = meleeDuelState(ctx);
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok || !preview.preview.riposte) return;
    const lowHp: BattleState = { ...state, units: state.units.map((u) => (u.id === 'atk' ? { ...u, hp: preview.preview.riposte!.damage.min } : u)) };
    const { state: after, events } = resolveAttack(ctx, lowHp, preview.preview);
    expect(findUnit(after, 'atk')!.hp).toBe(0);
    expect(events.filter((e) => e.type === 'unitDied')).toEqual([{ type: 'unitDied', unitId: 'atk', byId: 'def' }]);
    expect(events.filter((e) => e.type === 'battleEnded')).toEqual([{ type: 'battleEnded', status: 'defenderWon', reason: 'eliminated' }]);
  });

  it('a kill that breaks the last defender standing ends the battle: the garrison is put to flight', () => {
    const ctx = makeCtx(10, 10, rules);
    const M = rules.morale;
    // The survivor stands beside the victim, one ally's death away from running.
    const state = meleeDuelState(ctx, {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
        { id: 'last', typeKey: 'militia', position: centerOf(3, 1) },
      ],
    });
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const set: BattleState = {
      ...state,
      units: state.units.map((u) => (u.id === 'def' ? { ...u, hp: preview.preview.blow.damage.min } : u.id === 'last' ? { ...u, morale: M.fleeBelow + M.allyDeathLoss - 1 } : u)),
    };
    const { state: after, events } = resolveAttack(ctx, set, preview.preview);
    expect(findUnit(after, 'last')!.alive).toBe(true);
    expect(events.filter((e) => e.type === 'battleEnded')).toEqual([{ type: 'battleEnded', status: 'attackerWon', reason: 'routed' }]);
    expect(after.status).toBe('attackerWon');
  });

  it('a kill leaves the battle going while one defender still stands, even shaken', () => {
    const ctx = makeCtx(10, 10, rules);
    const M = rules.morale;
    const state = meleeDuelState(ctx, {
      units: [
        { id: 'atk', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'def', typeKey: 'wallGuard', position: centerOf(2, 1) },
        { id: 'last', typeKey: 'militia', position: centerOf(3, 1) },
      ],
    });
    const preview = previewAttack(ctx, state, 'atk', 'def');
    if (!preview.ok) throw new Error('no attack');
    const set: BattleState = {
      ...state,
      units: state.units.map((u) => (u.id === 'def' ? { ...u, hp: preview.preview.blow.damage.min } : u.id === 'last' ? { ...u, morale: M.fleeBelow + M.allyDeathLoss } : u)),
    };
    const { state: after, events } = resolveAttack(ctx, set, preview.preview);
    expect(after.status).toBe('ongoing');
    expect(events.some((e) => e.type === 'battleEnded')).toBe(false);
  });
});

describe('battleStatus: a side with no man standing (dead or fleeing) has lost, a garrison surrenders first', () => {
  const R = DEFAULT_RULES;
  const M = R.morale;
  const man = (id: string, faction: 'attacker' | 'defender', morale: number, alive = true) =>
    ({ id, typeKey: 'soldier', faction, position: vec2(0.5, 0.5), facing: vec2(0, 1), hp: alive ? 10 : 0, ap: 4, actions: 1, overwatch: null, morale, alive }) as const;
  /** A garrison of `men`, the first `standing` of them still up, the rest dead. */
  const garrison = (men: number, standing: number) => Array.from({ length: men }, (_, i) => man(`d${i}`, 'defender', 70, i < standing));

  it('goes on while both sides keep someone standing, shaken or steady', () => {
    expect(battleStatus(R, [man('a', 'attacker', M.fleeBelow), man('d', 'defender', M.max)])).toBe('ongoing');
  });

  it('is won by the side still standing when every survivor of the other runs', () => {
    expect(battleStatus(R, [man('a', 'attacker', 70), man('d1', 'defender', M.fleeBelow - 1), man('d2', 'defender', 70, false)])).toBe('attackerWon');
    expect(battleStatus(R, [man('a', 'attacker', 0), man('d', 'defender', 70)])).toBe('defenderWon');
  });

  it('ends when the garrison falls to its surrender line (men × share, rounded down), never for the attackers', () => {
    const men = 10;
    const line = Math.floor(men * R.battle.garrisonSurrenderShare + 1e-9);
    expect(line).toBeGreaterThan(0);
    expect(battleStatus(R, [man('a', 'attacker', 70), ...garrison(men, line + 1)])).toBe('ongoing');
    expect(battleStatus(R, [man('a', 'attacker', 70), ...garrison(men, line)])).toBe('attackerWon');
    // A garrison too small to surrender fights to its last man.
    expect(battleStatus(R, [man('a', 'attacker', 70), ...garrison(2, 1)])).toBe('ongoing');
    // One attacker left of many fights on.
    const army = Array.from({ length: men }, (_, i) => man(`a${i}`, 'attacker', 70, i === 0));
    expect(battleStatus(R, [...army, ...garrison(men, men)])).toBe('ongoing');
  });

  it('tells a rout, a surrender and a slaughter apart in the end it announces', () => {
    const routed: GameEvent[] = [];
    expect(statusAfterBlows(R, [man('a', 'attacker', 70), man('d', 'defender', 0)], routed)).toBe('attackerWon');
    expect(routed).toEqual([{ type: 'battleEnded', status: 'attackerWon', reason: 'routed' }]);
    const surrendered: GameEvent[] = [];
    statusAfterBlows(R, [man('a', 'attacker', 70), ...garrison(10, 1)], surrendered);
    expect(surrendered).toEqual([{ type: 'battleEnded', status: 'attackerWon', reason: 'surrendered' }]);
    const slain: GameEvent[] = [];
    statusAfterBlows(R, [man('a', 'attacker', 70), man('d', 'defender', 70, false)], slain);
    expect(slain).toEqual([{ type: 'battleEnded', status: 'attackerWon', reason: 'eliminated' }]);
    const none: GameEvent[] = [];
    expect(statusAfterBlows(R, [man('a', 'attacker', 70), man('d', 'defender', 70)], none)).toBe('ongoing');
    expect(none).toEqual([]);
  });

  it('counts the garrison standing against its surrender line', () => {
    expect(garrisonStrength(R, [man('a', 'attacker', 70), ...garrison(10, 4), man('f', 'defender', 0)])).toEqual({ standing: 4, men: 11, surrendersAt: Math.floor(11 * R.battle.garrisonSurrenderShare + 1e-9) });
  });
});

// ---------------------------------------------------------------------------------------------
// applyCommand: attack -- actions per turn, turn boundaries
// ---------------------------------------------------------------------------------------------

describe('applyCommand: attack — actions per turn', () => {
  it('a second attack in the same turn is rejected with noActionLeft', () => {
    const ctx = makeCtx();
    const state = meleeDuelState(ctx);
    const command: Command = { type: 'attack', unitId: 'atk', targetId: 'def' };
    const first = applyCommand(ctx, state, command);
    expect(first.rejection).toBeNull();
    const second = applyCommand(ctx, first.state, command);
    expect(second.rejection).toBe('noActionLeft');
    expect(second.state).toBe(first.state);
  });

  it('ending the turn restores actionsPerTurn (and AP) to the next faction’s living units', () => {
    const ctx = makeCtx();
    const state = meleeDuelState(ctx);
    const command: Command = { type: 'attack', unitId: 'atk', targetId: 'def' };
    const afterAttack = applyCommand(ctx, state, command);
    expect(afterAttack.rejection).toBeNull();
    const afterEndTurn = applyCommand(ctx, afterAttack.state, { type: 'endTurn' });
    expect(findUnit(afterEndTurn.state, 'def')!.actions).toBe(D.actionsPerTurn);
    // Full circle: back to the attacker's turn, its own actions are restored too.
    const afterEndTurn2 = applyCommand(ctx, afterEndTurn.state, { type: 'endTurn' });
    expect(findUnit(afterEndTurn2.state, 'atk')!.actions).toBe(D.actionsPerTurn);
  });
});

// ---------------------------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------------------------

describe('combat determinism', () => {
  function combatScenario(): Scenario {
    return {
      units: [
        { id: 'atk-soldier', typeKey: 'soldier', position: centerOf(1, 1) },
        { id: 'atk-archer', typeKey: 'archer', position: centerOf(1, 5) },
        { id: 'def-guard', typeKey: 'wallGuard', position: centerOf(2, 1) },
        { id: 'def-crossbow', typeKey: 'crossbowman', position: centerOf(8, 5) },
      ],
    };
  }

  function combatCommands(): Command[] {
    return [
      { type: 'attack', unitId: 'atk-soldier', targetId: 'def-guard' },
      { type: 'attack', unitId: 'atk-archer', targetId: 'def-crossbow' },
      { type: 'endTurn' },
      { type: 'attack', unitId: 'def-guard', targetId: 'atk-soldier' },
      { type: 'endTurn' },
      { type: 'attack', unitId: 'atk-soldier', targetId: 'def-guard' },
      { type: 'endTurn' },
      { type: 'attack', unitId: 'def-guard', targetId: 'atk-soldier' },
    ];
  }

  it('replaying the same seed + scenario + commands twice yields the same state hash and events', () => {
    const scenario = combatScenario();
    const commands = combatCommands();
    const a = replay(makeCtx(10, 10), SEED, scenario, commands);
    const b = replay(makeCtx(10, 10), SEED, scenario, commands);
    expect(hashBattleState(a.state)).toBe(hashBattleState(b.state));
    expect(hashValue(a.events)).toBe(hashValue(b.events));
  });

  it('a JSON round trip of the commands replays to the exact same hash', () => {
    const scenario = combatScenario();
    const commands = combatCommands();
    const original = replay(makeCtx(10, 10), SEED, scenario, commands);
    const roundTripped = JSON.parse(JSON.stringify(commands)) as Command[];
    const afterRoundTrip = replay(makeCtx(10, 10), SEED, scenario, roundTripped);
    expect(hashBattleState(afterRoundTrip.state)).toBe(hashBattleState(original.state));
  });

  it('produced at least one unitAttacked and one unitDied/battleEnded-free ongoing mix (the combat actually ran)', () => {
    const result = replay(makeCtx(10, 10), SEED, combatScenario(), combatCommands());
    expect(result.events.filter((e) => e.type === 'unitAttacked').length).toBeGreaterThan(0);
  });

  it('statistical: over many trials, the observed hit rate is close to the computed hitChance', () => {
    const ATTACK_TRIAL_COUNT = 2000;
    const HIT_RATE_TOLERANCE = 0.05;
    const ctx = makeCtx(10, 10);
    const scenario: Scenario = {
      units: [
        { id: 'atk', typeKey: 'archer', position: centerOf(0, 1) }, // ranged: no riposte
        { id: 'def', typeKey: 'wallGuard', position: centerOf(9, 1) }, // flat, no cover: hitChance == accuracy
      ],
    };
    let state = createBattle(ctx, SEEDS.combatStatistical, scenario);
    const preview = previewAttack(ctx, state, 'atk', 'def');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.blow.hitChance).toBeCloseTo(RULES.units['archer']!.attack!.accuracy, 10);
    expect(preview.preview.riposte).toBeNull();

    const targetFullHp = RULES.units['wallGuard']!.hp;
    let hits = 0;
    for (let i = 0; i < ATTACK_TRIAL_COUNT; i++) {
      const fresh: BattleState = { ...state, units: state.units.map((u) => (u.id === 'def' ? { ...u, hp: targetFullHp, alive: true } : u)) };
      const { state: after } = resolveAttack(ctx, fresh, preview.preview);
      if (findUnit(after, 'def')!.hp < targetFullHp) hits++;
      state = after; // carry the RNG stream forward
    }
    const observedRate = hits / ATTACK_TRIAL_COUNT;
    expect(observedRate).toBeGreaterThan(preview.preview.blow.hitChance - HIT_RATE_TOLERANCE);
    expect(observedRate).toBeLessThan(preview.preview.blow.hitChance + HIT_RATE_TOLERANCE);
  });
});
