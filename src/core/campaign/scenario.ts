/**
 * A campaign battle's scenario: the map's own (its units, the heroes) shaped by the castle's
 * effects and the chosen stratagem. Pure and deterministic: the same map, effects and absent
 * heroes give the same scenario, which the battle then replays from.
 */
import { facingSlot } from '../battle/approaches.ts';
import type { BattleContext } from '../battle/context.ts';
import { DEFAULT_MORALE } from '../battle/create.ts';
import { heroSpawnCells } from '../battle/heroes.ts';
import { TOWER_TAG } from '../battle/siege-tower.ts';
import { initialStructures, NO_WORKS, syncNav } from '../battle/structures.ts';
import { HERO_TAG, SIEGE_ENGINE_TAG } from '../battle/tags.ts';
import type { BattleState, Scenario, StructureStart, UnitSpawn } from '../battle/types.ts';
import { distance, type Vec2 } from '../math/vec2.ts';
import { isPassable } from '../nav-grid/nav-grid.ts';
import type { Faction } from '../rules/types.ts';
import { garrisonGroupOf } from '../worldgen/garrison.ts';
import type { BattleEffects, CampaignBattle, CampaignData, CampaignLevel, RankRule, Stratagem } from './types.ts';

/** Reinforcements gather this far behind the army (or the siege park), away from the castle (m). */
const REINFORCE_REAR_M = 10;
/** How far from that point they may stand (m). */
const REINFORCE_SEARCH_M = 40;
/** Two spawned units stand at least this far apart (m). */
const SPAWN_GAP_M = 1.5;
/** However much time stratagems cost, the garrison holds at least this many rounds. */
const MIN_TURN_LIMIT = 8;
/** Reinforcements' ids: `att-camp-<type>-<n>`. */
const REINFORCEMENT_PREFIX = 'att-camp-';

function centroid(points: readonly Vec2[]): Vec2 | null {
  if (points.length === 0) return null;
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, z: points.reduce((s, p) => s + p.z, 0) / points.length };
}

/** `from` moved `m` metres directly away from `castle`. */
function behind(from: Vec2, castle: Vec2, m: number): Vec2 {
  const dx = from.x - castle.x;
  const dz = from.z - castle.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: from.x + (dx / len) * m, z: from.z + (dz / len) * m };
}

/**
 * The effects of a battle in order: the castle's, the stratagem's, then the player's rank (ADR-045).
 * A rank that brings the garrison to full strength takes back the castle's own absentees.
 */
export function battleEffects(battle: CampaignBattle, stratagem: Stratagem | null, rank?: RankRule): readonly BattleEffects[] {
  const castle = rank?.fullGarrison ? withoutCut(battle.battle) : battle.battle;
  return [castle, ...(stratagem ? [stratagem.effects] : []), ...(rank ? [rank.effects] : [])];
}

function withoutCut(e: BattleEffects): BattleEffects {
  const { cut: _absent, ...rest } = e;
  return rest;
}

/**
 * The scenario of a campaign battle. `base` is the map's (its units and the heroes); the
 * effects leave defenders out, bring reinforcements, damage structures, lay causeways and set
 * the conditions, the turn limit and the starting morale. Absent heroes (resting from a grave
 * wound) stay out.
 */
export function shapeScenario(ctx: BattleContext, base: Scenario, effects: readonly BattleEffects[], absentHeroes: readonly string[] = []): Scenario {
  const rules = ctx.rules;
  // Free cells are those of the intact castle (where the map's units were placed).
  syncNav(ctx, initialStructures(ctx.structures), NO_WORKS);
  const factionOf = (u: UnitSpawn): Faction | undefined => rules.units[u.typeKey]?.faction;
  const tagsOf = (u: UnitSpawn): readonly string[] => rules.units[u.typeKey]?.tags ?? [];
  let units = base.units.filter((u) => !(absentHeroes.includes(u.typeKey) && tagsOf(u).includes(HERO_TAG)));

  // Defenders left out, the last of each kind first; never a drawbridge's winch operator.
  const operators = new Set(ctx.structures.map((d) => d.operatorId).filter((id): id is string => id !== undefined));
  for (const e of effects) {
    for (const cut of e.cut ?? []) {
      const out = units
        .filter((u) => factionOf(u) === 'defender' && !operators.has(u.id) && (!cut.group || garrisonGroupOf(u.id) === cut.group) && (!cut.typeKey || u.typeKey === cut.typeKey))
        .map((u) => u.id)
        .sort()
        .reverse()
        .slice(0, cut.count);
      units = units.filter((u) => !out.includes(u.id));
    }
  }

  const castle = centroid(ctx.structures.map((d) => d.center)) ?? { x: 0, z: 0 };
  const attackers = units.filter((u) => factionOf(u) === 'attacker');
  const engines = attackers.filter((u) => tagsOf(u).includes(SIEGE_ENGINE_TAG));
  const army = centroid(attackers.filter((u) => !tagsOf(u).includes(SIEGE_ENGINE_TAG)).map((u) => u.position)) ?? castle;
  const park = centroid(engines.map((u) => u.position)) ?? army;
  const facing = attackers[0]?.facing;

  // Reinforcements, on the free cells nearest a point behind the army (engines: the park).
  const counts = new Map<string, number>();
  for (const e of effects) {
    for (const r of e.reinforce ?? []) {
      const type = rules.units[r.typeKey];
      if (!type) continue;
      const centre = behind(type.tags.includes(SIEGE_ENGINE_TAG) ? park : army, castle, REINFORCE_REAR_M);
      const taken = units.map((u) => u.position);
      const free = (p: Vec2) => isPassable(ctx.nav, type.movement, Math.floor(p.x), Math.floor(p.z)) && taken.every((q) => distance(q, p) >= SPAWN_GAP_M);
      for (const position of heroSpawnCells(centre, free, r.count, REINFORCE_SEARCH_M)) {
        const n = counts.get(r.typeKey) ?? 0;
        counts.set(r.typeKey, n + 1);
        units = [...units, { id: `${REINFORCEMENT_PREFIX}${r.typeKey}-${n}`, typeKey: r.typeKey, position, ...(facing ? { facing } : {}) }];
      }
    }
  }

  // Structures: the one of each kind nearest the army (ties: by id).
  const all = units.filter((u) => factionOf(u) === 'attacker').map((u) => u.position);
  const front = centroid(all) ?? army;
  const starts: StructureStart[] = [...(base.structures ?? [])];
  for (const e of effects) {
    for (const s of e.structures ?? []) {
      const pick = ctx.structures
        .filter((d) => d.kind === s.kind && !starts.some((x) => x.id === d.id))
        .sort((a, b) => distance(a.center, front) - distance(b.center, front) || (a.id < b.id ? -1 : 1))[0];
      if (pick) starts.push({ id: pick.id, ...(s.hpFraction !== undefined ? { hpFraction: s.hpFraction } : {}), ...(s.broken ? { broken: true } : {}) });
    }
  }

  // Causeways in front of the intact walls nearest the siege towers (or the army).
  const fill = effects.reduce((n, e) => n + (e.fillMoat ?? 0), 0);
  const filled = [...(base.filled ?? [])];
  const moat = ctx.moats[0];
  if (fill > 0 && moat) {
    const towers = units.filter((u) => tagsOf(u).includes(TOWER_TAG)).map((u) => u.position);
    const from = towers.length > 0 ? towers : [front];
    const walls = ctx.structures
      .filter((d) => d.kind === 'wall' && !starts.some((x) => x.id === d.id && x.broken))
      .map((d) => ({ d, near: from.reduce((m, p) => Math.min(m, distance(p, d.center)), Number.POSITIVE_INFINITY) }))
      .sort((a, b) => a.near - b.near || (a.d.id < b.d.id ? -1 : 1));
    let added = 0;
    for (const { d } of walls) {
      if (added >= fill) break;
      const slot = facingSlot(ctx, d, moat.centerline);
      if (!slot || filled.includes(slot)) continue;
      filled.push(slot);
      added++;
    }
  }

  // Conditions and time: the last effect that sets them wins; deltas add up.
  let weather = base.weather;
  let startHour = base.startHour;
  let turnLimit = base.turnLimit ?? rules.battle.turnLimit;
  let turnDelta = 0;
  const moraleDelta: Partial<Record<Faction, number>> = {};
  const aim: Partial<Record<Faction, number>> = { ...base.aim };
  for (const e of effects) {
    if (e.weather !== undefined) weather = e.weather;
    if (e.startHour !== undefined) startHour = e.startHour;
    if (e.turnLimit !== undefined) turnLimit = e.turnLimit;
    turnDelta += e.turnDelta ?? 0;
    for (const [f, d] of Object.entries(e.morale ?? {}) as [Faction, number][]) moraleDelta[f] = (moraleDelta[f] ?? 0) + d;
    for (const [f, d] of Object.entries(e.aim ?? {}) as [Faction, number][]) aim[f] = (aim[f] ?? 0) + d;
  }
  // A stratagem never starts a side shaken.
  const morale: Partial<Record<Faction, number>> = { ...base.morale };
  for (const [f, d] of Object.entries(moraleDelta) as [Faction, number][]) {
    morale[f] = Math.max(rules.morale.shakenBelow, Math.min(rules.morale.max, (base.morale?.[f] ?? base.initialMorale ?? DEFAULT_MORALE) + d));
  }

  return {
    ...base,
    units,
    // A plan's delays never bring the deadline under MIN_TURN_LIMIT (a shorter one set outright stands).
    turnLimit: Math.max(Math.min(MIN_TURN_LIMIT, turnLimit), turnLimit + turnDelta),
    ...(weather !== undefined ? { weather } : {}),
    ...(startHour !== undefined ? { startHour } : {}),
    ...(Object.keys(morale).length > 0 ? { morale } : {}),
    ...(Object.values(aim).some((a) => a !== 0) ? { aim } : {}),
    ...(starts.length > 0 ? { structures: starts } : {}),
    ...(filled.length > 0 ? { filled } : {}),
  };
}

/** The three banners of a campaign battle. */
export interface Banners {
  /** The castle is taken. */
  readonly taken: boolean;
  /** Taken within the campaign's share of the turn limit. */
  readonly swift: boolean;
  /** Taken with few losses (heroes count). */
  readonly spared: boolean;
}

export function bannersOf(campaign: CampaignData, state: BattleState): Banners {
  const taken = state.status === 'attackerWon';
  const losses = state.units.filter((u) => u.faction === 'attacker' && !u.alive).length;
  return {
    taken,
    swift: taken && state.turn <= Math.ceil(state.turnLimit * campaign.banners.swiftShare),
    spared: taken && losses <= campaign.banners.maxLosses,
  };
}

export function bannerCount(b: Banners): number {
  return (b.taken ? 1 : 0) + (b.swift ? 1 : 0) + (b.spared ? 1 : 0);
}

/** Heroes gravely wounded in the battle (they miss the next one). */
export function woundedHeroes(ctx: Pick<BattleContext, 'rules'>, state: BattleState): string[] {
  return state.units.filter((u) => !u.alive && ctx.rules.units[u.typeKey]?.tags.includes(HERO_TAG)).map((u) => u.typeKey);
}

/** A level by id (the tutorial included). */
export function campaignBattle(campaign: CampaignData, id: string): CampaignBattle | CampaignLevel | null {
  if (campaign.tutorial.id === id) return campaign.tutorial;
  return campaign.levels.find((l) => l.id === id) ?? null;
}
