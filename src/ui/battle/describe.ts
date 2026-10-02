/** Journal lines (French) for core events. */
import type { BattleState } from '../../core/battle/types.ts';
import type { CommandRejection } from '../../core/commands/types.ts';
import type { GameEvent } from '../../core/events/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';

export const FACTION_LABEL = { attacker: 'Assaillants', defender: 'Défenseurs' } as const;

export const REJECTION_LABEL: Readonly<Record<CommandRejection, string>> = {
  battleOver: 'La bataille est terminée.',
  unknownUnit: 'Unité inconnue.',
  unitDead: 'Cette unité est tombée.',
  notYourTurn: "Ce n'est pas votre tour.",
  outOfBounds: 'Hors de la carte.',
  sameCell: "L'unité y est déjà.",
  destinationOccupied: 'Place déjà occupée.',
  noPath: 'Aucun chemin praticable.',
  insufficientAp: 'Pas assez de PA.',
  unknownTarget: 'Cible inconnue.',
  targetDead: 'La cible est déjà tombée.',
  targetFriendly: 'Cible alliée.',
  noAttack: "Cette unité n'attaque pas.",
  noActionLeft: 'Action déjà utilisée ce tour.',
  outOfRange: 'Hors de portée.',
  noLineOfSight: 'Pas de ligne de vue.',
  unitFleeing: "L'unité fuit et n'obéit plus.",
  cannotOverwatch: 'Seuls les tireurs peuvent monter la garde.',
  invalidDirection: 'Direction de garde invalide.',
  unknownStructure: 'Ouvrage inconnu.',
  structureDown: 'Cet ouvrage est déjà tombé.',
  structureInvulnerable: 'On ne peut pas abattre cet ouvrage : il faut tuer son treuilliste.',
  noSiegeWeapon: 'Seuls les engins de siège entament les murailles.',
  gatesOnly: "Le bélier n'enfonce que les portes.",
  structureShielded: "Un autre ouvrage le protège : d'abord le pont-levis, puis la porte.",
};

/** What a structure is called in the journal and the HUD. */
export const STRUCTURE_LABEL = { wall: 'Courtine', gate: 'Porte', portcullis: 'Herse', drawbridge: 'Pont-levis' } as const;

export const STRUCTURE_OBJECT = { wall: 'la courtine', gate: 'la porte', portcullis: 'la herse', drawbridge: 'le pont-levis' } as const;

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

export function describeEvent(event: GameEvent, state: BattleState): string | null {
  switch (event.type) {
    case 'unitAttacked': {
      const who = unitLabel(state, event.attackerId);
      const whom = unitLabel(state, event.targetId);
      const how = event.reaction ? 'tire en garde sur' : event.riposte ? 'riposte contre' : 'attaque';
      const outcome = event.hit ? `${event.crit ? 'critique, ' : ''}${event.damage} dégâts` : 'raté';
      return `${who} ${how} ${whom} (${Math.round(event.hitChance * 100)} %) : ${outcome}.`;
    }
    case 'structureDamaged': {
      const outcome = event.hit ? `${event.crit ? 'critique, ' : ''}${event.damage} dégâts` : 'raté';
      return `${unitLabel(state, event.attackerId)} frappe ${structureObject(event.structureId)} (${Math.round(event.hitChance * 100)} %) : ${outcome}.`;
    }
    case 'structureBroken':
      return event.kind === 'wall'
        ? `La courtine s'effondre !${event.fallen.length > 0 ? ` ${event.fallen.length} unité(s) précipitée(s).` : ''}`
        : event.kind === 'drawbridge'
          ? 'Le treuilliste est tombé : le pont-levis s’abat sur la douve !'
          : `${STRUCTURE_LABEL[event.kind]} cède !`;
    case 'unitDied':
      return `${unitLabel(state, event.unitId)} tombe.`;
    case 'overwatchSet':
      return `${unitLabel(state, event.unitId)} monte la garde.`;
    case 'unitMoved':
      return event.fleeing ? `${unitLabel(state, event.unitId)} fuit !` : null;
    case 'moraleChanged':
      return event.reason === 'recovery' || Math.abs(event.delta) < 10 ? null : `${unitLabel(state, event.unitId)} : moral ${event.delta > 0 ? '+' : ''}${Math.round(event.delta)}.`;
    case 'turnStarted':
      return `Tour ${event.turn} : ${FACTION_LABEL[event.faction]}.`;
    case 'battleEnded':
      return event.status === 'attackerWon' ? 'Victoire des assaillants !' : 'Victoire des défenseurs.';
    case 'commandRejected':
      return REJECTION_LABEL[event.reason];
    default:
      return null;
  }
}
