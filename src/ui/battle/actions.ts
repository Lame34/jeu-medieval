/**
 * The selected unit's actions beside moving and attacking (brief §10: the action bar): stand
 * guard, a fire arrow, put out a fire, the siege works (fill the moat, undermine, dock the tower,
 * climb it), the heroes' abilities. Each is a button on the unit's card with its key. One that
 * needs no aim is ordered at once; the others are armed: the pointer previews them and a click
 * orders them (BattleDirector). Pressing an armed action again disarms it.
 */
import type { BattleContext } from '../../core/battle/context.ts';
import { distanceToStructure } from '../../core/battle/siege.ts';
import { FIRE_ARROWS_TAG, previewExtinguish, previewFireArrow } from '../../core/battle/fire.ts';
import { cooldownOf, previewAbility } from '../../core/battle/heroes.ts';
import { fillSiteAt } from '../../core/battle/moat.ts';
import { canOverwatch } from '../../core/battle/overwatch.ts';
import { dockOf, TOWER_TAG } from '../../core/battle/siege-tower.ts';
import { FILL_MOAT_TAG, UNDERMINE_TAG } from '../../core/battle/siege-works.ts';
import { isBroken, structureDef, syncNav, type StructureDef } from '../../core/battle/structures.ts';
import type { BattleState, UnitState } from '../../core/battle/types.ts';
import { applyCommand } from '../../core/commands/apply.ts';
import type { Command } from '../../core/commands/types.ts';
import { distance, type Vec2 } from '../../core/math/vec2.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useBattleUi, type HoverPreview } from '../../state/battle-ui.ts';
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

/** The intact curtain segment a tower docks at from where it stands (the nearest in reach). */
function wallToDock(ctx: BattleContext, state: BattleState, tower: UnitState): StructureDef | null {
  let best: { def: StructureDef; d: number } | null = null;
  for (const def of ctx.structures) {
    if (def.kind !== 'wall' || isBroken(state.structures, def.id)) continue;
    const d = distanceToStructure(ctx, def, tower.position);
    if (d <= ctx.rules.structures.towerDockReachM && (!best || d < best.d)) best = { def, d };
  }
  return best?.def ?? null;
}

function fireNear(ctx: BattleContext, state: BattleState, unit: UnitState): boolean {
  const reach = ctx.rules.fire.extinguishReachM + EXTINGUISH_OFFER_SLACK_M;
  const w = ctx.nav.width;
  return state.fires.some((f) => distance({ x: (f.cell % w) + 0.5, z: Math.floor(f.cell / w) + 0.5 }, unit.position) <= reach);
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
    out.push({ id: 'fireArrow', label: 'Flèche enflammée', key: 'B', description: 'Met le feu au point visé : champ, haie, bois. Le feu se propage avec le vent.', note: `${cost} PA`, disabled: !canAct || unit.ap < cost });
  }
  if (fireNear(ctx, state, unit)) {
    out.push({ id: 'extinguish', label: 'Éteindre', key: 'X', description: 'Étouffe le foyer visé et ses voisins.', note: null, disabled: !canAct });
  }
  if (hasTag(unit, TOWER_TAG) && !dockOf(state, unit.id)) {
    const wall = wallToDock(ctx, state, unit);
    out.push({ id: 'works', label: 'Amarrer', key: 'F', description: 'Abaisse la passerelle sur la courtine voisine : l’infanterie pourra monter.', note: wall ? null : 'collez la tour à une courtine', disabled: !wall || !canAct });
  } else if (towerToClimb(state, unit)) {
    // Beside a docked tower, F climbs it (as actionCommand decides), sappers included.
    out.push({ id: 'works', label: 'Monter', key: 'F', description: 'Grimpe par la tour de siège sur le chemin de ronde.', note: `${ctx.rules.structures.towerClimbAp} PA`, disabled: unit.ap < ctx.rules.structures.towerClimbAp });
  } else if (hasTag(unit, FILL_MOAT_TAG) || hasTag(unit, UNDERMINE_TAG)) {
    out.push({ id: 'works', label: 'Combler ou saper', key: 'F', description: 'Visez la douve pour y jeter des fascines (une chaussée), ou le pied d’une courtine pour la saper.', note: 'tout le tour', disabled: !canAct || unit.ap < d.attackApCost });
  }
  const hero = ctx.rules.heroes[unit.typeKey];
  hero?.abilities.forEach((a, i) => {
    const wait = cooldownOf(unit, a.id);
    out.push({ id: `ability:${a.id}`, label: a.name, key: String(i + 1), description: a.description, note: wait > 0 ? `recharge ${wait}` : a.apCost > 0 ? `${a.apCost} PA` : null, disabled: wait > 0 || unit.ap < a.apCost });
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
      if (hasTag(unit, TOWER_TAG)) {
        const wall = wallToDock(ctx, state, unit);
        return wall ? { type: 'dockTower', unitId: unit.id, structureId: wall.id } : null;
      }
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

/** Does this action need aiming (else it is ordered at once)? */
function needsAim(session: BattleSession, unit: UnitState, id: ActionId): boolean {
  if (id === 'works') return !hasTag(unit, TOWER_TAG) && !towerToClimb(session.state, unit);
  if (id.startsWith('ability:')) return actionCommand(session, unit, id, undefined, null) === null;
  return true;
}

/** A button or its key: an order at once, or the action armed (pressed again: disarmed). */
export function triggerAction(session: BattleSession, key: ActionId): void {
  const ui = useBattleUi.getState();
  const unit = ui.selectedId ? session.state.units.find((u) => u.id === ui.selectedId) : undefined;
  if (!unit?.alive || ui.busy) return;
  // The keys 1 and 2 name a hero's abilities by their place.
  const index = /^ability:\d+$/.test(key) ? Number(key.slice('ability:'.length)) : -1;
  const ability = index >= 0 ? session.ctx.rules.heroes[unit.typeKey]?.abilities[index] : undefined;
  if (index >= 0 && !ability) return;
  const id: ActionId = ability ? `ability:${ability.id}` : key;
  const button = actionsFor(session, unit).find((b) => b.id === id);
  if (!button) return;
  if (button.disabled) {
    ui.pushLog([`${button.label} : ${button.note ?? 'impossible pour l’instant'}.`]);
    return;
  }
  if (!needsAim(session, unit, id)) {
    ui.armAction(null);
    const command = actionCommand(session, unit, id, undefined, null);
    if (command) session.issue(command);
    return;
  }
  ui.armAction(ui.armedAction === id ? null : id);
}

const pct = (p: number) => `${Math.round(p * 100)} %`;

/** What the armed action would do aimed here (the HUD's preview). */
export function actionPreview(session: BattleSession, unit: UnitState, id: ActionId, target: UnitState | undefined, ground: Vec2 | null): HoverPreview {
  const ctx = session.ctx;
  const state = session.state;
  const command = actionCommand(session, unit, id, target, ground);
  if (!command) return { kind: 'order', title: 'Visez une cible valide', lines: [] };
  switch (command.type) {
    case 'fireArrow': {
      const r = previewFireArrow(ctx, state, unit.id, command.at);
      if (!r.ok) return { kind: 'blocked', reason: r.reason };
      return { kind: 'order', title: 'Flèche enflammée', lines: [`${pct(r.preview.chance)} que ça prenne · ${r.preview.apCost} PA`], conditions: r.preview.conditions };
    }
    case 'extinguish': {
      const r = previewExtinguish(ctx, state, unit.id, command.at);
      return r.ok ? { kind: 'order', title: 'Éteindre', lines: [`${r.cells.length} foyer${r.cells.length > 1 ? 's' : ''} étouffé${r.cells.length > 1 ? 's' : ''}`] } : { kind: 'blocked', reason: r.reason };
    }
    case 'ability': {
      const r = previewAbility(ctx, state, command);
      return r.ok ? { kind: 'ability', preview: r.preview } : { kind: 'blocked', reason: r.reason };
    }
    default: {
      // The rules decide (a dry run on the state, which is then dropped).
      const result = applyCommand(ctx, state, command);
      // The dry run may have moved the nav grid to its outcome (a wall undermined): back to now.
      syncNav(ctx, state.structures, state.works);
      if (result.rejection) return { kind: 'blocked', reason: result.rejection };
      switch (command.type) {
        case 'overwatch':
          return { kind: 'order', title: 'Garde vers ce point', lines: ['Tire sur le premier ennemi qui entre dans le cône.'] };
        case 'fillMoat':
        case 'undermine': {
          const progressed = result.events.find((e) => e.type === 'siegeWorkProgressed');
          const done = progressed?.type === 'siegeWorkProgressed' ? progressed : null;
          const before = done ? done.progress - 1 : 0;
          const what = command.type === 'fillMoat' ? 'Combler la douve' : `Saper ${structureDef(ctx, command.structureId)?.kind === 'wall' ? 'la courtine' : ''}`;
          const left = done ? done.required - done.progress : 0;
          return { kind: 'order', title: what, lines: [done ? `${before}/${done.required} → ${done.progress}/${done.required}${left > 0 ? ` · encore ${left} tour${left > 1 ? 's' : ''}` : ' · terminé !'}` : '', 'Prend tout le tour du sapeur.'] };
        }
        default:
          return { kind: 'order', title: 'Ordre', lines: [] };
      }
    }
  }
}
