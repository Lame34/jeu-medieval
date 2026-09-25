import { IronFrame } from '../components/IronFrame.tsx';
import { PaintedBackdrop } from '../components/PaintedBackdrop.tsx';
import { navigate, ROUTES } from '../router.ts';
import './screens.css';

interface MenuEntry {
  readonly label: string;
  readonly hint: string;
  readonly action?: () => void;
}

const MENU: readonly MenuEntry[] = [
  { label: 'Campagne', hint: 'Quatre châteaux à faire tomber' },
  { label: 'Bataille d’essai', hint: 'Une carte générée, un château à prendre', action: () => navigate(ROUTES.battle) },
  { label: 'Atelier du peintre', hint: 'Scène de look-dev', action: () => navigate(ROUTES.lookdev) },
  { label: 'Options', hint: 'Graphismes, touches, accessibilité' },
];

export function TitleScreen() {
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
          {MENU.map((entry) => (
            <button
              key={entry.label}
              type="button"
              className="title-menu__item"
              onClick={entry.action}
              disabled={!entry.action}
              aria-describedby={`hint-${entry.label}`}
            >
              <span className="title-menu__label">{entry.label}</span>
              <span id={`hint-${entry.label}`} className="title-menu__hint">
                {entry.action ? entry.hint : 'Bientôt'}
              </span>
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
