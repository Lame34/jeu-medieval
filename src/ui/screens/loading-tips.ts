/**
 * What the heroes tell while a battle loads: one true thing about the rules each, its figures read
 * from the rules themselves (they stay true when the balance moves).
 */
import { DEFAULT_RULES } from '../../data/index.ts';

export type TipSpeaker = 'heroKnight' | 'heroArcher' | 'heroEngineer';

export interface LoadingTip {
  readonly hero: TipSpeaker;
  readonly text: string;
}

const d = DEFAULT_RULES.damage;
const s = DEFAULT_RULES.structures;
const m = DEFAULT_RULES.morale;
const pct = (x: number) => `${Math.round(x * 100)} %`;

export const LOADING_TIPS: readonly LoadingTip[] = [
  { hero: 'heroKnight', text: 'Une garnison réduite à une poignée d’hommes se rend : nul besoin de traquer le dernier.' },
  { hero: 'heroArcher', text: `D’en haut, on tire plus loin et plus juste : ${pct(d.accuracyPerHeightStep)} de mieux tous les ${d.heightStepM} mètres.` },
  { hero: 'heroArcher', text: 'Sur une armure lourde, mes flèches glissent. Gardez-les pour les hommes vêtus de cuir.' },
  { hero: 'heroEngineer', text: `Une muraille qui s’effondre coûte ${s.collapseMoraleLoss} points de moral à tous les défenseurs à ${s.collapseMoraleRadiusM} mètres.` },
  { hero: 'heroEngineer', text: `${s.fillTurns} tours de fagots comblent un tronçon de douve ; ${s.mineTurns} tours de mine, et le mur tombe.` },
  { hero: 'heroEngineer', text: 'Le mouton n’a que faire des murs : menez-le à la porte, une fois le pont-levis abattu.' },
  { hero: 'heroEngineer', text: `Accolé à une muraille, le beffroi y fait monter ${s.towerCapacity} hommes par tour.` },
  { hero: 'heroKnight', text: 'Derrière une haie ou un muret, un homme est bien plus dur à toucher. Les leurs aussi.' },
  { hero: 'heroArcher', text: 'Sous la pluie, la corde tremble et le feu prend mal.' },
  { hero: 'heroKnight', text: 'La nuit, hors de la lueur des torches, on vise moins juste et les flèches portent moins loin.' },
  { hero: 'heroArcher', text: 'Une flèche enflammée dans le blé : le vent fait le reste. Regardez d’où il souffle.' },
  { hero: 'heroKnight', text: 'Un archer ou un arbalétrier en garde tire sur le premier qui entre dans son cône. Approchez à couvert.' },
  { hero: 'heroKnight', text: `Le moral fait les batailles : sous ${m.shakenBelow}, un homme traîne ; sous ${m.fleeBelow}, il fuit.` },
  { hero: 'heroKnight', text: 'Frappez le premier : la riposte de celui qu’on attaque est moins sûre.' },
  { hero: 'heroArcher', text: 'La touche Tab passe à l’homme suivant qui peut encore agir. Personne n’attend pour rien.' },
];
