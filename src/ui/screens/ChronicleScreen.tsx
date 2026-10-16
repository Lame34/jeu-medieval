/**
 * The illuminated chronicle (ADR-050): the campaign as a book, a chapter for each castle taken,
 * told from what really happened in its battle, with a miniature and a gilded initial drawn by
 * the game; its incipit in red, its explicit once the Val is free. It prints as it reads.
 */
import { Glossed } from '../components/Glossed.tsx';
import { CAMPAIGN } from '../../data/index.ts';
import { useCampaign } from '../../state/campaign.ts';
import { chronicleOf, type Chapter } from '../campaign/chronicle-text.ts';
import { Lettrine, Miniature } from '../campaign/Miniature.tsx';
import { navigate, ROUTES } from '../router.ts';
import './chronicle.css';

function ChapterView({ chapter }: { readonly chapter: Chapter }) {
  const [opening = '', ...rest] = chapter.paragraphs;
  return (
    <section className="chronicle__chapter" aria-label={chapter.heading}>
      <h2>{chapter.heading}</h2>
      <Miniature level={chapter.level} deeds={chapter.deeds} />
      <p className="chronicle__opening">
        {/* The initial is drawn: its paragraph is read whole from the hidden copy. */}
        <span aria-hidden="true">
          <Lettrine letter={opening.charAt(0)} />
          <Glossed>{opening.slice(1)}</Glossed>
        </span>
        <span className="chronicle__spoken">{opening}</span>
      </p>
      {rest.map((p) => (
        <p key={p}>
          <Glossed>{p}</Glossed>
        </p>
      ))}
    </section>
  );
}

export default function ChronicleScreen() {
  const conquered = useCampaign((s) => s.conquered);
  const { chapters, done } = chronicleOf(conquered);
  const texts = CAMPAIGN.chronicle;
  return (
    <main className="chronicle-screen">
      <nav className="chronicle-tools" aria-label="La chronique">
        <button type="button" onClick={() => navigate(ROUTES.campaign)}>
          ← La carte
        </button>
        <button type="button" onClick={() => window.print()} disabled={chapters.length === 0}>
          Imprimer la chronique
        </button>
      </nav>
      <article className="chronicle" aria-labelledby="chronicle-title">
        <h1 id="chronicle-title">{texts.title}</h1>
        <p className="chronicle__incipit">{texts.incipit}</p>
        <p className="chronicle__preface">
          <Glossed>{texts.preface}</Glossed>
        </p>
        {chapters.map((c) => (
          <ChapterView key={c.level.id} chapter={c} />
        ))}
        <p className="chronicle__explicit">{done ? texts.explicit : texts.unfinished}</p>
      </article>
    </main>
  );
}
