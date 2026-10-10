import { CAMPAIGN } from '../../data/index.ts';
import { useCampaign } from '../../state/campaign.ts';
import { IronFrame } from '../components/IronFrame.tsx';
import { PaintedBackdrop } from '../components/PaintedBackdrop.tsx';
import { navigate, ROUTES } from '../router.ts';
import './screens.css';

interface MenuEntry {
  readonly label: string;
  readonly hint: string;
  readonly action: () => void;
  /** A wax mark beside the entry ("Commencez ici"). */
  readonly mark?: string;
}

/** A skirmish's seed: a new castle every time (the URL keeps it, so "Rejouer" replays it). */
function skirmishSeed(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return `escarmouche-${(n[0] ?? 0).toString(36)}`;
}

export function TitleScreen() {
  const tutorialDone = useCampaign((s) => s.tutorialDone);
  const taken = useCampaign((s) => CAMPAIGN.levels.filter((l) => s.conquered[l.id]).length);
  const menu: readonly MenuEntry[] = [
    { label: 'Bataille d’essai', hint: 'Guillaume vous apprend le siège, pas à pas', action: () => navigate(ROUTES.battle, { tutorial: '' }), ...(tutorialDone ? {} : { mark: 'Commencez ici' }) },
    { label: 'Campagne', hint: taken > 0 ? `${taken} château${taken > 1 ? 'x' : ''} sur ${CAMPAIGN.levels.length} repris au Félon` : `Cinq châteaux à reprendre au ${CAMPAIGN.realm}`, action: () => navigate(ROUTES.campaign) },
    { label: 'Escarmouche', hint: 'Un château au hasard, sans histoire', action: () => navigate(ROUTES.battle, { seed: skirmishSeed() }) },
    { label: 'Options', hint: 'Graphismes, son, jeu, accessibilité', action: () => navigate(ROUTES.options) },
  ];
  return (
    <main className="title-screen">
      <PaintedBackdrop />
      <section className="title-panel parchment" aria-labelledby="game-title">
        <IronFrame />
        <h1 id="game-title" className="title-panel__title">
          Siège
        </h1>
        <p className="title-panel__tagline">Cinq voies pour prendre une forteresse</p>
        <nav className="title-menu" aria-label="Menu principal">
          {menu.map((entry, i) => (
            <button key={entry.label} type="button" className="title-menu__item" onClick={entry.action} aria-describedby={`title-hint-${i}`}>
              <span className="title-menu__label">{entry.label}</span>
              <span id={`title-hint-${i}`} className="title-menu__hint">
                {entry.hint}
              </span>
              {entry.mark && <span className="title-menu__mark">{entry.mark}</span>}
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
