/**
 * The trial battle's lessons (J6): Guillaume teaches the siege step by step, on a map that is
 * always the same. Each lesson can wait for something the player does (a flag of the record,
 * set from the battle's events and the interface), point the camera at what it is about and
 * light up a part of the HUD.
 */
import type { ReactNode } from 'react';
import { DEFAULT_RULES } from '../../data/index.ts';
import { actionPoints } from '../battle/describe.ts';

/** What the player has done so far in the trial battle. */
export interface TutorialRecord {
  cameraMoved: boolean;
  selected: boolean;
  moved: boolean;
  attacked: boolean;
  guarded: boolean;
  turnEnded: boolean;
  ability: boolean;
  bridgeDown: boolean;
  gateHit: boolean;
  wallHit: boolean;
  works: boolean;
}

export const EMPTY_RECORD: TutorialRecord = { cameraMoved: false, selected: false, moved: false, attacked: false, guarded: false, turnEnded: false, ability: false, bridgeDown: false, gateHit: false, wallHit: false, works: false };

export type FocusTarget = 'army' | 'outpost' | 'castle' | 'gate' | 'park';
export type HudPart = 'minimap' | 'endTurn' | 'unitCard' | 'log' | 'banner';

export interface TutorialStep {
  readonly id: string;
  readonly title: string;
  readonly text: ReactNode;
  /** What to do, and the flag that says it is done (none: read and go on). */
  readonly goal?: { readonly label: string; readonly flag: keyof TutorialRecord };
  readonly focus?: FocusTarget;
  readonly highlight?: HudPart;
}

const meters = (layer: string) => DEFAULT_RULES.terrainLayers.find((l) => l.key === layer)?.metersPerAp.foot ?? 0;
const { shakenBelow, fleeBelow, shakenApPenalty } = DEFAULT_RULES.morale;
const s = DEFAULT_RULES.structures;
const catapultRange = DEFAULT_RULES.units['catapult']?.attack?.rangeM ?? 0;

/** "deux hommes debout": the garrison's surrender line in words. */
const NUMBERS = ['aucun homme', 'un homme', 'deux hommes', 'trois hommes', 'quatre hommes', 'cinq hommes'] as const;
const surrenderLine = (n: number) => `${NUMBERS[n] ?? `${n} hommes`} debout`;

export function tutorialSteps(turnLimit: number, surrendersAt: number, keys: { readonly move: readonly string[]; readonly turn: readonly string[] }): readonly TutorialStep[] {
  return [
    {
      id: 'welcome',
      title: 'Bienvenue au Fortin du Gué',
      text: (
        <>
          Approche donc. Une bande de routiers tient ce vieux fortin : on va le prendre ensemble, pas à pas. Pour gagner, abats ou mets en fuite la garnison avant la fin du <strong>tour {turnLimit}</strong> ; quand il ne lui reste que {surrenderLine(surrendersAt)}, elle se rend. Le compte est en haut de l’écran.
        </>
      ),
    },
    {
      id: 'camera',
      title: 'Regarder le terrain',
      text: (
        <>
          Au pavé tactile, glisse deux doigts pour déplacer la vue, et pince-les pour la rapprocher. Les boutons sous la mini-carte la font pivoter, la rapprochent, et la ramènent sur tes hommes ; un clic sur la mini-carte y porte la vue. Au clavier :{' '}
          {keys.move.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}{' '}
          ou les flèches, et <kbd>{keys.turn[0]}</kbd>, <kbd>{keys.turn[1]}</kbd> pour pivoter.
        </>
      ),
      goal: { label: 'Déplacez la caméra', flag: 'cameraMoved' },
      highlight: 'minimap',
    },
    {
      id: 'select',
      title: 'Choisir un homme',
      text: <>Les hommes en bleu sont les tiens. Clique sur l’un d’eux : sa carte s’ouvre en bas, avec sa vie, ses points d’action (pour marcher et frapper) et son moral. Tu hésites ? Le bouton <strong>Conseil</strong> de sa carte (<kbd>C</kbd>) te dit ce que je ferais à sa place ; appuie encore, et il le fait.</>,
      goal: { label: 'Choisissez un homme en bleu', flag: 'selected' },
      focus: 'army',
    },
    {
      id: 'move',
      title: 'Se déplacer',
      text: (
        <>
          Survole le sol : le contour doré montre où aller en gardant de quoi frapper, le contour pâle jusqu’où il peut marcher. Chaque point d’action porte à {meters('Road')} m sur la route, {meters('Plain')} en plaine, {meters('Field')} dans un champ, {meters('Forest')} en forêt, et une montée coûte plus. Clique pour avancer. Pour mener plusieurs hommes à la fois, trace un cadre autour d’eux en glissant, le bouton enfoncé, ou ajoute-les un à un d’un clic, la touche Maj tenue : ils marchent en rang et frappent ensemble.
        </>
      ),
      goal: { label: 'Déplacez un homme', flag: 'moved' },
      highlight: 'unitCard',
    },
    {
      id: 'attack',
      title: 'Frapper',
      text: <>Des routiers gardent le village, en rouge. Survole-en un avec ton homme choisi : l’aperçu donne la chance de toucher, les dégâts et le risque de riposte. La hauteur, le couvert (forêt, maison, haie) et l’armure comptent. Clique sur l’ennemi : s’il est à sa portée ce tour, ton homme s’approche de lui-même, puis frappe ; le chemin s’affiche avant. Trop loin, avance d’abord.</>,
      goal: { label: 'Attaquez un routier', flag: 'attacked' },
      focus: 'outpost',
    },
    {
      id: 'guard',
      title: 'Monter la garde',
      text: (
        <>
          Un archer qui n’a pas encore agi ce tour peut monter la garde (<kbd>G</kbd>, ou le bouton de sa carte) : il tirera sur le premier ennemi qui entre dans son cône. De quoi couvrir une avance.
        </>
      ),
      goal: { label: 'Mettez un archer en garde', flag: 'guarded' },
      highlight: 'unitCard',
    },
    {
      id: 'end-turn',
      title: 'Finir le tour',
      text: (
        <>
          Quand tes hommes ont agi, clique sur <strong>Fin du tour</strong>, ou <kbd>Entrée</kbd> ; le bouton s’illumine quand plus personne ne peut agir. La garnison joue ensuite, et le journal, en bas à droite, raconte chaque coup.
        </>
      ),
      goal: { label: 'Terminez votre tour', flag: 'turnEnded' },
      highlight: 'endTurn',
    },
    {
      id: 'morale',
      title: 'Le moral',
      text: (
        <>
          Les pertes, les blessures, le feu et les murs qui tombent font baisser le moral. Sous {shakenBelow}, un homme est ébranlé et perd {actionPoints(shakenApPenalty)} ; sous {fleeBelow}, il fuit et n’obéit plus. Une garnison en fuite, c’est une victoire, et un héros peut rallier nos hommes.
        </>
      ),
      highlight: 'log',
    },
    {
      id: 'heroes',
      title: 'Les héros',
      text: (
        <>
          Aude, Bertrand et moi avons chacun deux capacités sur notre carte (<kbd>1</kbd> et <kbd>2</kbd>), qui reviennent après quelques tours, et un talent toujours actif. Aude fait pleuvoir les flèches, Bertrand règle les engins et presse les travaux, je rallie nos hommes et je mène l’assaut. Sélectionne un héros et essaie une capacité.
        </>
      ),
      goal: { label: 'Utilisez une capacité de héros', flag: 'ability' },
      focus: 'army',
      highlight: 'unitCard',
    },
    {
      id: 'castle',
      title: 'Le château',
      text: <>Voici le fortin. Plusieurs voies pour y entrer : abattre le pont-levis, enfoncer la porte au mouton, ouvrir une brèche au mangonneau, miner un mur, ou monter sur les murs par le beffroi. Elles se combinent. Et avant tout assaut, la coutume veut qu’on somme la garnison de rendre la place : ton héraut le fait d’un clic, sous « Fin du tour ». Plus elle a perdu d’hommes et de murs, plus elle cède volontiers.</>,
      focus: 'castle',
    },
    {
      id: 'drawbridge',
      title: 'Le pont-levis',
      text: (
        <>
          L’archer de la tour de porte tient les chaînes du pont : abats-le, et le pont s’abat sur la douve. Un archer peut aussi y mettre le feu (<kbd>B</kbd>, flèche enflammée, {actionPoints(DEFAULT_RULES.fire.arrowExtraAp)} de plus). Tant que le pont est levé, la porte est hors d’atteinte.
        </>
      ),
      goal: { label: 'Abattez le pont-levis', flag: 'bridgeDown' },
      focus: 'gate',
    },
    {
      id: 'ram',
      title: 'Le mouton',
      text: <>Le mouton, qu’on appellera plus tard « bélier », n’enfonce que les portes : la porte d’abord, puis la coulisse, la grille qui descend derrière elle. Clique sur la porte : s’il peut l’atteindre ce tour, il y roule de lui-même, puis frappe. Son toit le protège des flèches, pas des chevaliers qui sortent. Escorte-le.</>,
      goal: { label: 'Frappez la porte au mouton', flag: 'gateHit' },
      focus: 'park',
    },
    {
      id: 'catapult',
      title: 'Le mangonneau',
      text: <>Il tire en cloche jusqu’à {catapultRange} m, par-dessus les murs. Une muraille se fissure, puis s’effondre en gravats qu’on peut franchir. Le vent dévie ses pierres ; Bertrand, à côté de lui, corrige ses coups.</>,
      goal: { label: 'Frappez une muraille au mangonneau', flag: 'wallHit' },
      focus: 'park',
    },
    {
      id: 'works',
      title: 'Mineurs et beffroi',
      text: (
        <>
          Le mineur comble la douve en {s.fillTurns} tours, ou mine le pied d’un mur en {s.mineTurns} : <kbd>F</kbd>, puis clique sur l’endroit, et il s’y rend de lui-même. Sur la douve comblée, accole le beffroi à la muraille (<kbd>F</kbd>) : il s’y pousse s’il le peut ce tour. Tes hommes y montent (<kbd>F</kbd>) et prennent pied sur les murs.
        </>
      ),
      goal: { label: 'Mettez un mineur à l’ouvrage', flag: 'works' },
      focus: 'park',
    },
    {
      id: 'finish',
      title: 'À toi de jouer',
      text: <>Tu sais tout ce que je sais. Prends ce fortin ! Pas de hâte : la garnison est maigre, et tu as jusqu’au tour {turnLimit}.</>,
    },
  ];
}
