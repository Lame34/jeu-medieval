/**
 * A battle being played: the core state, its command log and its listeners. The simulation
 * truth lives here, outside React; stores only mirror what the HUD shows (CLAUDE.md). A battle
 * is `seed + scenario + commands`: the log replays it exactly.
 */
import { playTurn } from '../../core/ai/planner.ts';
import { heroSpawnCells } from '../../core/battle/heroes.ts';
import { drawConditions, lightsOf, type BattleConditions } from '../../core/battle/conditions.ts';
import { createBattleContext, deckAt, type BattleContext } from '../../core/battle/context.ts';
import { createBattle } from '../../core/battle/create.ts';
import { moatsOf } from '../../core/battle/moat.ts';
import { planStructures } from '../../core/battle/structures.ts';
import type { BattleState, Scenario, UnitSpawn } from '../../core/battle/types.ts';
import { applyCommand, type CommandResult } from '../../core/commands/apply.ts';
import type { Command } from '../../core/commands/types.ts';
import type { GameEvent } from '../../core/events/types.ts';
import { isPassable } from '../../core/nav-grid/nav-grid.ts';
import type { Seed } from '../../core/rng.ts';
import { sampleHeight } from '../../core/terrain-data/terrain-data.ts';
import type { Faction } from '../../core/rules/types.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';

/** The side the player commands; the AI plays the other. */
export const PLAYER_FACTION: Faction = 'attacker';

export type SessionListener = (events: readonly GameEvent[], state: BattleState) => void;

/** Scenario from the map's unit markers (units on wall-walks and towers stand on their decks). */
function scenarioFrom(ctx: BattleContext, layout: WorldLayout): Scenario {
  const units: UnitSpawn[] = [];
  for (const marker of layout.units) {
    const type = ctx.rules.units[marker.typeKey];
    if (!type) continue;
    const cx = Math.floor(marker.position.x / ctx.nav.cellSize);
    const cz = Math.floor(marker.position.z / ctx.nav.cellSize);
    if (!isPassable(ctx.nav, type.movement, cx, cz)) continue;
    const a = marker.facingTurns * 2 * Math.PI;
    units.push({ id: marker.id, typeKey: marker.typeKey, position: marker.position, facing: { x: Math.sin(a), z: Math.cos(a) } });
  }
  // The three heroes join the army, on the free cells nearest to its centre.
  const army = units.filter((u) => ctx.rules.units[u.typeKey]?.faction === PLAYER_FACTION);
  const heroKeys = Object.keys(ctx.rules.heroes);
  if (army.length > 0 && heroKeys.length > 0) {
    const centre = { x: army.reduce((s, u) => s + u.position.x, 0) / army.length, z: army.reduce((s, u) => s + u.position.z, 0) / army.length };
    const taken = units.map((u) => u.position);
    const free = (p: { x: number; z: number }) =>
      heroKeys.every((k) => isPassable(ctx.nav, ctx.rules.units[k]?.movement ?? 'foot', Math.floor(p.x), Math.floor(p.z))) && taken.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 1.5);
    heroSpawnCells(centre, free, heroKeys.length).forEach((position, i) => {
      const typeKey = heroKeys[i] as string;
      units.push({ id: `att-hero-${typeKey}`, typeKey, position, facing: army[0]?.facing ?? { x: 0, z: -1 } });
    });
  }
  return { units, firstFaction: PLAYER_FACTION };
}

export class BattleSession {
  readonly ctx: BattleContext;
  readonly seed: Seed;
  readonly scenario: Scenario;
  private current: BattleState;
  private readonly log: Command[] = [];
  private readonly listeners = new Set<SessionListener>();

  constructor(layout: WorldLayout, seed: Seed, conditions: Partial<BattleConditions> = {}) {
    this.ctx = createBattleContext(layout.terrain, DEFAULT_RULES, layout.deck, planStructures(layout, DEFAULT_RULES.structures), moatsOf(layout), lightsOf(layout));
    this.seed = seed;
    // The battle's weather and start hour, drawn from the seed unless the caller fixes them.
    this.scenario = { ...scenarioFrom(this.ctx, layout), ...drawConditions(DEFAULT_RULES, seed), ...conditions };
    this.current = createBattle(this.ctx, seed, this.scenario);
  }

  /** Height (m) a unit stands at: the relief plus the deck it is on (wall-walk, stairs). */
  standHeight(x: number, z: number): number {
    return sampleHeight(this.ctx.terrain, x, z) + deckAt(this.ctx, { x, z });
  }

  get state(): BattleState {
    return this.current;
  }

  /** Every command issued so far, rejected ones included (they replay as rejections). */
  get commands(): readonly Command[] {
    return this.log;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(events: readonly GameEvent[]): void {
    for (const listener of this.listeners) listener(events, this.current);
  }

  issue(command: Command): CommandResult {
    const result = applyCommand(this.ctx, this.current, command);
    this.log.push(command);
    this.current = result.state;
    this.emit(result.events);
    return result;
  }

  /** The AI plays `faction`'s whole turn. */
  playAiTurn(faction: Faction): void {
    const turn = playTurn(this.ctx, this.current, faction);
    this.log.push(...turn.commands);
    this.current = turn.state;
    this.emit(turn.events);
  }
}
