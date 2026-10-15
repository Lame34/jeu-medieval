/**
 * The words of the siege (src/core/text/glossary.ts): the shipped lexicon is well formed, and the
 * game finds its words in a text at their first occurrence, whole words only.
 */
import { describe, expect, it } from 'vitest';
import { glossSegments, termById, validateGlossary, type Glossary } from '@core/text/glossary.ts';
import { RulesValidationError } from '@core/rules/json.ts';
import { GLOSSARY } from '@data/index.ts';
import raw from '@data/glossary.json' with { type: 'json' };

const tiny: Glossary = validateGlossary({
  terms: [
    { id: 'ost', word: 'Ost', forms: ['ost'], definition: 'L’armée.', attested: 'vers 1050' },
    { id: 'pont-levis', word: 'Pont-levis', forms: ['pont-levis'], definition: 'Le pont.', attested: 'vers 1200' },
    { id: 'mouton', word: 'Mouton', forms: ['mouton', 'moutons'], definition: 'L’engin.', attested: '1155' },
  ],
});
const marked = (text: string, g = tiny, seen = new Set<string>()) => glossSegments(text, g, seen).filter((s) => s.termId).map((s) => `${s.termId}:${s.text}`);

describe('the shipped lexicon', () => {
  it('is valid, each word with its meaning and its first attestation', () => {
    expect(GLOSSARY.terms.length).toBeGreaterThan(20);
    for (const t of GLOSSARY.terms) {
      expect(t.definition.length, t.id).toBeGreaterThan(10);
      expect(t.attested.length, t.id).toBeGreaterThan(3);
    }
    expect(termById(GLOSSARY, 'mouton')?.word).toBe('Mouton');
  });

  it('rejects a duplicate id, a form in capitals, a form claimed twice', () => {
    const clone = () => structuredClone(raw) as { terms: Record<string, unknown>[] };
    const dup = clone();
    dup.terms.push({ ...dup.terms[0] });
    expect(() => validateGlossary(dup)).toThrow(RulesValidationError);
    const caps = clone();
    caps.terms[0]!['forms'] = ['Mouton'];
    expect(() => validateGlossary(caps)).toThrow(/lower case/);
    const twice = clone();
    twice.terms[1]!['forms'] = twice.terms[0]!['forms'];
    expect(() => validateGlossary(twice)).toThrow(/another word/);
  });
});

describe('glossSegments', () => {
  it('marks each word at its first occurrence, whatever its case, and keeps the text whole', () => {
    const text = 'Le Mouton frappe ; un autre mouton attend, et l’ost regarde.';
    const segments = glossSegments(text, tiny);
    expect(segments.map((s) => s.text).join('')).toBe(text);
    expect(marked(text)).toEqual(['mouton:Mouton', 'ost:ost']);
  });

  it('only whole words: not inside a longer word, but after an elided article', () => {
    expect(marked('Les ostensoirs et le moutonnier.')).toEqual([]);
    expect(marked('Le pont-levis s’abat.')).toEqual(['pont-levis:pont-levis']);
    expect(marked('Deux moutons.')).toEqual(['mouton:moutons']);
  });

  it('a word marked in an earlier text of the page is not marked again', () => {
    const seen = new Set<string>();
    expect(marked('Le mouton.', tiny, seen)).toEqual(['mouton:mouton']);
    expect(marked('Encore le mouton.', tiny, seen)).toEqual([]);
  });

  it('a text without any word is one plain segment', () => {
    expect(glossSegments('Rien ici.', tiny)).toEqual([{ text: 'Rien ici.' }]);
    expect(glossSegments('', tiny)).toEqual([{ text: '' }]);
  });
});
