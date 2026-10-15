/**
 * Combat (brief §9.7). The preview the player sees before committing an attack and the
 * resolution that rolls it are computed by the same functions: the odds shown are the odds
 * rolled.
 *
 *   hit    = accuracy + height bonus − cover − foliage   (clamped to [hitChanceMin, hitChanceMax])
 *   damage = power × (1 − armour reduction) × multiplier[type][armour] × (critical ? critMultiplier : 1)
 *
 * Height: ±accuracyPerHeightStep (and ±rangePerHeightStep of range) per whole heightStepM of
 * advantage, symmetric when shooting uphill. Cover applies to shots only: the target cell's own
 * cover, a hedge or dry-stone wall right in front of it on the shooter's side, and the foliage
 * the line of fire crosses. Melee blows are answered by one riposte when the target can fight
 * at contact.
 */
import type { CommandRejection } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import { distance, normalize, sub, type Vec2 } from '../math/vec2.ts';
import { lineOfSight } from '../nav-grid/line-of-sight.ts';
import { traverseSegment } from '../nav-grid/traverse.ts';
import { Rng } from '../rng.ts';
import { COVER_LEVELS, type ArmorClass, type CoverLevel, type GameRules, type MoraleRules, type UnitAttackRule, type UnitTypeRule } from '../rules/types.ts';
import { sampleHeight } from '../terrain-data/terrain-data.ts';
import { conditionedRange, meleeConditions, shotConditions, type ShotModifier } from './conditions.ts';
import { deckAt, type BattleContext } from './context.ts';
import { moraleAfterBlows, moraleStanding, type BlowOutcome } from './morale.ts';
import { syncNav } from './structures.ts';
import { findUnit, unitType } from './movement.ts';
import type { BattleState, BattleStatus, UnitState } from './types.ts';

/** Units whose shots arc over obstacles: no line of sight needed, and no height modifier. */
export const INDIRECT_FIRE_TAG = 'indirectFire';

export interface DamageRange {
  /** A normal hit. */
  readonly min: number;
  /** A critical hit. */
  readonly max: number;
}

export interface BlowOdds {
  readonly hitChance: number;
  readonly critChance: number;
  readonly damage: DamageRange;
}

export interface AttackPreview {
  readonly attackerId: string;
  readonly targetId: string;
  readonly melee: boolean;
  readonly distanceM: number;
  /** Range after the height modifier (melee: reach). */
  readonly effectiveRangeM: number;
  /** Whole height steps of advantage (negative when the target stands higher). */
  readonly heightSteps: number;
  readonly cover: CoverLevel;
  /** Foliage crossed by the line of fire, 0–1. */
  readonly obscurance: number;
  readonly apCost: number;
  readonly blow: BlowOdds;
  /** The target's answer to a melee blow, when it can fight at contact. */
  readonly riposte: BlowOdds | null;
  /** Weather, night and wind modifiers of a shot (none in melee). */
  readonly conditions: readonly ShotModifier[];
}

export type AttackPreviewResult = { readonly ok: true; readonly preview: AttackPreview } | { readonly ok: false; readonly reason: CommandRejection };

export interface AttackResolution {
  readonly state: BattleState;
  readonly events: readonly GameEvent[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Height a unit stands at: the relief plus the deck it is on (wall-walk, tower top). */
function standHeight(ctx: BattleContext, p: Vec2): number {
  return sampleHeight(ctx.terrain, p.x, p.z) + deckAt(ctx, p);
}

/** Whole steps of height advantage of `from` over `to`, truncated towards zero. */
export function heightSteps(ctx: BattleContext, from: Vec2, to: Vec2): number {
  return Math.trunc((standHeight(ctx, from) - standHeight(ctx, to)) / ctx.rules.damage.heightStepM);
}

/**
 * Cover of `target` against a shot from `shooter`: its own cell, or a directional obstacle
 * (hedge, dry-stone wall) within reach in front of it, whichever protects more.
 */
export function coverAgainst(ctx: BattleContext, shooter: Vec2, target: Vec2): CoverLevel {
  const nav = ctx.nav;
  const cs = nav.cellSize;
  const tcx = Math.floor(target.x / cs);
  const tcz = Math.floor(target.z / cs);
  let best = nav.cover[tcz * nav.width + tcx] as number;
  const lengthM = distance(shooter, target);
  if (lengthM > 0) {
    const reach = ctx.rules.damage.directionalCoverReachM;
    traverseSegment(nav, target.x, target.z, shooter.x, shooter.z, (cx, cz, t0) => {
      if (t0 * lengthM > reach) return false;
      if (cx === tcx && cz === tcz) return true;
      if (cx < 0 || cz < 0 || cx >= nav.width || cz >= nav.depth) return false;
      const i = cz * nav.width + cx;
      if (nav.directionalCover[i]) best = Math.max(best, nav.cover[i] as number);
      return true;
    });
  }
  return COVER_LEVELS[best] as CoverLevel;
}

export function blowOdds(ctx: BattleContext, attack: UnitAttackRule, target: UnitTypeRule, accuracyFactor: number, steps: number, cover: CoverLevel, obscurance: number, conditionsAccuracy = 0): BlowOdds {
  return oddsAgainst(ctx, attack, target.armor, accuracyFactor, steps, cover, obscurance, conditionsAccuracy);
}

/** Odds of a blow against `armor` (a unit's armour or a structure's material). */
export function oddsAgainst(
  ctx: BattleContext,
  attack: UnitAttackRule,
  armor: ArmorClass,
  accuracyFactor: number,
  steps: number,
  cover: CoverLevel,
  obscurance: number,
  hitBonus: number,
  mods: { readonly armorPierce: boolean; readonly damageFactor: number } = { armorPierce: false, damageFactor: 1 },
): BlowOdds {
  const d = ctx.rules.damage;
  const hitChance = clamp(
    attack.accuracy * accuracyFactor + hitBonus + steps * d.accuracyPerHeightStep - d.coverPenalty[cover] - obscurance * d.obscurancePenalty,
    d.hitChanceMin,
    d.hitChanceMax,
  );
  const base = attack.power * (1 - (mods.armorPierce ? 0 : d.armorReduction[armor])) * d.multipliers[attack.type][armor] * mods.damageFactor;
  return {
    hitChance,
    critChance: d.critChance,
    damage: { min: Math.max(d.minDamageOnHit, Math.round(base)), max: Math.max(d.minDamageOnHit, Math.round(base * d.critMultiplier)) },
  };
}

/** A hero's blow (J5): what it ignores and adds to an ordinary attack. */
export interface AttackOptions {
  /** Cover counts for nothing (piercing shot). */
  readonly ignoreCover?: boolean;
  /** The target's armour reduces nothing. */
  readonly armorPierce?: boolean;
  readonly accuracyBonus?: number;
  readonly damageFactor?: number;
  /** The target cannot answer (heroic charge). */
  readonly noRiposte?: boolean;
  /** AP on top of the attack's. */
  readonly extraAp?: number;
}

export function previewAttack(ctx: BattleContext, state: BattleState, attackerId: string, targetId: string, options: AttackOptions = {}): AttackPreviewResult {
  syncNav(ctx, state.structures, state.works);
  const attacker = findUnit(state, attackerId);
  if (!attacker) return { ok: false, reason: 'unknownUnit' };
  if (!attacker.alive) return { ok: false, reason: 'unitDead' };
  if (attacker.faction !== state.activeFaction) return { ok: false, reason: 'notYourTurn' };
  const target = findUnit(state, targetId);
  if (!target) return { ok: false, reason: 'unknownTarget' };
  if (!target.alive) return { ok: false, reason: 'targetDead' };
  if (target.faction === attacker.faction) return { ok: false, reason: 'targetFriendly' };
  const aType = unitType(ctx, attacker);
  const tType = unitType(ctx, target);
  const attack = aType.attack;
  if (!attack) return { ok: false, reason: 'noAttack' };
  if (attacker.actions <= 0) return { ok: false, reason: 'noActionLeft' };
  const d = ctx.rules.damage;
  const apCost = d.attackApCost + (options.extraAp ?? 0);
  if (attacker.ap < apCost) return { ok: false, reason: 'insufficientAp' };

  const melee = attack.rangeM === 0;
  const indirect = aType.tags.includes(INDIRECT_FIRE_TAG);
  const distanceM = distance(attacker.position, target.position);
  const steps = indirect ? 0 : heightSteps(ctx, attacker.position, target.position);
  const conditions = melee ? meleeConditions(state, attacker) : shotConditions(ctx, state, attacker.position, target.position, indirect, attacker);
  const effectiveRangeM = melee ? d.meleeReachM : conditionedRange(attack.rangeM * Math.max(0, 1 + steps * d.rangePerHeightStep), conditions);
  if (distanceM > effectiveRangeM) return { ok: false, reason: 'outOfRange' };

  let cover: CoverLevel = 'none';
  let obscurance = 0;
  if (!melee) {
    cover = options.ignoreCover ? 'none' : coverAgainst(ctx, attacker.position, target.position);
    if (!indirect) {
      const sight = lineOfSight(ctx.nav, {
        from: attacker.position,
        to: target.position,
        eyeHeightM: ctx.rules.movement.eyeHeightM,
        targetHeightM: ctx.rules.movement.targetHeightM,
        fromElevationM: deckAt(ctx, attacker.position),
        toElevationM: deckAt(ctx, target.position),
      });
      if (!sight.visible) return { ok: false, reason: 'noLineOfSight' };
      obscurance = sight.obscurance;
    }
  }
  const blow = oddsAgainst(ctx, attack, tType.armor, 1, steps, cover, obscurance, conditions.accuracy + (options.accuracyBonus ?? 0), { armorPierce: options.armorPierce ?? false, damageFactor: options.damageFactor ?? 1 });
  const answer = tType.attack;
  const riposte = melee && !options.noRiposte && answer && answer.rangeM === 0 ? blowOdds(ctx, answer, aType, d.riposteAccuracyFactor, -steps, 'none', 0) : null;
  return {
    ok: true,
    preview: { attackerId, targetId, melee, distanceM, effectiveRangeM, heightSteps: steps, cover, obscurance, apCost, blow, riposte, conditions: conditions.modifiers },
  };
}

export interface Roll {
  readonly hit: boolean;
  readonly crit: boolean;
  readonly damage: number;
}

export function rollBlow(rng: Rng, odds: BlowOdds): Roll {
  const hit = rng.next() < odds.hitChance;
  const crit = hit && rng.next() < odds.critChance;
  return { hit, crit, damage: hit ? (crit ? odds.damage.max : odds.damage.min) : 0 };
}

export function faceTowards(from: Vec2, to: Vec2, fallback: Vec2): Vec2 {
  const dir = normalize(sub(to, from));
  return dir.x === 0 && dir.z === 0 ? fallback : dir;
}

/** Still in the fight: alive and not fleeing (a side put to flight has lost, brief §9.7). */
function standing(rules: MoraleRules, u: UnitState): boolean {
  return u.alive && moraleStanding(rules, u.morale) !== 'fleeing';
}

/** Rounding slack of the surrender line (0.3 × 10 is 3.0000000000000004). */
const SURRENDER_EPSILON = 1e-9;

/**
 * The count of men standing at which a garrison of `men` surrenders (J7): its men times the
 * surrender share, rounded down (0 for a garrison too small to surrender).
 */
export function surrenderLine(rules: Pick<GameRules, 'battle'>, men: number): number {
  return Math.floor(men * rules.battle.garrisonSurrenderShare + SURRENDER_EPSILON);
}

/** The garrison's men still standing, and the count at which it surrenders. */
export function garrisonStrength(rules: Pick<GameRules, 'morale' | 'battle'>, units: readonly UnitState[]): { readonly standing: number; readonly men: number; readonly surrendersAt: number } {
  const men = units.filter((u) => u.faction === 'defender');
  return { standing: men.filter((u) => standing(rules.morale, u)).length, men: men.length, surrendersAt: surrenderLine(rules, men.length) };
}

/**
 * A side has lost when none of its men still stands (dead or fleeing); a garrison surrenders
 * earlier, down to its surrender line.
 */
export function battleStatus(rules: Pick<GameRules, 'morale' | 'battle'>, units: readonly UnitState[]): BattleStatus {
  const attackers = units.some((u) => u.faction === 'attacker' && standing(rules.morale, u));
  const garrison = garrisonStrength(rules, units);
  const defenders = garrison.standing > garrison.surrendersAt;
  if (attackers && defenders) return 'ongoing';
  return attackers ? 'attackerWon' : 'defenderWon';
}

/**
 * The battle's status after blows, its end announced: the losers all fallen, the last of them
 * broken and running, or the garrison laying down its arms.
 */
export function statusAfterBlows(rules: Pick<GameRules, 'morale' | 'battle'>, units: readonly UnitState[], events: GameEvent[]): BattleStatus {
  const status = battleStatus(rules, units);
  if (status !== 'ongoing') {
    const losers = units.filter((u) => u.alive && u.faction === (status === 'attackerWon' ? 'defender' : 'attacker'));
    const reason = losers.length === 0 ? 'eliminated' : losers.every((u) => !standing(rules.morale, u)) ? 'routed' : 'surrendered';
    events.push({ type: 'battleEnded', status, reason });
  }
  return status;
}

/** Rolls a previewed attack (and its riposte) against the battle's RNG stream. */
export function resolveAttack(ctx: BattleContext, state: BattleState, preview: AttackPreview): AttackResolution {
  const rng = Rng.fromState(state.rng);
  const attacker = findUnit(state, preview.attackerId) as UnitState;
  const target = findUnit(state, preview.targetId) as UnitState;
  const events: GameEvent[] = [];
  const blows: BlowOutcome[] = [];

  const blow = rollBlow(rng, preview.blow);
  const targetHp = Math.max(0, target.hp - blow.damage);
  events.push({ type: 'unitAttacked', attackerId: attacker.id, targetId: target.id, riposte: false, hitChance: preview.blow.hitChance, hit: blow.hit, crit: blow.crit, damage: blow.damage, hpAfter: targetHp });
  if (targetHp === 0) events.push({ type: 'unitDied', unitId: target.id, byId: attacker.id });
  blows.push({ attackerId: attacker.id, targetId: target.id, hpBefore: target.hp, hpAfter: targetHp });

  let attackerHp = attacker.hp;
  if (targetHp > 0 && preview.riposte) {
    const answer = rollBlow(rng, preview.riposte);
    attackerHp = Math.max(0, attacker.hp - answer.damage);
    events.push({ type: 'unitAttacked', attackerId: target.id, targetId: attacker.id, riposte: true, hitChance: preview.riposte.hitChance, hit: answer.hit, crit: answer.crit, damage: answer.damage, hpAfter: attackerHp });
    if (attackerHp === 0) events.push({ type: 'unitDied', unitId: attacker.id, byId: target.id });
    blows.push({ attackerId: target.id, targetId: attacker.id, hpBefore: attacker.hp, hpAfter: attackerHp });
  }

  const updatedAttacker: UnitState = {
    ...attacker,
    hp: attackerHp,
    alive: attackerHp > 0,
    ap: attacker.ap - preview.apCost,
    actions: attacker.actions - 1,
    facing: faceTowards(attacker.position, target.position, attacker.facing),
  };
  const updatedTarget: UnitState = {
    ...target,
    hp: targetHp,
    alive: targetHp > 0,
    facing: preview.melee ? faceTowards(target.position, attacker.position, target.facing) : target.facing,
  };
  const struck = state.units.map((u) => (u.id === attacker.id ? updatedAttacker : u.id === target.id ? updatedTarget : u));
  const units = moraleAfterBlows(ctx, struck, blows, events);
  const status = statusAfterBlows(ctx.rules, units, events);
  return { state: { ...state, units, status, rng: rng.getState() }, events };
}
