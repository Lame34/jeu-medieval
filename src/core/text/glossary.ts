/**
 * The words of the siege (ADR-046): each period word of the game, its meaning and its first
 * attestation, checked in the TLF. The game finds them in its own texts to give their meaning on
 * hover; the lexicon lists them all. Pure: the interface only draws what this returns.
 */
import { obj, RulesValidationError, str, type Json } from '../rules/json.ts';

export interface Term {
  readonly id: string;
  /** The headword, as the lexicon shows it. */
  readonly word: string;
  /** The forms the game recognises in a text (lower case). */
  readonly forms: readonly string[];
  readonly definition: string;
  /** Where and when it is first found. */
  readonly attested: string;
}

export interface Glossary {
  readonly terms: readonly Term[];
}

/** A piece of a text: plain, or a glossary word (`termId`). */
export interface Segment {
  readonly text: string;
  readonly termId?: string;
}

export function validateGlossary(raw: unknown): Glossary {
  const root = obj(raw, 'glossary');
  if (!Array.isArray(root['terms'])) throw new RulesValidationError('glossary.terms', 'expected an array');
  const seenIds = new Set<string>();
  const seenForms = new Set<string>();
  const terms = (root['terms'] as unknown[]).map((t, i): Term => {
    const p = `glossary.terms[${i}]`;
    const o = obj(t, p) as Json;
    const id = str(o['id'], `${p}.id`);
    if (seenIds.has(id)) throw new RulesValidationError(`${p}.id`, `duplicate id "${id}"`);
    seenIds.add(id);
    if (!Array.isArray(o['forms']) || o['forms'].length === 0) throw new RulesValidationError(`${p}.forms`, 'expected a non-empty array');
    const forms = (o['forms'] as unknown[]).map((f, j) => {
      const form = str(f, `${p}.forms[${j}]`);
      if (form !== form.toLowerCase()) throw new RulesValidationError(`${p}.forms[${j}]`, 'expected lower case');
      if (seenForms.has(form)) throw new RulesValidationError(`${p}.forms[${j}]`, `form "${form}" already belongs to another word`);
      seenForms.add(form);
      return form;
    });
    return Object.freeze({ id, word: str(o['word'], `${p}.word`), forms: Object.freeze(forms), definition: str(o['definition'], `${p}.definition`), attested: str(o['attested'], `${p}.attested`) });
  });
  return Object.freeze({ terms: Object.freeze(terms) });
}

/** Letters of French words, and the hyphen: a form inside a longer word is not that word (an elided « l’ » before it is fine). */
const LETTER = /[\p{L}-]/u;

/**
 * `text` cut where glossary words stand: each word marked at its first occurrence only (`seen`
 * holds the words already marked by earlier texts of the same page, and is filled).
 */
export function glossSegments(text: string, glossary: Glossary, seen: Set<string> = new Set()): Segment[] {
  const lower = text.toLowerCase();
  const hits: { start: number; end: number; termId: string }[] = [];
  for (const term of glossary.terms) {
    if (seen.has(term.id)) continue;
    let first: { start: number; end: number } | null = null;
    for (const form of term.forms) {
      for (let at = lower.indexOf(form); at >= 0; at = lower.indexOf(form, at + 1)) {
        const before = at > 0 ? text.charAt(at - 1) : '';
        const after = text.charAt(at + form.length);
        if ((before && LETTER.test(before)) || (after && LETTER.test(after))) continue;
        if (!first || at < first.start) first = { start: at, end: at + form.length };
        break;
      }
    }
    if (first && !hits.some((h) => first.start < h.end && h.start < first.end)) hits.push({ ...first, termId: term.id });
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) out.push({ text: text.slice(cursor, h.start) });
    out.push({ text: text.slice(h.start, h.end), termId: h.termId });
    seen.add(h.termId);
    cursor = h.end;
  }
  if (cursor < text.length || out.length === 0) out.push({ text: text.slice(cursor) });
  return out;
}

export function termById(glossary: Glossary, id: string): Term | undefined {
  return glossary.terms.find((t) => t.id === id);
}
