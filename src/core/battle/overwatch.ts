/**
 * Overwatch (brief §9.2, « garde ») and threat exposure. A ranged unit gives up its action to
 * watch a cone; during the enemy's turn the first enemy that enters it — within range, in sight —
 * draws one reaction shot, rolled mid-move. The mover carries on if it survives. Moves are cut
 * into segments around each shot so the renderer plays them in order.
 */
import type { GameEvent } from '../events/types.ts';
import { distance, dot, normalize, sub, type Vec2 } from '../math/vec2.ts';
import { lineOfSight } from '../nav-grid/line-of-sight.ts';
import { Rng } from '../rng.ts';
import { deckAt, type BattleContext } from './context.ts';
import { battleStatus, blowOdds, coverAgainst, faceTowards, heightSteps, rollBlow, type BlowOdds } from './combat.ts';
import { snapToCellCenter } from './create.ts';
import { moraleAfterBlows, type BlowOutcome } from './morale.ts';
import { unitType, type MovePlan } from './movement.ts';
import { syncNav } from './structures.ts';
import type { BattleState, UnitState } from './types.ts';

const INDIRECT_FIRE_TAG = 'indirectFire';

/** Can this unit watch a cone (a direct-fire ranged attack)? */
export function canOverwatch(ctx: BattleContext, unit: UnitState): boolean {
  const type = unitType(ctx, unit);
  return Boolean(type.attack && type.attack.rangeM > 0 && !type.tags.includes(INDIRECT_FIRE_TAG));
}

/**
 * Odds of a shot from `shooter` at an enemy of `targetUnit`'s type standing at `at`, or null when
 * out of range or out of sight. `accuracyFactor` < 1 for reaction shots.
 */
export function shotOddsAt(ctx: BattleContext, shooter: UnitState, targetUnit: UnitState, at: Vec2, accuracyFactor: number): BlowOdds | null {
  const attack = unitType(ctx, shooter).attack;
  if (!attack || attack.rangeM === 0) return null;
  const d = ctx.rules.damage;
  const steps = heightSteps(ctx, shooter.position, at);
  if (distance(shooter.position, at) > attack.rangeM * Math.max(0, 1 + steps * d.rangePerHeightStep)) return null;
  const sight = lineOfSight(ctx.nav, {
    from: shooter.position,
    to: at,
    eyeHeightM: ctx.rules.movement.eyeHeightM,
    targetHeightM: ctx.rules.movement.targetHeightM,
    fromElevationM: deckAt(ctx, shooter.position),
    toElevationM: deckAt(ctx, at),
  });
  if (!sight.visible) return null;
  return blowOdds(ctx, attack, unitType(ctx, targetUnit), accuracyFactor, steps, coverAgainst(ctx, shooter.position, at), sight.obscurance);
}

export interface Threat {
  readonly enemyId: string;
  readonly hitChance: number;
}

/** Enemy shooters that could fire at `unit` if it stood at `at` (the preview's exposure line). */
export function threatsAt(ctx: BattleContext, state: BattleState, unit: UnitState, at: Vec2): Threat[] {
  syncNav(ctx, state.structures);
  const threats: Threat[] = [];
  for (const enemy of state.units) {
    if (!enemy.alive || enemy.faction === unit.faction) continue;
    const odds = shotOddsAt(ctx, enemy, unit, at, 1);
    if (odds) threats.push({ enemyId: enemy.id, hitChance: odds.hitChance });
  }
  return threats;
}

function inCone(ctx: BattleContext, watcher: UnitState, at: Vec2): boolean {
  if (!watcher.overwatch) return false;
  const toTarget = normalize(sub(at, watcher.position));
  return dot(toTarget, watcher.overwatch) >= Math.cos((ctx.rules.damage.overwatchHalfAngleDeg * Math.PI) / 180);
}

/** Points every `step` metres along a polyline, the end point included, the start excluded. */
function samplePath(path: readonly Vec2[], step: number): { p: Vec2; segment: number }[] {
  const out: { p: Vec2; segment: number }[] = [];
  let carry = step;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i] as Vec2;
    const b = path[i + 1] as Vec2;
    const len = distance(a, b);
    let s = carry;
    while (s <= len) {
      const t = s / len;
      out.push({ p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, segment: i });
      s += step;
    }
    carry = s - len;
  }
  const last = path[path.length - 1];
  if (last && (out.length === 0 || distance((out[out.length - 1] as { p: Vec2 }).p, last) > 1e-6)) out.push({ p: last, segment: path.length - 2 });
  return out;
}

/**
 * Executes a planned move through the enemy's overwatch cones. Returns the new state and the
 * events: move segments interleaved with reaction shots (and their consequences).
 */
export function moveThroughOverwatch(ctx: BattleContext, state: BattleState, mover: UnitState, plan: MovePlan): { state: BattleState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const watchers = state.units.filter((u) => u.alive && u.faction !== mover.faction && u.overwatch).map((u) => u.id);
  let units = [...state.units];
  let rng: Rng | null = null;
  let segmentStart = 0;
  let from: Vec2 = mover.position;
  let apSpent = plan.apSpent;
  let apCost = plan.apCost;
  let current = mover;
  const pushSegment = (upTo: Vec2, segment: number) => {
    const path = [from, ...plan.path.slice(segmentStart + 1, segment + 1), upTo];
    events.push({ type: 'unitMoved', unitId: mover.id, path, apCost, apSpent });
    apCost = 0;
    apSpent = 0;
    from = upTo;
    segmentStart = segment;
  };

  if (watchers.length > 0) {
    for (const sample of samplePath(plan.path, ctx.rules.damage.overwatchSampleM)) {
      for (const id of watchers) {
        const watcher = units.find((u) => u.id === id) as UnitState;
        if (!watcher.alive || !watcher.overwatch || !inCone(ctx, watcher, sample.p)) continue;
        const odds = shotOddsAt(ctx, watcher, current, sample.p, ctx.rules.damage.overwatchAccuracyFactor);
        if (!odds) continue;
        pushSegment(sample.p, sample.segment);
        rng ??= Rng.fromState(state.rng);
        const shot = rollBlow(rng, odds);
        const hpAfter = Math.max(0, current.hp - shot.damage);
        events.push({ type: 'unitAttacked', attackerId: watcher.id, targetId: mover.id, riposte: false, reaction: true, hitChance: odds.hitChance, hit: shot.hit, crit: shot.crit, damage: shot.damage, hpAfter });
        const blows: BlowOutcome[] = [{ attackerId: watcher.id, targetId: mover.id, hpBefore: current.hp, hpAfter }];
        current = { ...current, hp: hpAfter, alive: hpAfter > 0, position: hpAfter > 0 ? current.position : snapToCellCenter(ctx, sample.p) };
        units = units.map((u) => (u.id === mover.id ? current : u.id === watcher.id ? { ...watcher, overwatch: null, facing: faceTowards(watcher.position, sample.p, watcher.facing) } : u));
        if (hpAfter === 0) events.push({ type: 'unitDied', unitId: mover.id, byId: watcher.id });
        units = moraleAfterBlows(ctx, units, blows, events);
        current = units.find((u) => u.id === mover.id) as UnitState;
        if (!current.alive) break;
      }
      if (!current.alive) break;
    }
  }

  if (current.alive) {
    const last = plan.path[plan.path.length - 1] as Vec2;
    if (distance(from, last) > 1e-6 || events.length === 0) pushSegment(last, plan.path.length - 2);
    const beforeLast = plan.path[plan.path.length - 2] ?? mover.position;
    current = { ...current, position: plan.destination, facing: faceTowards(beforeLast, last, mover.facing) };
  }
  current = { ...current, ap: mover.ap - plan.apSpent };
  units = units.map((u) => (u.id === mover.id ? current : u));
  // Only a death can end the battle (a scenario may start with one side absent).
  const status = current.alive ? state.status : battleStatus(units);
  if (status !== 'ongoing') events.push({ type: 'battleEnded', status });
  return { state: { ...state, units, status, rng: rng ? rng.getState() : state.rng }, events };
}
