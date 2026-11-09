import { CAMPAIGN } from '../../data/index.ts';
import { useState } from 'react';
import { clearBattleSave, loadBattleSave, resumeParams, savedAtLabel } from '../../state/battle-save.ts';
import { useCampaign } from '../../state/campaign.ts';
import { IronFrame } from '../components/IronFrame.tsx';
import { navigate, ROUTES } from '../router.ts';
import './screens.css';

interface MenuEntry {
  readonly label: string;
  readonly hint: string;
  readonly action: () => void;
  /** A wax mark beside the entry ("Commencez ici"). */
  readonly mark?: string;
}

const startTutorial = () => navigate(ROUTES.battle, { tutorial: '' });

/**
 * The title menu (ADR-054): the trial battle, the campaign, the options, and a small button for
 * the lexicon. A battle left unfinished is offered by the trial battle's entry: continue it, or
 * start a new trial battle in its place.
 */
export function TitleScreen() {
  const tutorialDone = useCampaign((s) => s.tutorialDone);
  const taken = useCampaign((s) => CAMPAIGN.levels.filter((l) => s.conquered[l.id]).length);
  const [saved] = useState(loadBattleSave);
  const [choosing, setChoosing] = useState(false);
  const menu: readonly MenuEntry[] = [
    {
      label: 'Bataille d’essai',
      hint: saved ? `Ou continuer la bataille en cours : ${saved.title}, au tour ${saved.turn}` : 'Guillaume vous apprend le siège, pas à pas',
      action: saved ? () => setChoosing(true) : startTutorial,
      ...(tutorialDone ? {} : { mark: 'Commencez ici' }),
    },
    { label: 'Campagne', hint: taken > 0 ? `${taken} château${taken > 1 ? 'x' : ''} sur ${CAMPAIGN.levels.length} repris au Félon` : `Cinq châteaux à reprendre au ${CAMPAIGN.realm}`, action: () => navigate(ROUTES.campaign) },
    { label: 'Options', hint: 'Graphismes, son, jeu, accessibilité', action: () => navigate(ROUTES.options) },
  ];
  // The trial battle's question, when a battle was left unfinished.
  const choice: readonly MenuEntry[] = saved
    ? [
        { label: 'Continuer la bataille', hint: `${saved.title}, au tour ${saved.turn}`, action: () => navigate(ROUTES.battle, resumeParams(saved)) },
        {
          label: 'Nouvelle bataille d’essai',
          hint: 'La bataille en cours sera abandonnée',
          action: () => {
            clearBattleSave();
            startTutorial();
          },
        },
      ]
    : [];
  return (
    <main className="title-screen">
      {/* Haute-Garde at the golden hour, rendered by the game itself (scripts/capture-title.ts). */}
      <div className="title-screen__art" aria-hidden="true" />
      <section className="title-panel parchment-sheet" aria-labelledby="game-title">
        <IronFrame />
        <h1 id="game-title" className="title-panel__title">
          Siège
        </h1>
        <p className="title-panel__tagline">Cinq voies pour prendre une forteresse</p>
        {choosing && saved ? (
          <section className="title-choice" aria-labelledby="title-choice-lead">
            <p id="title-choice-lead" className="title-choice__lead">
              Une bataille est en cours : {saved.title}, laissée au tour {saved.turn}, {savedAtLabel(saved.savedAt)}.
            </p>
            <MenuButtons entries={choice} label="Continuer ou recommencer" />
            <button type="button" className="title-panel__small" onClick={() => setChoosing(false)}>
              Retour
            </button>
          </section>
        ) : (
          <>
            <MenuButtons entries={menu} label="Menu principal" />
            <button type="button" className="title-panel__small" onClick={() => navigate(ROUTES.lexicon)}>
              Le lexique des mots du siège
            </button>
          </>
        )}
      </section>
    </main>
  );
}

function MenuButtons({ entries, label }: { readonly entries: readonly MenuEntry[]; readonly label: string }) {
  return (
    <nav className="title-menu" aria-label={label}>
      {entries.map((entry, i) => (
        <button key={entry.label} type="button" className="title-menu__item" onClick={entry.action} aria-describedby={`title-hint-${i}`}>
          <span className="title-menu__label">{entry.label}</span>
          <span id={`title-hint-${i}`} className="title-menu__hint">
            {entry.hint}
          </span>
          {entry.mark && <span className="title-menu__mark">{entry.mark}</span>}
        </button>
      ))}
    </nav>
  );
}
