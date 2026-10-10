/**
 * The trial battle's lessons (J6): Guillaume teaches the siege step by step, on a map that is
 * always the same. Each lesson can wait for something the player does (a flag of the record,
 * set from the battle's events and the interface), point the camera at what it is about and
 * light up a part of the HUD.
 */
import type { ReactNode } from 'react';
import { DEFAULT_RULES } from '../../data/index.ts';

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
const { shakenBelow, fleeBelow } = DEFAULT_RULES.morale;
const s = DEFAULT_RULES.structures;
const catapultRange = DEFAULT_RULES.units['catapult']?.attack?.rangeM ?? 0;

export function tutorialSteps(turnLimit: number): readonly TutorialStep[] {
  return [
    {
      id: 'welcome',
      title: 'Bienvenue au Fortin du Gué',
      text: (
        <>
          Approche, recrue. Une bande de brigands tient ce vieux fortin : on va le prendre ensemble, pas à pas. Pour gagner, anéantis la garnison ou mets-la en fuite avant le <strong>tour {turnLimit}</strong>.
        </>
      ),
    },
    {
      id: 'camera',
      title: 'Regarder le terrain',
      text: (
        <>
          Déplace la caméra avec <kbd>Z</kbd> <kbd>Q</kbd> <kbd>S</kbd> <kbd>D</kbd> (ou les flèches), ou en touchant les bords de l’écran. La molette zoome ; <kbd>A</kbd> et <kbd>E</kbd> font pivoter. La mini-carte, en haut à gauche, y porte la caméra d’un clic.
        </>
      ),
      goal: { label: 'Déplacez la caméra', flag: 'cameraMoved' },
      highlight: 'minimap',
    },
    {
      id: 'select',
      title: 'Choisir une unité',
      text: <>Les hommes en bleu sont les tiens. Clique sur l’un d’eux : sa carte s’ouvre en bas, avec ses PV (points de vie), ses PA (points d’action, pour marcher et agir) et son moral.</>,
      goal: { label: 'Sélectionnez une unité bleue', flag: 'selected' },
      focus: 'army',
    },
    {
      id: 'move',
      title: 'Se déplacer',
      text: (
        <>
          Survole le sol : le contour clair montre où aller en gardant de quoi frapper, le contour sombre jusqu’où l’unité peut marcher. Chaque PA porte à {meters('Road')} m sur la route, {meters('Plain')} en plaine, {meters('Field')} dans un champ, {meters('Forest')} en forêt, et une montée coûte plus. Clique pour avancer.
        </>
      ),
      goal: { label: 'Déplacez une unité', flag: 'moved' },
      highlight: 'unitCard',
    },
    {
      id: 'attack',
      title: 'Frapper',
      text: <>Des brigands gardent le village, en rouge. Survole-en un, unité sélectionnée : l’aperçu donne la chance de toucher, les dégâts et le risque de riposte. La hauteur, le couvert (forêt, maison, haie) et l’armure comptent. Approche-toi et clique sur l’ennemi.</>,
      goal: { label: 'Attaquez un brigand', flag: 'attacked' },
      focus: 'outpost',
    },
    {
      id: 'guard',
      title: 'Monter la garde',
      text: (
        <>
          Un tireur qui garde ses PA peut monter la garde (<kbd>G</kbd>, ou le bouton de sa carte) : il tirera sur le premier ennemi qui entre dans son cône. De quoi couvrir une avance.
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
          Les pertes, les blessures, le feu et les murs qui tombent font baisser le moral. Sous {shakenBelow}, une unité est ébranlée et perd 1 PA ; sous {fleeBelow}, elle fuit et n’obéit plus. Une garnison en fuite, c’est une victoire, et un héros peut rallier nos hommes.
        </>
      ),
      highlight: 'log',
    },
    {
      id: 'heroes',
      title: 'Les héros',
      text: (
        <>
          Aude, Bertrand et moi avons chacun deux capacités sur notre carte (<kbd>1</kbd> et <kbd>2</kbd>), qui se rechargent en quelques tours, et un talent toujours actif. Aude fait pleuvoir les flèches, Bertrand règle les engins et presse les travaux, je rallie et je charge. Sélectionne un héros et essaie une capacité.
        </>
      ),
      goal: { label: 'Utilisez une capacité de héros', flag: 'ability' },
      focus: 'army',
      highlight: 'unitCard',
    },
    {
      id: 'castle',
      title: 'Le château',
      text: <>Voici le fortin. Plusieurs voies pour y entrer : abattre le pont-levis, enfoncer la porte au bélier, ouvrir une brèche à la catapulte, saper un mur, ou monter sur le rempart par la tour de siège. Elles se combinent.</>,
      focus: 'castle',
    },
    {
      id: 'drawbridge',
      title: 'Le pont-levis',
      text: (
        <>
          L’archer de la tour de porte tient le treuil : abats-le, et le pont s’abat sur la douve. Un archer peut aussi y mettre le feu (<kbd>B</kbd>, flèche enflammée, +1 PA). Tant que le pont est levé, la porte est hors d’atteinte.
        </>
      ),
      goal: { label: 'Abattez le pont-levis', flag: 'bridgeDown' },
      focus: 'gate',
    },
    {
      id: 'ram',
      title: 'Le bélier',
      text: <>Le bélier n’enfonce que les portes : la porte d’abord, puis la herse derrière elle. Son toit le protège des flèches, pas des chevaliers qui sortent. Escorte-le.</>,
      goal: { label: 'Frappez la porte au bélier', flag: 'gateHit' },
      focus: 'park',
    },
    {
      id: 'catapult',
      title: 'La catapulte',
      text: <>Elle tire en cloche jusqu’à {catapultRange} m, par-dessus les murs. Une courtine se fissure, puis s’effondre en gravats qu’on peut franchir. Le vent dévie ses pierres ; Bertrand, à côté d’elle, règle son tir.</>,
      goal: { label: 'Frappez une courtine à la catapulte', flag: 'wallHit' },
      focus: 'park',
    },
    {
      id: 'works',
      title: 'Sapeurs et tour de siège',
      text: (
        <>
          Le sapeur comble la douve (<kbd>F</kbd>) en {s.fillTurns} tours, ou sape le pied d’un mur en {s.mineTurns}. Sur la douve comblée, pousse la tour de siège contre la courtine et amarre-la (<kbd>F</kbd>) : tes hommes y montent (<kbd>F</kbd>, à côté de la tour) et prennent pied sur le rempart.
        </>
      ),
      goal: { label: 'Lancez un travail de sape', flag: 'works' },
      focus: 'park',
    },
    {
      id: 'finish',
      title: 'À toi de jouer',
      text: <>Tu sais tout ce que je sais. Prends ce fortin ! Pas de hâte : la garnison est maigre, et tu as jusqu’au tour {turnLimit}.</>,
    },
  ];
}
