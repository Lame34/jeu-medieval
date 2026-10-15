/** Journal lines (French) for core events. */
import { moraleStanding } from '../../core/battle/morale.ts';
import type { BattleState } from '../../core/battle/types.ts';
import type { HeroRule } from '../../core/rules/types.ts';
import type { CommandRejection } from '../../core/commands/types.ts';
import type { GameEvent } from '../../core/events/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';

export const FACTION_LABEL = { attacker: 'Assaillants', defender: 'Garnison' } as const;

/** The journal's last line, by winner and by how the battle ended. */
export const END_LABEL = {
  attackerWon: { eliminated: 'La garnison est anéantie : le château est à vous !', routed: 'La garnison s’enfuit : le château est à vous !', surrendered: 'La garnison se rend : le château est à vous !', relieved: 'Victoire des assaillants !' },
  defenderWon: { eliminated: 'Votre armée est anéantie.', routed: 'Votre armée se débande.', surrendered: 'Votre armée dépose les armes.', relieved: 'Les renforts arrivent : le siège est levé.' },
} as const;

export const REJECTION_LABEL: Readonly<Record<CommandRejection, string>> = {
  battleOver: 'La bataille est terminée.',
  unknownUnit: 'Homme inconnu.',
  unitDead: 'Il est déjà tombé.',
  notYourTurn: 'Attendez : c’est au tour de la garnison.',
  outOfBounds: 'C’est hors du champ de bataille.',
  sameCell: 'Il y est déjà.',
  destinationOccupied: 'Quelqu’un s’y tient déjà.',
  noPath: 'Aucun chemin n’y mène : la douve, un mur ou l’eau barre la route.',
  insufficientAp: 'Plus assez de points d’action ce tour : il reprendra au tour suivant.',
  unknownTarget: 'Cible inconnue.',
  targetDead: 'La cible est déjà tombée.',
  targetFriendly: 'C’est l’un des vôtres.',
  noAttack: 'Il ne peut pas frapper.',
  noActionLeft: 'Il a déjà agi ce tour : une seule action par tour.',
  outOfRange: 'Trop loin pour l’atteindre ce tour : avancez d’abord.',
  noLineOfSight: 'Il ne le voit d’aucun endroit atteignable ce tour : avancez d’abord.',
  unitFleeing: 'Il fuit et n’obéit plus.',
  cannotOverwatch: 'Seuls les archers et les arbalétriers peuvent monter la garde.',
  invalidDirection: 'Visez un point autour de lui pour orienter sa garde.',
  unknownStructure: 'Ouvrage inconnu.',
  structureDown: 'Cet ouvrage est déjà tombé.',
  structureInvulnerable: 'On ne peut pas abattre cet ouvrage : il faut d’abord abattre l’homme qui tient les chaînes du pont.',
  noSiegeWeapon: 'Seuls le mouton et le mangonneau entament les murailles.',
  gatesOnly: 'Le mouton n’enfonce que les portes.',
  structureShielded: 'Un autre ouvrage le protège : d’abord le pont-levis, puis la porte.',
  noSiegeSkill: 'Seuls les mineurs, et Bertrand, comblent la douve et minent les murs.',
  notAMoat: 'Visez la douve elle-même.',
  workDone: 'Ce tronçon de douve est déjà comblé.',
  notAWall: 'On ne mine que les murailles.',
  notATower: 'Seul un beffroi s’accole aux murs.',
  alreadyDocked: 'Le beffroi est déjà accolé au mur.',
  notDocked: 'Ce beffroi n’est accolé à aucun mur.',
  towerFull: 'Le beffroi a déjà monté ce tour tous les hommes qu’il pouvait.',
  cannotClimb: 'Ni les engins ni les gens à cheval ne montent par le beffroi.',
  noRoomOnWall: 'Plus de place en haut de ce mur.',
  towerDocked: 'Accolé au mur, le beffroi ne bouge plus.',
  noFireArrows: 'Seuls les archers tirent des flèches enflammées.',
  alreadyBurning: 'Cela brûle déjà.',
  notFlammable: 'Rien ne brûle là.',
  notBurning: 'Pas de feu à éteindre ici.',
  notAHero: 'Seul un héros a cette capacité.',
  unknownAbility: 'Capacité inconnue.',
  abilityCooling: 'Pas encore prête : il faut attendre quelques tours.',
  invalidAbilityTarget: 'Ce n’est pas une cible pour cette capacité.',
};

/** What a structure is called in the journal and the HUD. */
/** "1 point d’action", "2 points d’action" (a fraction in French decimals, singular under two). */
export function actionPoints(n: number): string {
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} point${n >= 2 ? 's' : ''} d’action`;
}

export const STRUCTURE_LABEL = { wall: 'Muraille', gate: 'Porte', portcullis: 'Coulisse', drawbridge: 'Pont-levis' } as const;

export const STRUCTURE_OBJECT = { wall: 'la muraille', gate: 'la porte', portcullis: 'la coulisse', drawbridge: 'le pont-levis' } as const;

/** "la porte" for "gate:castle-gate" (structure ids start with their kind). */
function structureObject(id: string): string {
  const kind = id.slice(0, id.indexOf(':'));
  return kind in STRUCTURE_OBJECT ? STRUCTURE_OBJECT[kind as keyof typeof STRUCTURE_OBJECT] : id;
}

export function unitLabel(state: BattleState, id: string): string {
  const unit = state.units.find((u) => u.id === id);
  if (!unit) return id;
  return DEFAULT_RULES.units[unit.typeKey]?.name ?? unit.typeKey;
}

/** A hero's name and rule, if the unit is one. */
function heroRule(state: BattleState, id: string): HeroRule | null {
  const unit = state.units.find((u) => u.id === id);
  return unit ? (DEFAULT_RULES.heroes[unit.typeKey] ?? null) : null;
}

/** One of a hero's lines, picked from the battle's turn (the same on replay). */
function heroLine(state: BattleState, lines: readonly string[], salt: number): string {
  return lines.length === 0 ? '' : (lines[(state.turn * 7 + salt) % lines.length] as string);
}

/** Name of a hero ability or passive, by id. */
export function heroSkillName(id: string): string {
  for (const h of Object.values(DEFAULT_RULES.heroes)) {
    const a = h.abilities.find((x) => x.id === id);
    if (a) return a.name;
    if (h.passive.id === id) return h.passive.name;
  }
  return id;
}

export function describeEvent(event: GameEvent, state: BattleState): string | null {
  switch (event.type) {
    case 'abilityUsed': {
      const hero = heroRule(state, event.unitId);
      if (!hero) return null;
      const ability = hero.abilities.find((a) => a.id === event.abilityId);
      return `${hero.name} : ${ability?.name ?? event.abilityId} ! « ${heroLine(state, hero.lines.ability, event.affected.length)} »`;
    }
    case 'unitAttacked': {
      const who = unitLabel(state, event.attackerId);
      const whom = unitLabel(state, event.targetId);
      const how = event.reaction ? 'tire en garde sur' : event.riposte ? 'riposte contre' : 'attaque';
      const outcome = event.hit ? `${event.crit ? 'coup terrible, ' : ''}${event.damage} dégâts` : 'raté';
      return `${who} ${how} ${whom} (${Math.round(event.hitChance * 100)} %) : ${outcome}.`;
    }
    case 'structureDamaged': {
      const outcome = event.hit ? `${event.crit ? 'coup terrible, ' : ''}${event.damage} dégâts` : 'raté';
      return `${unitLabel(state, event.attackerId)} frappe ${structureObject(event.structureId)} (${Math.round(event.hitChance * 100)} %) : ${outcome}.`;
    }
    case 'structureBroken':
      return event.kind === 'wall'
        ? `La muraille s’effondre !${event.fallen.length > 0 ? ` ${event.fallen.length} homme${event.fallen.length > 1 ? 's' : ''} précipité${event.fallen.length > 1 ? 's' : ''} dans la chute.` : ''}`
        : event.kind === 'drawbridge'
          ? 'Le pont-levis s’abat sur la douve !'
          : `${STRUCTURE_LABEL[event.kind]} cède !`;
    case 'siegeWorkProgressed':
      return event.kind === 'fill'
        ? `${unitLabel(state, event.unitId)} jette des fagots dans la douve (${event.progress}/${event.required}).`
        : `${unitLabel(state, event.unitId)} mine la muraille (${event.progress}/${event.required}).`;
    case 'moatFilled':
      return 'La douve est comblée : une chaussée de fagots la traverse.';
    case 'towerDocked':
      return 'Le beffroi abaisse son pont sur le haut du mur !';
    case 'towerUndocked':
      return 'Le beffroi n’a plus de mur où s’accoler.';
    case 'unitClimbed':
      return `${unitLabel(state, event.unitId)} monte à l’assaut par le beffroi.`;
    case 'fireArrowShot':
      return `${unitLabel(state, event.unitId)} tire une flèche enflammée (${Math.round(event.hitChance * 100)} %) : ${event.caught ? 'ça prend !' : 'elle s’éteint.'}`;
    case 'fireStarted':
      return event.cells.length > 1 ? `Le feu gagne (${event.cells.length} foyers).` : null;
    case 'fireOut':
      return event.byId ? `${unitLabel(state, event.byId)} étouffe le feu.` : null;
    case 'unitBurned':
      return `${unitLabel(state, event.unitId)} brûle : ${event.damage} dégâts.`;
    case 'structureBurned':
      return `Le feu ronge ${structureObject(event.structureId)} (solidité ${event.hpAfter}).`;
    case 'unitDied': {
      const hero = heroRule(state, event.unitId);
      if (hero) return `${hero.name} est gravement ${hero.feminine ? 'blessée' : 'blessé'} et quitte le champ de bataille. « ${heroLine(state, hero.lines.wounded, 0)} »`;
      const killer = event.byId && event.byId !== event.unitId ? heroRule(state, event.byId) : null;
      return `${unitLabel(state, event.unitId)} tombe.${killer ? ` ${killer.name} : « ${heroLine(state, killer.lines.kill, event.unitId.length)} »` : ''}`;
    }
    case 'unitMoved':
      return event.fleeing ? `${unitLabel(state, event.unitId)} fuit !` : null;
    case 'moraleChanged': {
      // Only a change of standing matters to the player (shaken: fewer points of action; fleeing: no orders).
      const before = moraleStanding(DEFAULT_RULES.morale, event.morale - event.delta);
      const after = moraleStanding(DEFAULT_RULES.morale, event.morale);
      if (before === after) return null;
      const who = unitLabel(state, event.unitId);
      if (after === 'fleeing') return `${who} perd pied !`;
      const shaken = heroRule(state, event.unitId)?.feminine ? 'ébranlée' : 'ébranlé';
      if (after === 'shaken') return before === 'fleeing' ? `${who} se reprend, ${shaken}.` : `${who} est ${shaken} (−${actionPoints(DEFAULT_RULES.morale.shakenApPenalty)}).`;
      return `${who} se ressaisit.`;
    }
    case 'turnStarted':
      return `Tour ${event.turn} : ${FACTION_LABEL[event.faction]}.`;
    case 'battleEnded':
      return END_LABEL[event.status][event.reason];
    case 'commandRejected':
      return REJECTION_LABEL[event.reason];
    default:
      return null;
  }
}
