/**
 * Heroes (J5, brief §9.5): Aude the archery captain, Bertrand the master engineer, Guillaume the
 * veteran knight. Each has two active abilities, each with a cooldown counted in its side's
 * turns, and one passive aura:
 * - volley: she and the shooters around her shoot better until the end of the turn;
 *   piercingShot: a shot that ignores cover and armour; eagleEye: shooters near her, better.
 * - calibrate: an engine near him shoots better and the wind no longer deflects it, until the
 *   end of the turn; rushWorks: a turn of work counts double; masterBuilder: engines near him,
 *   better.
 * - rally: morale back to the men around him; heroicCharge: a stronger blow, no riposte;
 *   steadfast: the men around him lose half the morale.
 * A hero at 0 HP is gravely wounded: out of the battle (and of the next one, J6), never dead.
 */
import type { Command, CommandRejection } from '../commands/types.ts';
import type { GameEvent } from '../events/types.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import type { HeroAbilityRule, HeroRule } from '../rules/types.ts';
import { previewAttack, resolveAttack, type AttackPreview } from './combat.ts';
import type { BattleContext } from './context.ts';
import { moraleShift } from './morale.ts';
export { tickCooldowns } from './morale.ts';
import { findUnit } from './movement.ts';
import { isEngine, isShooter } from './hero-auras.ts';
import { previewFill, previewUndermine, resolveWork, type WorkPreview } from './siege-works.ts';
import type { BattleState, UnitBuff, UnitState } from './types.ts';

export { HERO_TAG } from './tags.ts';

export type AbilityCommand = Extract<Command, { type: 'ability' }>;

export type AbilityPreview =
  | { readonly kind: 'buff'; readonly unitId: string; readonly ability: HeroAbilityRule; readonly affected: readonly string[] }
  | { readonly kind: 'rally'; readonly unitId: string; readonly ability: HeroAbilityRule; readonly affected: readonly string[] }
  | { readonly kind: 'attack'; readonly unitId: string; readonly ability: HeroAbilityRule; readonly attack: AttackPreview }
  | { readonly kind: 'work'; readonly unitId: string; readonly ability: HeroAbilityRule; readonly work: WorkPreview };

export type AbilityPreviewResult = { readonly ok: true; readonly preview: AbilityPreview } | { readonly ok: false; readonly reason: CommandRejection };

export function heroOf(ctx: BattleContext, unit: UnitState): HeroRule | null {
  return ctx.rules.heroes[unit.typeKey] ?? null;
}

/** Turns left before the ability can be used again (0: ready). */
export function cooldownOf(unit: UnitState, abilityId: string): number {
  return unit.cooldowns?.[abilityId] ?? 0;
}

export function previewAbility(ctx: BattleContext, state: BattleState, command: AbilityCommand): AbilityPreviewResult {
  const unit = findUnit(state, command.unitId);
  if (!unit) return { ok: false, reason: 'unknownUnit' };
  if (!unit.alive) return { ok: false, reason: 'unitDead' };
  if (unit.faction !== state.activeFaction) return { ok: false, reason: 'notYourTurn' };
  const hero = heroOf(ctx, unit);
  if (!hero) return { ok: false, reason: 'notAHero' };
  const ability = hero.abilities.find((a) => a.id === command.abilityId);
  if (!ability) return { ok: false, reason: 'unknownAbility' };
  if (cooldownOf(unit, ability.id) > 0) return { ok: false, reason: 'abilityCooling' };
  switch (ability.id) {
    case 'volley': {
      if (unit.ap < ability.apCost) return { ok: false, reason: 'insufficientAp' };
      const affected = state.units.filter((u) => u.alive && u.faction === unit.faction && (u.id === unit.id || isShooter(ctx, u)) && distance(u.position, unit.position) <= ability.radiusM).map((u) => u.id);
      return { ok: true, preview: { kind: 'buff', unitId: unit.id, ability, affected } };
    }
    case 'calibrate': {
      if (unit.ap < ability.apCost) return { ok: false, reason: 'insufficientAp' };
      const target = command.targetId ? findUnit(state, command.targetId) : undefined;
      if (!target || !target.alive || target.faction !== unit.faction || !isEngine(ctx, target)) return { ok: false, reason: 'invalidAbilityTarget' };
      if (distance(target.position, unit.position) > ability.radiusM) return { ok: false, reason: 'outOfRange' };
      return { ok: true, preview: { kind: 'buff', unitId: unit.id, ability, affected: [target.id] } };
    }
    case 'rally': {
      if (unit.ap < ability.apCost) return { ok: false, reason: 'insufficientAp' };
      const affected = state.units.filter((u) => u.alive && u.faction === unit.faction && distance(u.position, unit.position) <= ability.radiusM).map((u) => u.id);
      return { ok: true, preview: { kind: 'rally', unitId: unit.id, ability, affected } };
    }
    case 'piercingShot':
    case 'heroicCharge': {
      if (!command.targetId) return { ok: false, reason: 'invalidAbilityTarget' };
      const pierce = ability.id === 'piercingShot';
      const r = previewAttack(ctx, state, unit.id, command.targetId, {
        ignoreCover: pierce,
        armorPierce: pierce,
        accuracyBonus: ability.accuracyBonus,
        damageFactor: ability.damageFactor,
        noRiposte: !pierce,
        extraAp: ability.apCost,
      });
      if (!r.ok) return r;
      return { ok: true, preview: { kind: 'attack', unitId: unit.id, ability, attack: r.preview } };
    }
    case 'rushWorks': {
      const r = command.structureId ? previewUndermine(ctx, state, unit.id, command.structureId) : command.at ? previewFill(ctx, state, unit.id, command.at) : null;
      if (!r) return { ok: false, reason: 'invalidAbilityTarget' };
      if (!r.ok) return r;
      return { ok: true, preview: { kind: 'work', unitId: unit.id, ability, work: r.preview } };
    }
  }
}

function withCooldown(state: BattleState, unitId: string, ability: HeroAbilityRule, apCost: number): BattleState {
  return {
    ...state,
    units: state.units.map((u) => (u.id === unitId ? { ...u, ap: Math.max(0, u.ap - apCost), cooldowns: { ...u.cooldowns, [ability.id]: ability.cooldown } } : u)),
  };
}

export function resolveAbility(ctx: BattleContext, state: BattleState, preview: AbilityPreview): { state: BattleState; events: GameEvent[] } {
  const { ability, unitId } = preview;
  const events: GameEvent[] = [];
  switch (preview.kind) {
    case 'buff': {
      events.push({ type: 'abilityUsed', unitId, abilityId: ability.id, affected: preview.affected });
      const buff: UnitBuff = { source: ability.id, accuracy: ability.accuracyBonus, windImmune: ability.id === 'calibrate' };
      const buffed = { ...state, units: state.units.map((u) => (preview.affected.includes(u.id) ? { ...u, buffs: [...(u.buffs ?? []).filter((b) => b.source !== ability.id), buff] } : u)) };
      return { state: withCooldown(buffed, unitId, ability, ability.apCost), events };
    }
    case 'rally': {
      events.push({ type: 'abilityUsed', unitId, abilityId: ability.id, affected: preview.affected });
      const rallied = { ...state, units: state.units.map((u) => (preview.affected.includes(u.id) ? moraleShift(ctx.rules.morale, u, ability.moraleGain, 'rally', events) : u)) };
      return { state: withCooldown(rallied, unitId, ability, ability.apCost), events };
    }
    case 'attack': {
      events.push({ type: 'abilityUsed', unitId, abilityId: ability.id, affected: [preview.attack.targetId] });
      const r = resolveAttack(ctx, state, preview.attack);
      return { state: withCooldown(r.state, unitId, ability, 0), events: [...events, ...r.events] };
    }
    case 'work': {
      events.push({ type: 'abilityUsed', unitId, abilityId: ability.id, affected: [] });
      let current = state;
      let progress = preview.work.progress;
      for (let k = 0; k < ability.workFactor && progress < preview.work.required; k++, progress++) {
        const r = resolveWork(ctx, current, { ...preview.work, progress });
        current = r.state;
        events.push(...r.events);
        if (current.status !== 'ongoing') break;
      }
      return { state: withCooldown(current, unitId, ability, 0), events };
    }
  }
}

/** End of a side's turn: its units' buffs expire. */
export function expireBuffs(state: BattleState, faction: UnitState['faction']): BattleState {
  if (!state.units.some((u) => u.faction === faction && u.buffs)) return state;
  return { ...state, units: state.units.map((u) => (u.faction === faction && u.buffs ? withoutBuffs(u) : u)) };
}

function withoutBuffs(u: UnitState): UnitState {
  const { buffs: _gone, ...rest } = u;
  return rest;
}

/** Heroes join the army: each on the free cell nearest to the attackers' centre (deterministic). */
export function heroSpawnCells(centre: Vec2, isFree: (p: Vec2) => boolean, count: number, maxRadiusM = 30): Vec2[] {
  const out: Vec2[] = [];
  const cx = Math.floor(centre.x);
  const cz = Math.floor(centre.z);
  for (let r = 0; r <= maxRadiusM && out.length < count; r++) {
    for (let dz = -r; dz <= r && out.length < count; dz++) {
      for (let dx = -r; dx <= r && out.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const p = { x: cx + dx + 0.5, z: cz + dz + 0.5 };
        if (!isFree(p) || out.some((q) => distance(q, p) < 2)) continue;
        out.push(p);
      }
    }
  }
  return out;
}
