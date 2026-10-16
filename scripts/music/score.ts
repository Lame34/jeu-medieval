/**
 * The tunes of the soundtrack read from their transcription (scripts/music/tunes.json, ADR-051):
 * HAUTEUR:DURÉE tokens in quarter notes, rests, ornaments, bar lines. Each bar is checked against
 * the tune's meter (a bar marked ^ may be partial: an upbeat, the end before a repeat), so that a
 * slip in the transcription stops the render instead of reaching the game.
 */

/** A note or a rest of a tune, its start and length in quarter notes from the tune's start. */
export interface ScoreNote {
  readonly start: number;
  readonly length: number;
  /** MIDI pitch, or null for a rest. */
  readonly midi: number | null;
  /** A short ornament note played at the head of the following note. */
  readonly grace: boolean;
  /** Which section of the form it belongs to (« A », « B »…). */
  readonly section: string;
  /** Its bar's first beat, from the tune's start. */
  readonly barStart: number;
}

export interface TuneData {
  readonly title: string;
  readonly author: string;
  readonly source: string;
  /** Beats a bar and the beat's unit, as written: [3, 4], [6, 4]. */
  readonly meter: readonly [number, number];
  readonly sections: Readonly<Record<string, string>>;
  readonly form: readonly string[];
}

export interface Tune {
  readonly id: string;
  readonly data: TuneData;
  readonly notes: readonly ScoreNote[];
  /** The whole form's length, in quarter notes. */
  readonly length: number;
  /** Quarter notes a bar. */
  readonly bar: number;
  /** Where the bars fall: the first full bar's start, within a bar (after an upbeat). */
  readonly downbeat: number;
}

const NAMES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Rounding slack when bars of thirds are added up. */
const EPSILON = 1e-6;

/** « Bb4 » → 70, « F#3 » → 54, « C4 » → 60. */
export function midiOf(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`not a pitch: ${name}`);
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + (NAMES[m[1]!] ?? 0) + accidental;
}

function lengthOf(text: string, where: string): number {
  const m = /^(\d+)(?:\/(\d+))?$|^(\d*\.\d+)$/.exec(text);
  if (!m) throw new Error(`${where}: not a length: ${text}`);
  const value = m[3] !== undefined ? Number(m[3]) : Number(m[1]) / Number(m[2] ?? 1);
  if (!(value > 0)) throw new Error(`${where}: empty length`);
  return value;
}

/** One section's notes, from `offset`, its bars checked against the meter. */
function readSection(id: string, section: string, text: string, bar: number, offset: number): { notes: ScoreNote[]; length: number; firstFull: number | null } {
  const notes: ScoreNote[] = [];
  let t = offset;
  let firstFull: number | null = null;
  text.split('|').forEach((rawBar, b) => {
    const where = `${id}.${section}, bar ${b + 1}`;
    const tokens = rawBar.trim().split(/\s+/).filter(Boolean);
    const partial = tokens[0]?.startsWith('^') ?? false;
    const barStart = t;
    let graces: number[] = [];
    for (const raw of tokens) {
      const token = raw.replace(/^\^/, '');
      if (token.startsWith('~')) {
        graces.push(midiOf(token.slice(1)));
        continue;
      }
      const [pitch, len] = token.split(':');
      if (!pitch || !len) throw new Error(`${where}: not a note: ${raw}`);
      const length = lengthOf(len, where);
      for (const g of graces) notes.push({ start: t, length: 0, midi: g, grace: true, section, barStart });
      graces = [];
      notes.push({ start: t, length, midi: pitch === 'r' ? null : midiOf(pitch), grace: false, section, barStart });
      t += length;
    }
    if (graces.length > 0) throw new Error(`${where}: an ornament with no note after it`);
    const filled = t - barStart;
    if (!partial && Math.abs(filled - bar) > EPSILON) throw new Error(`${where}: ${filled} beats, ${bar} expected`);
    if (!partial && firstFull === null) firstFull = barStart;
    if (partial && filled > bar + EPSILON) throw new Error(`${where}: a partial bar longer than a bar`);
  });
  return { notes, length: t - offset, firstFull };
}

/** A tune of the list, its form unrolled into notes. */
export function readTune(id: string, data: TuneData): Tune {
  const bar = (data.meter[0] * 4) / data.meter[1];
  const notes: ScoreNote[] = [];
  let t = 0;
  let downbeat: number | null = null;
  for (const section of data.form) {
    const text = data.sections[section];
    if (text === undefined) throw new Error(`${id}: no section ${section}`);
    const read = readSection(id, section, text, bar, t);
    notes.push(...read.notes);
    if (downbeat === null && read.firstFull !== null) downbeat = read.firstFull % bar;
    t += read.length;
  }
  return { id, data, notes, length: t, bar, downbeat: downbeat ?? 0 };
}
