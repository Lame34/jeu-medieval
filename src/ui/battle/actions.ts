/**
 * The selected unit's actions beside moving and attacking (brief §10: the action bar): stand
 * guard, a fire arrow, put out a fire, the siege works (fill the moat, undermine, dock the tower,
 * climb it), the heroes' abilities. Each is a button on the unit's card with its key. One that
 * needs no aim is ordered at once; the others are armed: the pointer previews them and a click
 * orders them (ui/battle/intent.ts). Pressing an armed action again disarms it. Docking a beffroi
 * and climbing one are offered whenever the wall or the beffroi is within this turn's walk.
 */
import type { BattleContext } from '../../core/battle/context.ts';
import { distanceToStructure } from '../../core/battle/siege.ts';
import { FIRE_ARROWS_TAG } from '../../core/battle/fire.ts';
import { abilityCost, cooldownOf } from '../../core/battle/heroes.ts';
import { fillSiteAt } from '../../core/battle/moat.ts';
import { findUnit } from '../../core/battle/movement.ts';
import { canOverwatch } from '../../core/battle/overwatch.ts';
import { planClimb, planDock, type Approach } from '../../core/battle/reach.ts';
import { dockOf, TOWER_TAG } from '../../core/battle/siege-tower.ts';
import { FILL_MOAT_TAG, UNDERMINE_TAG } from '../../core/battle/siege-works.ts';
import { isBroken, type StructureDef } from '../../core/battle/structures.ts';
import type { BattleState, UnitState } from '../../core/battle/types.ts';
import type { Command } from '../../core/commands/types.ts';
import { distance, type Vec2 } from '../../core/math/vec2.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { actionPoints } from './describe.ts';
import type { BattleSession } from './session.ts';

export type ActionId = 'guard' | 'fireArrow' | 'extinguish' | 'works' | `ability:${string}`;

export interface ActionButton {
  readonly id: ActionId;
  readonly label: string;
  readonly key: string;
  readonly description: string;
  /** A cost or a cooldown, after the label. */
  readonly note: string | null;
  readonly disabled: boolean;
}

/** An engine picks the structure under the pointer within this distance (m). */
const STRUCTURE_PICK_M = 1.6;
/** A unit climbs a docked tower standing this close (m). */
const CLIMB_PICK_M = 2.2;
/** Walls tried for docking a beffroi, and docked beffrois for a climb (nearest first). */
const NEAREST_TRIED = 4;
/** A fire is offered to put out within this much more than the reach (m). */
const EXTINGUISH_OFFER_SLACK_M = 0.5;

function hasTag(unit: UnitState, tag: string): boolean {
  return DEFAULT_RULES.units[unit.typeKey]?.tags.includes(tag) ?? false;
}

/**
 * The structure an engine would strike at `p`: the nearest within reach, the drawbridge last (it
 * spans the ground in front of the gate), the portcullis once the gate in front of it is down.
 */
export function structureAt(ctx: BattleContext, state: BattleState, p: Vec2): StructureDef | null {
  let best: StructureDef | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const def of ctx.structures) {
    if (isBroken(state.structures, def.id)) continue;
    const d = distanceToStructure(ctx, def, p);
    if (d > STRUCTURE_PICK_M) continue;
    const score = d + (def.kind === 'drawbridge' ? STRUCTURE_PICK_M * 2 : 0);
    if (score < bestScore) {
      best = def;
      bestScore = score;
    }
  }
  if (best?.kind === 'gate' || best?.kind === 'portcullis') {
    const gate = ctx.structures.find((d) => d.kind === 'gate' && d.gateId === best?.gateId);
    const portcullis = ctx.structures.find((d) => d.kind === 'portcullis' && d.gateId === best?.gateId);
    best = gate && !isBroken(state.structures, gate.id) ? gate : (portcullis ?? best);
  }
  return best;
}

/** A docked tower with room, close enough for `unit` to climb. */
function towerToClimb(state: BattleState, unit: UnitState): UnitState | null {
  if (hasTag(unit, TOWER_TAG)) return null;
  const movement = DEFAULT_RULES.units[unit.typeKey]?.movement;
  if (movement === 'engine' || movement === 'mounted') return null;
  for (const d of state.docks) {
    const tower = state.units.find((u) => u.id === d.towerId && u.alive);
    if (tower && d.climbs < DEFAULT_RULES.structures.towerCapacity && distance(tower.position, unit.position) <= CLIMB_PICK_M) return tower;
  }
  return null;
}

function fireNear(ctx: BattleContext, state: BattleState, unit: UnitState): boolean {
  const reach = ctx.rules.fire.extinguishReachM + EXTINGUISH_OFFER_SLACK_M;
  const w = ctx.nav.width;
  return state.fires.some((f) => distance({ x: (f.cell % w) + 0.5, z: Math.floor(f.cell / w) + 0.5 }, unit.position) <= reach);
}

/** The orders of an approach: the walk (if any), then the deed. */
export function ordersOf(unit: UnitState, approach: Approach<unknown>, deed: Command): Command[] {
  return approach.move ? [{ type: 'move', unitId: unit.id, to: approach.move.destination }, deed] : [deed];
}

/**
 * The siege works a card's button orders at once, without aiming: dock this beffroi at the
 * nearest wall it can reach this turn, or climb the nearest docked beffroi with room. Null when
 * neither is possible this turn.
 */
export function worksAtOnce(session: BattleSession, unit: UnitState): { readonly orders: readonly Command[]; readonly walk: boolean } | null {
  const { ctx, state } = session;
  if (hasTag(unit, TOWER_TAG)) {
    const walls = ctx.structures.filter((d) => d.kind === 'wall' && !isBroken(state.structures, d.id)).sort((a, b) => distanceToStructure(ctx, a, unit.position) - distanceToStructure(ctx, b, unit.position));
    for (const wall of walls.slice(0, NEAREST_TRIED)) {
      const plan = planDock(ctx, state, unit.id, wall.id);
      if (plan) return { orders: ordersOf(unit, plan, { type: 'dockTower', unitId: unit.id, structureId: wall.id }), walk: plan.move !== null };
    }
    return null;
  }
  if (hasTag(unit, FILL_MOAT_TAG) || hasTag(unit, UNDERMINE_TAG)) {
    const beside = towerToClimb(state, unit);
    return beside ? { orders: [{ type: 'climbTower', unitId: unit.id, towerId: beside.id }], walk: false } : null;
  }
  const towers = state.docks
    .filter((d) => d.climbs < ctx.rules.structures.towerCapacity)
    .map((d) => findUnit(state, d.towerId))
    .filter((t): t is UnitState => t?.alive === true)
    .sort((a, b) => distance(a.position, unit.position) - distance(b.position, unit.position));
  for (const tower of towers.slice(0, NEAREST_TRIED)) {
    const plan = planClimb(ctx, state, unit.id, tower.id);
    if (plan) return { orders: ordersOf(unit, plan, { type: 'climbTower', unitId: unit.id, towerId: tower.id }), walk: plan.move !== null };
  }
  return null;
}

/** The buttons of the selected unit's card. */
export function actionsFor(session: BattleSession, unit: UnitState): ActionButton[] {
  const ctx = session.ctx;
  const state = session.state;
  const d = ctx.rules.damage;
  const out: ActionButton[] = [];
  const canAct = unit.actions > 0;
  if (canOverwatch(ctx, unit)) {
    out.push({ id: 'guard', label: 'Garde', key: 'G', description: 'Surveille un cône vers le point visé et tire sur le premier ennemi qui y entre. Prend le reste du tour.', note: null, disabled: !canAct || unit.ap < d.attackApCost });
  }
  if (hasTag(unit, FIRE_ARROWS_TAG)) {
    const cost = d.attackApCost + ctx.rules.fire.arrowExtraAp;
    out.push({ id: 'fireArrow', label: 'Flèche enflammée', key: 'B', description: 'Met le feu au point visé : champ, haie, maison, porte ou pont-levis. Le feu se propage avec le vent.', note: actionPoints(cost), disabled: !canAct || unit.ap < cost });
  }
  if (fireNear(ctx, state, unit)) {
    out.push({ id: 'extinguish', label: 'Éteindre', key: 'X', description: 'Étouffe le foyer visé et ses voisins.', note: null, disabled: !canAct || unit.ap < d.attackApCost });
  }
  const atOnce = worksAtOnce(session, unit);
  if (hasTag(unit, TOWER_TAG) && !dockOf(state, unit.id)) {
    out.push({ id: 'works', label: 'Accoler', key: 'F', description: 'Pousse le beffroi contre la courtine la plus proche et abaisse son pont : vos gens de pied pourront monter.', note: atOnce ? (atOnce.walk ? 's’approche d’abord du mur' : null) : 'aucune courtine à portée ce tour', disabled: !atOnce || !canAct });
  } else if (atOnce) {
    // A docked beffroi within this turn's walk: F walks there and climbs it.
    const climb = actionPoints(ctx.rules.structures.towerClimbAp);
    out.push({ id: 'works', label: 'Monter', key: 'F', description: 'Grimpe par le beffroi jusqu’au chemin de ronde.', note: atOnce.walk ? `s’approche d’abord, puis ${climb}` : climb, disabled: false });
  } else if (hasTag(unit, FILL_MOAT_TAG) || hasTag(unit, UNDERMINE_TAG)) {
    out.push({ id: 'works', label: 'Combler ou miner', key: 'F', description: 'Visez la douve pour y jeter des fascines (une chaussée), ou le pied d’une courtine pour la miner.', note: 'tout le tour', disabled: !canAct || unit.ap < d.attackApCost });
  }
  const hero = ctx.rules.heroes[unit.typeKey];
  hero?.abilities.forEach((a, i) => {
    const wait = cooldownOf(unit, a.id);
    const cost = abilityCost(ctx.rules, a);
    const note = wait > 0 ? `prête dans ${wait} tour${wait > 1 ? 's' : ''}` : cost.wholeTurn ? 'tout le tour' : actionPoints(cost.ap);
    out.push({ id: `ability:${a.id}`, label: a.name, key: String(i + 1), description: a.description, note, disabled: wait > 0 || unit.ap < cost.ap || (cost.deed && !canAct) });
  });
  return out;
}

/** Does this action aim at one of our own units (its click targets rather than selects it)? */
export function aimsAtAllies(unit: UnitState, id: ActionId): boolean {
  if (!id.startsWith('ability:')) return false;
  return DEFAULT_RULES.heroes[unit.typeKey]?.abilities.find((a) => `ability:${a.id}` === id)?.target === 'allyEngine';
}

/** The order an action gives aimed at `target` (a unit) or `ground`; null where it has no target. */
export function actionCommand(session: BattleSession, unit: UnitState, id: ActionId, target: UnitState | undefined, ground: Vec2 | null): Command | null {
  const ctx = session.ctx;
  const state = session.state;
  switch (id) {
    case 'guard':
      return ground ? { type: 'overwatch', unitId: unit.id, direction: { x: ground.x - unit.position.x, z: ground.z - unit.position.z } } : null;
    case 'fireArrow':
      return ground ? { type: 'fireArrow', unitId: unit.id, at: ground } : null;
    case 'extinguish':
      return ground ? { type: 'extinguish', unitId: unit.id, at: ground } : null;
    case 'works': {
      if (hasTag(unit, TOWER_TAG)) return null;
      const tower = towerToClimb(state, unit);
      if (tower) return { type: 'climbTower', unitId: unit.id, towerId: tower.id };
      if (!ground) return null;
      const def = structureAt(ctx, state, ground);
      if (def?.kind === 'wall' && hasTag(unit, UNDERMINE_TAG)) return { type: 'undermine', unitId: unit.id, structureId: def.id };
      return hasTag(unit, FILL_MOAT_TAG) && fillSiteAt(ctx, ground) ? { type: 'fillMoat', unitId: unit.id, at: ground } : null;
    }
    default: {
      const abilityId = id.slice('ability:'.length);
      const ability = ctx.rules.heroes[unit.typeKey]?.abilities.find((a) => a.id === abilityId);
      if (!ability) return null;
      switch (ability.target) {
        case 'self':
          return { type: 'ability', unitId: unit.id, abilityId };
        case 'enemy':
        case 'allyEngine':
          return target ? { type: 'ability', unitId: unit.id, abilityId, targetId: target.id } : null;
        case 'site': {
          if (!ground) return null;
          const def = structureAt(ctx, state, ground);
          if (def?.kind === 'wall') return { type: 'ability', unitId: unit.id, abilityId, structureId: def.id };
          return fillSiteAt(ctx, ground) ? { type: 'ability', unitId: unit.id, abilityId, at: ground } : null;
        }
      }
    }
  }
}
