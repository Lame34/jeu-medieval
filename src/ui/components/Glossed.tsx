/**
 * The words of the siege in the game's texts (ADR-046): each glossary word, at its first
 * occurrence in a text, is underlined; on hover or focus (a tap on a touchpad) it shows its meaning
 * and its first attestation. The note is drawn over the whole page (a portal), placed in the
 * screen when it opens: the letters and the lessons, which clip what overflows, never cut it.
 */
import { cloneElement, Fragment, isValidElement, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { glossSegments, termById, type Term } from '../../core/text/glossary.ts';
import { GLOSSARY } from '../../data/index.ts';
import './glossed.css';

/** The note's width (px, as in glossed.css), its gap to the word and to the screen's edges. */
const TIP_WIDTH_PX = 300;
const TIP_GAP_PX = 6;
const TIP_MARGIN_PX = 8;
/** A word lower than this share of the screen opens its note above it. */
const OPEN_ABOVE_FROM = 0.6;

type TipPlace = { readonly left: number; readonly top?: number; readonly bottom?: number };

export function TermWord({ term, children }: { readonly term: Term; readonly children: ReactNode }) {
  const id = useId();
  const word = useRef<HTMLSpanElement | null>(null);
  const [place, setPlace] = useState<TipPlace | null>(null);
  const open = () => {
    const r = word.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(TIP_MARGIN_PX, Math.min(r.left + r.width / 2 - TIP_WIDTH_PX / 2, window.innerWidth - TIP_WIDTH_PX - TIP_MARGIN_PX));
    setPlace(r.bottom > window.innerHeight * OPEN_ABOVE_FROM ? { left, bottom: window.innerHeight - r.top + TIP_GAP_PX } : { left, top: r.bottom + TIP_GAP_PX });
  };
  const close = () => setPlace(null);
  return (
    <span ref={word} className="term" tabIndex={0} aria-describedby={id} onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      {children}
      {createPortal(
        <span className="term__tip" role="tooltip" id={id} hidden={!place} style={place ?? undefined}>
          <strong>{term.word}</strong> : {term.definition} <em>Attesté {term.attested}.</em>
        </span>,
        document.body,
      )}
    </span>
  );
}

/** Keyboard keys and the like are never glossed. */
const UNGLOSSED = new Set(['kbd', 'code']);

function gloss(node: ReactNode, seen: Set<string>): ReactNode {
  if (typeof node === 'string') {
    return glossSegments(node, GLOSSARY, seen).map((s, i) => {
      const term = s.termId ? termById(GLOSSARY, s.termId) : undefined;
      return term ? (
        <TermWord key={i} term={term}>
          {s.text}
        </TermWord>
      ) : (
        <Fragment key={i}>{s.text}</Fragment>
      );
    });
  }
  if (Array.isArray(node)) return node.map((n, i) => <Fragment key={i}>{gloss(n, seen)}</Fragment>);
  if (!isValidElement(node)) return node;
  // Into plain elements (strong, em…) and fragments; never into keys, nor into components.
  const plain = typeof node.type === 'string' ? !UNGLOSSED.has(node.type) : node.type === Fragment;
  if (!plain) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  return cloneElement(element, undefined, gloss(element.props.children, seen));
}

/** `children` with the glossary's words marked (each once in the whole of `children`). */
export function Glossed({ children }: { readonly children: ReactNode }) {
  return <>{gloss(children, new Set())}</>;
}
