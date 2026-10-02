/**
 * Siege engines against the castle (J4, brief §9.8). Rams batter the gate, then the portcullis
 * behind it, at contact; catapults lob stones onto walls and gates (indirect fire: no line of
 * sight, no height modifier). The preview and the roll share the same odds, as for unit attacks:
 *
 *   hit    = accuracy + structure hit bonus                                   (clamped)
 *   damage = power × (1 − reduction[material]) × multiplier[type][material] × (critical ? crit : 1)
 *
 * A raised drawbridge shields its gate, an intact gate its portcullis. A breached wall segment
 * throws down the units on its wall-walk and shakes the defenders around it; a drawbridge drops
 * when its winch operator dies, whatever killed them.
 */
import type { CommandRejection } from '../commands/types.ts';
import type { FallenUnit, GameEvent } from '../events/types.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import { Rng } from '../rng.ts';
import type { BattleContext } from './context.ts';
import { battleStatus, faceTowards, INDIRECT_FIRE_TAG, oddsAgainst, rollBlow, type BlowOdds } from './combat.ts';
import { cellIndexOf } from './create.ts';
import { moraleAfterBlows, moraleAfterCollapse, type BlowOutcome } from './morale.ts';
import { findUnit, unitType } from './movement.ts';
import { isBroken, structureDef, syncNav, type StructureDef } from './structures.ts';
import type { BattleState, StructureState, UnitState } from './types.ts';

/** Only siege engines harm structures; rams strike gates only. */
export const SIEGE_ENGINE_TAG = 'siegeEngine';
export const GATES_ONLY_TAG = 'gatesOnly';
/** The castle and its walls belong to the defenders. */
const CASTLE_FACTION: UnitState['faction'] = 'defender';

export interface StructureAttackPreview {
  readonly attackerId: string;
  readonly structureId: string;
  readonly melee: boolean;
  /** To the nearest cell of the structure. */
  readonly distanceM: number;
  readonly rangeM: number;
  readonly apCost: number;
  readonly blow: BlowOdds;
}

export type StructureAttackPreviewResult = { readonly ok: true; readonly preview: StructureAttackPreview } | { readonly ok: false; readonly reason: CommandRejection };

/** Distance (m) from `p` to the nearest of `cells` (0 inside one). */
export function distanceToCells(ctx: BattleContext, cells: readonly number[], p: Vec2): number {
  const cs = ctx.nav.cellSize;
  const w = ctx.nav.width;
  let best = Number.POSITIVE_INFINITY;
  for (const i of cells) {
    const x0 = (i % w) * cs;
    const z0 = Math.floor(i / w) * cs;
    const dx = Math.max(x0 - p.x, 0, p.x - (x0 + cs));
    const dz = Math.max(z0 - p.z, 0, p.z - (z0 + cs));
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** The intact structure standing in front of `def`, if any (raised drawbridge, closed gate). */
export function shieldOf(ctx: BattleContext, structures: readonly StructureState[], def: StructureDef): StructureDef | null {
  const front = def.kind === 'gate' ? 'drawbridge' : def.kind === 'portcullis' ? 'gate' : null;
  if (!front) return null;
  return ctx.structures.find((d) => d.kind === front && d.gateId === def.gateId && !isBroken(structures, d.id)) ?? null;
}

export function previewStructureAttack(ctx: BattleContext, state: BattleState, attackerId: string, structureId: string): StructureAttackPreviewResult {
  syncNav(ctx, state.structures, state.works);
  const attacker = findUnit(state, attackerId);
  if (!attacker) return { ok: false, reason: 'unknownUnit' };
  if (!attacker.alive) return { ok: false, reason: 'unitDead' };
  if (attacker.faction !== state.activeFaction) return { ok: false, reason: 'notYourTurn' };
  const def = structureDef(ctx, structureId);
  if (!def) return { ok: false, reason: 'unknownStructure' };
  if (isBroken(state.structures, def.id)) return { ok: false, reason: 'structureDown' };
  if (def.maxHp <= 0) return { ok: false, reason: 'structureInvulnerable' };
  const type = unitType(ctx, attacker);
  const attack = type.attack;
  if (!attack) return { ok: false, reason: 'noAttack' };
  const melee = attack.rangeM === 0;
  if (!type.tags.includes(SIEGE_ENGINE_TAG) || !(melee || type.tags.includes(INDIRECT_FIRE_TAG))) return { ok: false, reason: 'noSiegeWeapon' };
  if (type.tags.includes(GATES_ONLY_TAG) && def.kind !== 'gate' && def.kind !== 'portcullis') return { ok: false, reason: 'gatesOnly' };
  if (shieldOf(ctx, state.structures, def)) return { ok: false, reason: 'structureShielded' };
  if (attacker.actions <= 0) return { ok: false, reason: 'noActionLeft' };
  const d = ctx.rules.damage;
  if (attacker.ap < d.attackApCost) return { ok: false, reason: 'insufficientAp' };
  const distanceM = distanceToCells(ctx, def.cells, attacker.position);
  const rangeM = melee ? d.meleeReachM : attack.rangeM;
  if (distanceM > rangeM) return { ok: false, reason: 'outOfRange' };
  const blow = oddsAgainst(ctx, attack, def.material, 1, 0, 'none', 0, ctx.rules.structures.hitBonus);
  return { ok: true, preview: { attackerId, structureId, melee, distanceM, rangeM, apCost: d.attackApCost, blow } };
}

/**
 * `def` gives way: a wall segment throws down the units on its wall-walk (fall damage, guard
 * lost) and shakes the defenders around it. Appends the events; returns the units.
 */
export function bringDown(ctx: BattleContext, units: readonly UnitState[], def: StructureDef, byId: string | null, events: GameEvent[]): UnitState[] {
  const fallen: FallenUnit[] = [];
  const blows: BlowOutcome[] = [];
  let out = [...units];
  if (def.kind === 'wall') {
    const cells = new Set(def.cells);
    const damage = ctx.rules.structures.fallDamage;
    out = out.map((u) => {
      if (!u.alive || !cells.has(cellIndexOf(ctx, u.position))) return u;
      const hpAfter = Math.max(0, u.hp - damage);
      fallen.push({ unitId: u.id, damage, hpAfter });
      if (byId) blows.push({ attackerId: byId, targetId: u.id, hpBefore: u.hp, hpAfter });
      return { ...u, hp: hpAfter, alive: hpAfter > 0, overwatch: null };
    });
  }
  events.push({ type: 'structureBroken', structureId: def.id, kind: def.kind, byId, fallen });
  for (const f of fallen) if (f.hpAfter === 0) events.push({ type: 'unitDied', unitId: f.unitId, byId: byId ?? f.unitId });
  out = moraleAfterBlows(ctx, out, blows, events);
  if (def.kind === 'wall') out = moraleAfterCollapse(ctx, out, def.center, CASTLE_FACTION, events);
  return out;
}

/** Rolls a previewed structure attack against the battle's RNG stream. */
export function resolveStructureAttack(ctx: BattleContext, state: BattleState, preview: StructureAttackPreview): { state: BattleState; events: GameEvent[] } {
  const rng = Rng.fromState(state.rng);
  const def = structureDef(ctx, preview.structureId) as StructureDef;
  const attacker = findUnit(state, preview.attackerId) as UnitState;
  const before = state.structures.find((s) => s.id === def.id) as StructureState;
  const roll = rollBlow(rng, preview.blow);
  const hpAfter = Math.max(0, before.hp - roll.damage);
  const events: GameEvent[] = [
    { type: 'structureDamaged', attackerId: attacker.id, structureId: def.id, hitChance: preview.blow.hitChance, hit: roll.hit, crit: roll.crit, damage: roll.damage, hpAfter },
  ];
  const acted: UnitState = { ...attacker, ap: attacker.ap - preview.apCost, actions: attacker.actions - 1, facing: faceTowards(attacker.position, def.center, attacker.facing) };
  let units: readonly UnitState[] = state.units.map((u) => (u.id === acted.id ? acted : u));
  const structures = state.structures.map((s) => (s.id === def.id ? { id: s.id, hp: hpAfter, broken: hpAfter === 0 } : s));
  if (hpAfter === 0) units = bringDown(ctx, units, def, attacker.id, events);
  const status = battleStatus(units);
  if (status !== 'ongoing') events.push({ type: 'battleEnded', status });
  return { state: { ...state, units, structures, status, rng: rng.getState() }, events };
}

/** Drawbridges whose winch operator has died drop across the moat. Appends the events. */
export function lowerDrawbridges(ctx: BattleContext, state: BattleState, events: GameEvent[]): BattleState {
  let structures = state.structures;
  for (const def of ctx.structures) {
    if (def.kind !== 'drawbridge' || !def.operatorId || isBroken(structures, def.id)) continue;
    const operator = findUnit(state, def.operatorId);
    if (!operator || operator.alive) continue;
    structures = structures.map((s) => (s.id === def.id ? { ...s, broken: true } : s));
    events.push({ type: 'structureBroken', structureId: def.id, kind: def.kind, byId: null, fallen: [] });
  }
  return structures === state.structures ? state : { ...state, structures };
}

/** Structures `unit` could strike from where it stands (the AI's and the HUD's shortlist). */
export function structuresInReach(ctx: BattleContext, state: BattleState, unitId: string): StructureAttackPreview[] {
  const out: StructureAttackPreview[] = [];
  for (const def of ctx.structures) {
    const r = previewStructureAttack(ctx, state, unitId, def.id);
    if (r.ok) out.push(r.preview);
  }
  return out;
}

/** Distance helper for callers ranking structures by proximity. */
export function distanceToStructure(ctx: BattleContext, def: StructureDef, p: Vec2): number {
  return def.cells.length > 0 ? distanceToCells(ctx, def.cells, p) : distance(def.center, p);
}
