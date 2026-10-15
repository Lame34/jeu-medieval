/**
 * What a click would do where the pointer is (J7, ADR-039), for the HUD's preview and for the click
 * itself, from one place so that they never disagree. The selected man's deed (an attack, a blow on
 * a gate or a wall, a turn of works, a fire arrow, a hero's ability) is done from where he stands
 * or after the shortest walk this turn (core/battle/reach.ts); a walk too long for this turn is cut
 * where his points of action run out; what cannot be done says why, plainly. The battle receives
 * plain orders, the walk first, so a replay is exact.
 */
import { previewAttack } from '../../core/battle/combat.ts';
import { previewExtinguish, previewFireArrow } from '../../core/battle/fire.ts';
import { previewAbility } from '../../core/battle/heroes.ts';
import { findUnit, type MovePlan } from '../../core/battle/movement.ts';
import { threatsAt } from '../../core/battle/overwatch.ts';
import { planGroupMove, planGroupStrike, type GroupPlan } from '../../core/battle/group.ts';
import { planAdvance, planApproach, planFill, planStrike, planStructureStrike, planUndermine, weaponReach } from '../../core/battle/reach.ts';
import { distanceToStructure, previewStructureAttack } from '../../core/battle/siege.ts';
import { SIEGE_ENGINE_TAG } from '../../core/battle/tags.ts';
import { structureDef, syncNav } from '../../core/battle/structures.ts';
import type { BattleState, UnitState } from '../../core/battle/types.ts';
import { applyCommand } from '../../core/commands/apply.ts';
import type { AbilityCommand, Command, CommandRejection } from '../../core/commands/types.ts';
import { distance, type Vec2 } from '../../core/math/vec2.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useBattleUi, type HoverPreview, type WalkFirst } from '../../state/battle-ui.ts';
import { actionCommand, actionsFor, ordersOf, structureAt, worksAtOnce, type ActionId } from './actions.ts';
import { adviceFor } from './advice.ts';
import { actionPoints, STRUCTURE_OBJECT } from './describe.ts';
import type { BattleSession } from './session.ts';

export interface Intent {
  /** One preview per distinct intent: the pointer's moves within it change nothing. */
  readonly key: string;
  readonly hover: HoverPreview;
  /** The orders a click gives, in turn (the walk first); none when it cannot be done. */
  readonly orders: readonly Command[];
}

const NONE: Intent = { key: 'none', hover: { kind: 'none' }, orders: [] };

const pct = (p: number) => `${Math.round(p * 100)} %`;
const cellKey = (p: Vec2 | null) => (p ? `${Math.floor(p.x)},${Math.floor(p.z)}` : 'none');

export function isSiegeEngine(typeKey: string): boolean {
  const type = DEFAULT_RULES.units[typeKey];
  return Boolean(type?.attack && type.tags.includes(SIEGE_ENGINE_TAG));
}

/** The walk before a deed, as the HUD tells it (and the danger on the way). */
function walkFirst(session: BattleSession, unit: UnitState, plan: MovePlan | null, then: string): WalkFirst | undefined {
  return plan ? { plan, threats: threatsAt(session.ctx, session.state, unit, plan.destination), then } : undefined;
}

const refused = (key: string, reason: CommandRejection): Intent => ({ key, hover: { kind: 'blocked', reason }, orders: [] });

/** The key of what the pointer aims at (cheap: the intent is worked out only when it changes). */
export function intentKey(session: BattleSession, unit: UnitState, target: UnitState | undefined, ground: Vec2 | null, armed: ActionId | null): string {
  if (armed) return `action:${armed}:${target?.id ?? cellKey(ground)}`;
  if (target && target.faction !== unit.faction) return `attack:${target.id}`;
  if (!target && ground && isSiegeEngine(unit.typeKey)) {
    const def = structureAt(session.ctx, session.state, ground);
    if (def) return `structure:${def.id}`;
  }
  if (ground && !target) return `move:${cellKey(ground)}`;
  return 'none';
}

/** What a click by `unit` on `target` or `ground` (with `armed` ready) would do. */
export function intentAt(session: BattleSession, unit: UnitState, target: UnitState | undefined, ground: Vec2 | null, armed: ActionId | null): Intent {
  const key = intentKey(session, unit, target, ground, armed);
  if (armed) return armedIntent(session, unit, armed, target, ground, key);
  if (target && target.faction !== unit.faction) return attackIntent(session, unit, target, key);
  if (key.startsWith('structure:')) return structureIntent(session, unit, key.slice('structure:'.length), key);
  if (ground && !target) return moveIntent(session, unit, ground, key);
  return NONE;
}

function attackIntent(session: BattleSession, unit: UnitState, target: UnitState, key: string): Intent {
  const strike = planStrike(session.ctx, session.state, unit.id, target.id);
  if (!strike) {
    const here = previewAttack(session.ctx, session.state, unit.id, target.id);
    return here.ok ? NONE : refused(key, here.reason);
  }
  const verb = strike.preview.melee ? 'frapper' : 'tirer';
  const approach = walkFirst(session, unit, strike.move, verb);
  return { key, hover: { kind: 'attack', preview: strike.preview, ...(approach ? { approach } : {}) }, orders: ordersOf(unit, strike, { type: 'attack', unitId: unit.id, targetId: target.id }) };
}

function structureIntent(session: BattleSession, unit: UnitState, structureId: string, key: string): Intent {
  const { ctx, state } = session;
  const def = structureDef(ctx, structureId);
  if (!def) return NONE;
  const strike = planStructureStrike(ctx, state, unit.id, structureId);
  if (!strike) {
    const here = previewStructureAttack(ctx, state, unit.id, structureId);
    return here.ok ? NONE : refused(key, here.reason);
  }
  const st = state.structures.find((s) => s.id === structureId);
  const approach = walkFirst(session, unit, strike.move, `frapper ${STRUCTURE_OBJECT[def.kind]}`);
  return {
    key,
    hover: { kind: 'structure', preview: strike.preview, structure: def.kind, hp: st?.hp ?? 0, maxHp: def.maxHp, ...(approach ? { approach } : {}) },
    orders: ordersOf(unit, strike, { type: 'attackStructure', unitId: unit.id, structureId }),
  };
}

function moveIntent(session: BattleSession, unit: UnitState, ground: Vec2, key: string): Intent {
  const result = planAdvance(session.ctx, session.state, unit.id, ground);
  if (!result.ok) return refused(key, result.reason);
  const { plan, partial } = result;
  return {
    key,
    hover: { kind: 'move', plan, apLeft: unit.ap - plan.apSpent, threats: threatsAt(session.ctx, session.state, unit, plan.destination), ...(partial ? { partial } : {}) },
    orders: [{ type: 'move', unitId: unit.id, to: plan.destination }],
  };
}

/** A deed armed from the unit's card, aimed here. */
function armedIntent(session: BattleSession, unit: UnitState, id: ActionId, target: UnitState | undefined, ground: Vec2 | null, key: string): Intent {
  const { ctx, state } = session;
  const command = actionCommand(session, unit, id, target, ground);
  if (!command) return { key, hover: { kind: 'order', title: 'Visez une cible valide', lines: [] }, orders: [] };
  switch (command.type) {
    case 'overwatch':
      return { key, hover: { kind: 'order', title: 'Garde vers ce point', lines: ['Tire sur le premier ennemi qui entre dans le cône.'] }, orders: [command] };
    case 'fireArrow': {
      const plan = planApproach(ctx, state, unit.id, (s) => previewFireArrow(ctx, s, unit.id, command.at), (p) => distance(p, command.at), weaponReach(ctx, unit));
      if (!plan) {
        const here = previewFireArrow(ctx, state, unit.id, command.at);
        return here.ok ? NONE : refused(key, here.reason);
      }
      const approach = walkFirst(session, unit, plan.move, 'tirer');
      return {
        key,
        hover: { kind: 'order', title: 'Flèche enflammée', lines: [`${pct(plan.preview.chance)} que ça prenne · ${actionPoints(plan.preview.apCost)}`], conditions: plan.preview.conditions, ...(approach ? { approach } : {}) },
        orders: ordersOf(unit, plan, command),
      };
    }
    case 'extinguish': {
      const plan = planApproach(
        ctx,
        state,
        unit.id,
        (s) => {
          const r = previewExtinguish(ctx, s, unit.id, command.at);
          return r.ok ? { ok: true, preview: r.cells } : r;
        },
        (p) => distance(p, command.at),
        ctx.rules.fire.extinguishReachM,
      );
      if (!plan) {
        const here = previewExtinguish(ctx, state, unit.id, command.at);
        return here.ok ? NONE : refused(key, here.reason);
      }
      const n = plan.preview.length;
      const approach = walkFirst(session, unit, plan.move, 'éteindre');
      return { key, hover: { kind: 'order', title: 'Éteindre', lines: [`${n} foyer${n > 1 ? 's' : ''} étouffé${n > 1 ? 's' : ''}`], ...(approach ? { approach } : {}) }, orders: ordersOf(unit, plan, command) };
    }
    case 'fillMoat':
    case 'undermine': {
      const plan = command.type === 'fillMoat' ? planFill(ctx, state, unit.id, command.at) : planUndermine(ctx, state, unit.id, command.structureId);
      if (!plan) {
        const dry = applyCommand(ctx, state, command);
        syncNav(ctx, state.structures, state.works);
        return dry.rejection ? refused(key, dry.rejection) : NONE;
      }
      const w = plan.preview;
      const left = w.required - w.progress - 1;
      const what = command.type === 'fillMoat' ? 'Combler la douve' : 'Miner la muraille';
      const approach = walkFirst(session, unit, plan.move, what.toLowerCase());
      return {
        key,
        hover: { kind: 'order', title: what, lines: [`${w.progress}/${w.required} → ${w.progress + 1}/${w.required}${left > 0 ? ` · encore ${left} tour${left > 1 ? 's' : ''}` : ' · terminé !'}`, 'Prend tout le tour du mineur.'], ...(approach ? { approach } : {}) },
        orders: ordersOf(unit, plan, command),
      };
    }
    case 'ability':
      return abilityIntent(session, unit, command, key);
    default:
      return NONE;
  }
}

function abilityIntent(session: BattleSession, unit: UnitState, command: AbilityCommand, key: string): Intent {
  const { ctx, state } = session;
  const ability = ctx.rules.heroes[unit.typeKey]?.abilities.find((a) => a.id === command.abilityId);
  if (!ability) return NONE;
  // Where the ability is aimed, and how near he must be.
  const target = command.targetId ? findUnit(state, command.targetId) : undefined;
  const def = command.structureId ? structureDef(ctx, command.structureId) : undefined;
  const reach = ability.target === 'allyEngine' ? ability.radiusM : ability.target === 'enemy' ? weaponReach(ctx, unit) : ctx.rules.damage.meleeReachM + ctx.rules.structures.fillSlotM;
  const distanceTo = (p: Vec2) => (target ? distance(p, target.position) : def ? distanceToStructure(ctx, def, p) : command.at ? distance(p, command.at) : 0);
  const plan = ability.target === 'self' ? null : planApproach(ctx, state, unit.id, (s) => previewAbility(ctx, s, command), distanceTo, reach);
  if (!plan) {
    const here = previewAbility(ctx, state, command);
    if (!here.ok) return refused(key, here.reason);
    return { key, hover: { kind: 'ability', preview: here.preview }, orders: [command] };
  }
  const approach = walkFirst(session, unit, plan.move, ability.name.toLowerCase());
  return { key, hover: { kind: 'ability', preview: plan.preview, ...(approach ? { approach } : {}) }, orders: ordersOf(unit, plan, command) };
}

/** Does this action need aiming (else it is ordered at once)? */
function needsAim(session: BattleSession, unit: UnitState, id: ActionId): boolean {
  if (id === 'works') return worksAtOnce(session, unit) === null;
  if (id === 'advice') return false;
  if (id.startsWith('ability:')) return actionCommand(session, unit, id, undefined, null) === null;
  return true;
}

/** A button or its key: an order at once, or the action armed (pressed again: disarmed). */
export function triggerAction(session: BattleSession, key: ActionId): void {
  const ui = useBattleUi.getState();
  const unit = ui.selectedId ? session.state.units.find((u) => u.id === ui.selectedId) : undefined;
  if (!unit?.alive || ui.busy) return;
  if (ui.group.length > 1) {
    ui.pushLog(['Choisissez un seul homme pour cet ordre.']);
    return;
  }
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
  if (id === 'advice') {
    toggleAdvice(session, unit);
    return;
  }
  if (!needsAim(session, unit, id)) {
    ui.armAction(null);
    // Docking or climbing, after the walk this turn when the wall or the beffroi is not at hand.
    const atOnce = id === 'works' ? worksAtOnce(session, unit)?.orders : undefined;
    const command = actionCommand(session, unit, id, undefined, null);
    issueOrders(session, atOnce ?? (command ? [command] : []));
    return;
  }
  ui.armAction(ui.armedAction === id ? null : id);
}

/** What a click by several men (`ids`) on `target` or `ground` would do: walk in rank, or strike together. */
export function groupIntentKey(session: BattleSession, ids: readonly string[], target: UnitState | undefined, ground: Vec2 | null): string {
  const enemy = target && target.faction !== session.state.activeFaction;
  return `group:${ids.join(',')}:${target ? (enemy ? target.id : 'friend') : cellKey(ground)}`;
}

export function groupIntentAt(session: BattleSession, ids: readonly string[], target: UnitState | undefined, ground: Vec2 | null): { readonly key: string; readonly hover: HoverPreview; readonly orders: readonly (readonly Command[])[] } {
  const enemy = target && target.faction !== session.state.activeFaction ? target : undefined;
  const key = groupIntentKey(session, ids, target, ground);
  if (!enemy && (target || !ground)) return { key, hover: { kind: 'none' }, orders: [] };
  const plan: GroupPlan = enemy ? planGroupStrike(session.ctx, session.state, ids, enemy.id) : planGroupMove(session.ctx, session.state, ids, ground as Vec2);
  const { strikes, closeIn, arrive, partial, idle, walks } = plan;
  return { key, hover: { kind: 'group', verb: enemy ? 'strike' : 'move', men: ids.length, strikes, closeIn, arrive, partial, idle, walks }, orders: plan.orders };
}

/** Each man's orders in turn; a man whose next order the rules refuse (felled, routed, his enemy down) stops there, the others go on. */
export function issueGroupOrders(session: BattleSession, orders: readonly (readonly Command[])[]): void {
  for (const man of orders) {
    for (const order of man) {
      if (session.state.status !== 'ongoing') return;
      const state: BattleState = session.state;
      const dry = applyCommand(session.ctx, state, order);
      syncNav(session.ctx, state.structures, state.works);
      if (dry.rejection) break;
      session.issue(order);
    }
  }
}

/** The card's button, or C: shows Guillaume's advice for the chosen man, or follows the one on show. */
export function toggleAdvice(session: BattleSession, unit: UnitState): void {
  const ui = useBattleUi.getState();
  const shown = ui.advice?.unitId === unit.id ? ui.advice : null;
  if (!shown) {
    ui.armAction(null);
    ui.setAdvice(adviceFor(session, unit));
    return;
  }
  ui.setAdvice(null);
  issueOrders(session, shown.orders);
}

/**
 * Gives the orders in turn: the first as worked out on the current battle, each next one only if
 * the rules still accept it (a guard's shot on the way may have felled or routed the man).
 */
export function issueOrders(session: BattleSession, orders: readonly Command[]): void {
  for (const [i, order] of orders.entries()) {
    if (session.state.status !== 'ongoing') return;
    if (i > 0) {
      const state: BattleState = session.state;
      const dry = applyCommand(session.ctx, state, order);
      syncNav(session.ctx, state.structures, state.works);
      if (dry.rejection) return;
    }
    session.issue(order);
  }
}
