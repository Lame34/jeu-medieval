/**
 * The lexicon of the siege (ADR-046): every period word of the game, its meaning and the work in
 * which it is first found, as the Trésor de la langue française dates it.
 */
import { GLOSSARY } from '../../data/index.ts';
import { IronFrame } from '../components/IronFrame.tsx';
import { navigate, ROUTES } from '../router.ts';
import './options.css';
import './lexicon.css';

export default function LexiconScreen() {
  const terms = [...GLOSSARY.terms].sort((a, b) => a.word.localeCompare(b.word, 'fr'));
  return (
    <main className="options-screen">
      <section className="options-panel lexicon-panel parchment-sheet" aria-labelledby="lexicon-title">
        <IronFrame />
        <header className="options-head">
          <button type="button" className="options-back" onClick={() => navigate(ROUTES.title)}>
            ← Menu
          </button>
          <h1 id="lexicon-title">Lexique du siège</h1>
        </header>
        <p className="lexicon-lead">Les mots du jeu sont ceux des XIIᵉ et XIIIᵉ siècles. Voici leur sens, et l’œuvre où on les trouve pour la première fois, d’après le Trésor de la langue française. Dans les textes du jeu, un mot souligné de points donne son sens au survol.</p>
        <dl className="lexicon">
          {terms.map((t) => (
            <div key={t.id} className="lexicon__entry">
              <dt>{t.word}</dt>
              <dd>
                {t.definition} <em>Attesté {t.attested}.</em>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
