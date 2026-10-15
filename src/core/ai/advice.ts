/**
 * « Que ferait Guillaume ? » (ADR-043): the AI's own choice for one of the player's men, with the
 * facts it rests on, for the HUD to tell in a sentence. The AI decides on what the player's side
 * can see (the advice never betrays a hidden enemy), and its orders are plain commands.
 */
import { previewAttack } from '../battle/combat.ts';
import { perceivedState } from '../battle/conditions.ts';
import type { BattleContext } from '../battle/context.ts';
import { cellIndexOf } from '../battle/create.ts';
import { findUnit, planMove, unitType, type MovePlan } from '../battle/movement.ts';
import { threatsAt } from '../battle/overwatch.ts';
import { previewStructureAttack } from '../battle/siege.ts';
import { isBroken } from '../battle/structures.ts';
import type { BattleState } from '../battle/types.ts';
import type { Command } from '../commands/types.ts';
import { coverLevelAt } from '../nav-grid/nav-grid.ts';
import type { CoverLevel } from '../rules/types.ts';
import { decideUnit, objectiveOf, type Objective } from './planner.ts';

/** What the advised man does once there (or where he stands). */
export type AdviceDeed = 'strike' | 'shoot' | 'siegeBlow' | 'guard' | 'fillMoat' | 'undermine' | 'dock' | 'climb' | 'fireArrow' | 'extinguish' | 'ability' | 'advance' | 'hold';

export interface Advice {
  readonly commands: readonly Command[];
  /** The walk first, if any, with the enemy shooters that could reach him there and the cover. */
  readonly walk: { readonly plan: MovePlan; readonly threats: number; readonly cover: CoverLevel } | null;
  readonly deed: AdviceDeed;
  /** The enemy or the structure aimed at. */
  readonly targetId?: string;
  readonly structureId?: string;
  /** The chance to hit, and whether the best blow brings the enemy (or the structure) down. */
  readonly hitChance?: number;
  readonly canKill?: boolean;
  /** For a walk with no deed: what it closes in on (his objective, or the enemy). */
  readonly towards?: Objective | 'enemy';
  /** For an engine told to hold: what it waits for (the drawbridge down, a causeway to a wall). */
  readonly waitingFor?: 'drawbridge' | 'gate' | 'causeway';
}

const DEED_OF: Partial<Record<Command['type'], AdviceDeed>> = {
  overwatch: 'guard',
  attackStructure: 'siegeBlow',
  fillMoat: 'fillMoat',
  undermine: 'undermine',
  dockTower: 'dock',
  climbTower: 'climb',
  fireArrow: 'fireArrow',
  extinguish: 'extinguish',
  ability: 'ability',
};

export function adviseUnit(ctx: BattleContext, state: BattleState, unitId: string): Advice {
  const seen = perceivedState(ctx, state, state.activeFaction);
  const unit = findUnit(seen, unitId);
  const commands = unit ? decideUnit(ctx, seen, unit) : [];
  if (!unit) return { commands: [], walk: null, deed: 'hold' };
  if (commands.length === 0) {
    // A ram waits for its gate, a beffroi for a wall it can roll up to.
    const objective = objectiveOf(seen, unit, unitType(ctx, unit).tags);
    const bridgeUp = ctx.structures.some((d) => d.kind === 'drawbridge' && !isBroken(seen.structures, d.id));
    const waitingFor = objective === 'gate' ? (bridgeUp ? 'drawbridge' : 'gate') : objective === 'dock' ? 'causeway' : undefined;
    return { commands: [], walk: null, deed: 'hold', ...(waitingFor ? { waitingFor } : {}) };
  }
  const first = commands[0] as Command;
  let walk: Advice['walk'] = null;
  let there = seen;
  if (first.type === 'move') {
    const r = planMove(ctx, seen, unitId, first.to);
    if (r.ok) {
      const at = r.plan.destination;
      walk = { plan: r.plan, threats: threatsAt(ctx, seen, unit, at).length, cover: coverLevelAt(ctx.nav, cellIndexOf(ctx, at)) };
      there = { ...seen, units: seen.units.map((u) => (u.id === unitId ? { ...u, position: at, ap: u.ap - r.plan.apSpent } : u)) };
    }
  }
  const deed = commands.find((c) => c.type !== 'move');
  if (!deed) {
    const objective = objectiveOf(seen, unit, unitType(ctx, unit).tags);
    return { commands, walk, deed: walk ? 'advance' : 'hold', towards: objective ?? 'enemy' };
  }
  if (deed.type === 'attack') {
    const p = previewAttack(ctx, there, unitId, deed.targetId);
    const target = findUnit(there, deed.targetId);
    const melee = p.ok ? p.preview.melee : unitType(ctx, unit).attack?.rangeM === 0;
    return {
      commands,
      walk,
      deed: melee ? 'strike' : 'shoot',
      targetId: deed.targetId,
      ...(p.ok ? { hitChance: p.preview.blow.hitChance, canKill: target !== undefined && p.preview.blow.damage.max >= target.hp } : {}),
    };
  }
  if (deed.type === 'attackStructure') {
    const p = previewStructureAttack(ctx, there, unitId, deed.structureId);
    const hp = there.structures.find((s) => s.id === deed.structureId)?.hp ?? 0;
    return { commands, walk, deed: 'siegeBlow', structureId: deed.structureId, ...(p.ok ? { hitChance: p.preview.blow.hitChance, canKill: p.preview.blow.damage.max >= hp } : {}) };
  }
  return { commands, walk, deed: DEED_OF[deed.type] ?? 'hold', ...('structureId' in deed && deed.structureId ? { structureId: deed.structureId } : {}) };
}
