/**
 * « Que ferait Guillaume ? » (ADR-043): the old knight's advice for the chosen man, told in one
 * sentence (where he would go, what he would do there, and why), then followed at a word. The
 * choice is the AI's own (core/ai/advice.ts), on what the player's side can see.
 */
import { adviseUnit, type Advice } from '../../core/ai/advice.ts';
import type { BattleState, UnitState } from '../../core/battle/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import type { AdviceShown } from '../../state/battle-ui.ts';
import { actionPoints, heroSkillName, STRUCTURE_OBJECT } from './describe.ts';
import type { BattleSession } from './session.ts';

const pct = (p: number) => `${Math.round(p * 100)} %`;
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** « le milicien », « l’arbalétrier » (the garrison's men are all named in the masculine). */
function theMan(state: BattleState, id: string | undefined): string {
  const unit = id ? state.units.find((u) => u.id === id) : undefined;
  const name = (unit ? (DEFAULT_RULES.units[unit.typeKey]?.name ?? '') : '').toLowerCase();
  if (!name) return 'l’ennemi';
  return /^[aeéèêiouh]/.test(name) ? `l’${name}` : `le ${name}`;
}

const TOWARDS = { gate: 'vers la porte', works: 'vers la douve', dock: 'vers les murs', enemy: 'vers l’ennemi' } as const;

/** The walk: « avance à couvert (3 points d’action), hors de portée des tireurs ennemis ». */
function walkText(a: Advice, towards: boolean): string {
  if (!a.walk) return '';
  const w = a.walk;
  const where = towards && a.towards ? ` ${TOWARDS[a.towards]}` : '';
  const cover = w.cover === 'partial' || w.cover === 'heavy' ? ' à couvert' : '';
  const danger = w.threats === 0 ? ', hors de portée des tireurs ennemis' : `, sous la menace de ${w.threats} tireur${w.threats > 1 ? 's' : ''}`;
  return `avance${where}${cover} (${actionPoints(w.plan.apSpent)})${danger}`;
}

/** The odds of the blow, and whether it can finish the work. */
function oddsText(a: Advice, finish: string): string {
  if (a.hitChance === undefined) return '';
  return ` : ${pct(a.hitChance)} de toucher${a.canKill ? `, ${finish}` : ''}`;
}

/** « la porte » for "gate:castle-gate" (structure ids start with their kind). */
function theStructure(id: string | undefined): string {
  const kind = id?.slice(0, id.indexOf(':'));
  return kind && kind in STRUCTURE_OBJECT ? STRUCTURE_OBJECT[kind as keyof typeof STRUCTURE_OBJECT] : 'l’ouvrage';
}

function deedText(a: Advice, state: BattleState): string {
  switch (a.deed) {
    case 'strike':
      return `frappe ${theMan(state, a.targetId)}${oddsText(a, 'de quoi l’abattre')}`;
    case 'shoot':
      return `tire sur ${theMan(state, a.targetId)}${oddsText(a, 'de quoi l’abattre')}`;
    case 'siegeBlow':
      return `frappe ${theStructure(a.structureId)}${oddsText(a, 'de quoi en venir à bout')}`;
    case 'guard':
      return 'monte la garde face à l’ennemi le plus proche';
    case 'fillMoat':
      return 'comble la douve';
    case 'undermine':
      return 'mine la courtine';
    case 'dock':
      return 'accole le beffroi au mur';
    case 'climb':
      return 'monte par le beffroi sur le chemin de ronde';
    case 'fireArrow':
      return 'met le feu';
    case 'extinguish':
      return 'éteint le feu';
    case 'ability': {
      const ability = a.commands.find((c) => c.type === 'ability');
      return ability?.type === 'ability' ? `use de sa capacité, ${heroSkillName(ability.abilityId)}` : 'use de sa capacité';
    }
    case 'advance':
    case 'hold':
      return '';
  }
}

/** Guillaume's sentence for `a`. */
const WAITING = {
  drawbridge: 'Qu’il attende à l’abri : la porte reste hors d’atteinte tant que le pont-levis n’est pas abattu.',
  gate: 'Qu’il attende à l’abri : la porte n’est pas encore à sa portée.',
  causeway: 'Qu’il attende : il faut d’abord combler la douve devant une courtine pour qu’il y roule.',
} as const;

export function adviceText(a: Advice, state: BattleState): string {
  if (a.deed === 'hold') return a.waitingFor ? WAITING[a.waitingFor] : 'Qu’il garde sa place : il n’a rien de mieux à faire ce tour.';
  const deed = deedText(a, state);
  const walk = walkText(a, deed === '');
  return `${capitalized(walk && deed ? `${walk}, puis ${deed}` : walk || deed)}.`;
}

/** The advice for `unit`, ready to show. */
export function adviceFor(session: BattleSession, unit: UnitState): AdviceShown {
  const a = adviseUnit(session.ctx, session.state, unit.id);
  return { unitId: unit.id, text: adviceText(a, session.state), orders: a.commands, walk: a.walk?.plan ?? null, targetId: a.targetId ?? null };
}
