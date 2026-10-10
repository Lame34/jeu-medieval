/**
 * What a battle tells around its fight, by kind: a campaign castle's briefing (its lord, the plan
 * sealed at the council, the heroes resting) and its chronicle at the end (the castle's page, the
 * banners, a hero's words, the wounded); the tutorial's end; a skirmish's plain panel.
 */
import { bannersOf, woundedHeroes } from '../../core/campaign/scenario.ts';
import type { BattleState } from '../../core/battle/types.ts';
import { CAMPAIGN, DEFAULT_RULES } from '../../data/index.ts';
import type { BriefingContent, EndAction, EndContent } from '../battle/BattleHud.tsx';
import type { BattleMode } from './battle-setup.ts';
import { EffectList } from './Council.tsx';
import { stratagemLines } from './effects-text.ts';
import { HeroEmblem } from './HeroEmblem.tsx';

export interface StoryActions {
  readonly replay: () => void;
  readonly toMap: () => void;
  readonly toTitle: () => void;
}

export function briefingFor(mode: BattleMode, resting: readonly string[]): BriefingContent | null {
  if (mode.kind === 'tutorial') return null;
  if (mode.kind === 'skirmish') return { title: 'Prenez le château' };
  const { level, stratagem } = mode;
  const absent = resting.filter((h) => DEFAULT_RULES.heroes[h]);
  return {
    title: `${level.name}, ${level.epithet}`,
    lead: (
      <>
        <p className="hud-briefing-lead">
          « {level.lordLine} » — {level.lord}
        </p>
        {stratagem && (
          <>
            <p>
              <strong>Plan scellé :</strong> {stratagem.name} ({DEFAULT_RULES.heroes[stratagem.hero]?.name}).
            </p>
            <EffectList lines={stratagemLines(stratagem)} />
          </>
        )}
        {absent.map((h) => (
          <p key={h} className="hud-detail">
            {CAMPAIGN.heroLines[h]?.resting}
          </p>
        ))}
      </>
    ),
  };
}

function BannersEarned({ battle }: { readonly battle: BattleState }) {
  const b = bannersOf(CAMPAIGN, battle);
  const items = [
    { won: b.taken, label: 'Pris' },
    { won: b.swift, label: `Avant le tour ${Math.ceil(battle.turnLimit * CAMPAIGN.banners.swiftShare)}` },
    { won: b.spared, label: `≤ ${CAMPAIGN.banners.maxLosses} pertes` },
  ];
  return (
    <ul className="hud-end-banners" aria-label="Étendards gagnés">
      {items.map((i) => (
        <li key={i.label} data-won={i.won || undefined}>
          <svg viewBox="0 0 16 22" width="16" height="22" aria-hidden="true">
            <path d="M1,1 h14 v20 l-7,-5 l-7,5z" />
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function endFor(mode: BattleMode, battle: BattleState, go: StoryActions): EndContent {
  const won = battle.status === 'attackerWon';
  const replay: EndAction = { label: 'Rejouer', onClick: go.replay };
  if (mode.kind === 'skirmish') return { actions: [replay, { label: 'Retour', onClick: go.toTitle }] };
  if (mode.kind === 'tutorial') {
    return {
      title: won ? 'Leçon réussie' : 'Leçon à reprendre',
      story: <p className="hud-end-story">{won ? mode.battle.victory : mode.battle.defeat}</p>,
      actions: won ? [{ label: 'Commencer la campagne', onClick: go.toMap, primary: true }, replay, { label: 'Menu', onClick: go.toTitle }] : [{ label: 'Réessayer', onClick: go.replay, primary: true }, { label: 'Menu', onClick: go.toTitle }],
    };
  }
  const { level, stratagem } = mode;
  // A hero speaks: the one whose plan it was, or the old knight.
  const speaker = stratagem?.hero ?? 'heroKnight';
  const lines = CAMPAIGN.heroLines[speaker];
  const said = lines ? (won ? lines.victory : lines.defeat) : [];
  const line = said[battle.turn % Math.max(1, said.length)];
  const wounded = woundedHeroes({ rules: DEFAULT_RULES }, battle);
  const last = CAMPAIGN.levels[CAMPAIGN.levels.length - 1]?.id === level.id;
  return {
    title: won ? `${level.name} est pris !` : 'L’assaut a échoué',
    story: (
      <>
        <p className="hud-end-story">{won ? level.victory : level.defeat}</p>
        {won && last && <p className="hud-end-story">{CAMPAIGN.epilogue}</p>}
      </>
    ),
    extra: (
      <>
        {won && <BannersEarned battle={battle} />}
        {line && (
          <p className="hud-end-hero">
            <HeroEmblem hero={speaker} size={36} /> {DEFAULT_RULES.heroes[speaker]?.name} : « {line} »
          </p>
        )}
        {wounded.map((h) => (
          <p key={h} className="hud-end-note">
            {DEFAULT_RULES.heroes[h]?.name} est gravement {DEFAULT_RULES.heroes[h]?.feminine ? 'blessée' : 'blessé'} : {DEFAULT_RULES.heroes[h]?.feminine ? 'elle' : 'il'} manquera la prochaine bataille.
          </p>
        ))}
      </>
    ),
    actions: won ? [{ label: 'Retour à la carte', onClick: go.toMap, primary: true }, replay] : [{ label: 'Reprendre l’assaut', onClick: go.replay, primary: true }, { label: 'Retour à la carte', onClick: go.toMap }],
  };
}
