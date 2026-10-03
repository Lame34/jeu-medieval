/**
 * The heroes' passive auras (J5, brief §9.5), read by the shot modifiers and by morale: eagleEye
 * (shooters near Aude shoot better), masterBuilder (engines near Bertrand, likewise), steadfast
 * (the men near Guillaume lose half the morale). A light module: no battle logic imported.
 */
import { distance } from '../math/vec2.ts';
import type { HeroPassiveId } from '../rules/types.ts';
import type { BattleContext } from './context.ts';
import { SIEGE_ENGINE_TAG } from './tags.ts';
import type { UnitState } from './types.ts';

export function isEngine(ctx: BattleContext, u: UnitState): boolean {
  return ctx.rules.units[u.typeKey]?.tags.includes(SIEGE_ENGINE_TAG) ?? false;
}

/** A unit that shoots (a ranged attack), engines aside. */
export function isShooter(ctx: BattleContext, u: UnitState): boolean {
  const attack = ctx.rules.units[u.typeKey]?.attack;
  return Boolean(attack && attack.rangeM > 0) && !isEngine(ctx, u);
}

export interface Aura {
  readonly hero: UnitState;
  readonly radiusM: number;
  readonly accuracyBonus: number;
  readonly moraleLossFactor: number;
}

/** Friendly heroes with passive \`id\` whose aura covers \`unit\`. */
export function aurasOn(ctx: BattleContext, units: readonly UnitState[], unit: UnitState, id: HeroPassiveId): Aura[] {
  const out: Aura[] = [];
  for (const h of units) {
    if (!h.alive || h.faction !== unit.faction) continue;
    const rule = ctx.rules.heroes[h.typeKey];
    if (!rule || rule.passive.id !== id) continue;
    if (distance(h.position, unit.position) <= rule.passive.radiusM) out.push({ hero: h, radiusM: rule.passive.radiusM, accuracyBonus: rule.passive.accuracyBonus, moraleLossFactor: rule.passive.moraleLossFactor });
  }
  return out;
}

/** The aura raising a shooter's accuracy, if any: eagleEye for shooters, masterBuilder for engines. */
export function auraAccuracy(ctx: BattleContext, units: readonly UnitState[], shooter: UnitState): { readonly id: HeroPassiveId; readonly accuracy: number } | null {
  const kind: HeroPassiveId | null = isEngine(ctx, shooter) ? 'masterBuilder' : isShooter(ctx, shooter) ? 'eagleEye' : null;
  if (!kind) return null;
  const best = aurasOn(ctx, units, shooter, kind).reduce((m, a) => Math.max(m, a.accuracyBonus), 0);
  return best > 0 ? { id: kind, accuracy: best } : null;
}

/** Factor on the morale a unit loses (steadfast nearby halves it). */
export function moraleLossFactor(ctx: BattleContext, units: readonly UnitState[], unit: UnitState): number {
  return aurasOn(ctx, units, unit, 'steadfast').reduce((m, a) => Math.min(m, a.moraleLossFactor), 1);
}
