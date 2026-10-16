/**
 * Renders the soundtrack (ADR-051): the period tunes of scripts/music/tunes.json, arranged as
 * scripts/music/arrangements.json says, played on the VCSL samples (CC0, fetched by
 * scripts/fetch-music-samples.ts) in a stone hall, written as WAV into assets-src/work/music/.
 * The audio pipeline (npm run assets:audio) then levels and encodes them like every sound.
 * A loop ends where it began: the hall's ringing past its end is laid over its start. Notes are
 * humanised a little, the same way on every render (a seeded generator).
 * Usage: node scripts/render-music.ts [--only <id>]
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { addNote, level, mixInto, peak, RATE, readWav, reverb, stereo, writeWav, type ReverbSettings, type Sample, type Stereo } from './music/dsp.ts';
import { vcslPitch } from './music/bank.ts';
import { midiOf, readTune, type ScoreNote, type Tune, type TuneData } from './music/score.ts';

const SAMPLE_ROOT = 'assets-src/raw/vcsl';
const OUT = 'assets-src/work/music';

/** An ornament note's length (s), taken from the head of the note it adorns. */
const GRACE_S = 0.075;
/** Humanising: timing spread (s), loudness spread (share), the downbeat's accent. */
const JITTER_S = 0.006;
const VELOCITY_SPREAD = 0.07;
const BAR_ACCENT = 0.12;
const BASE_VELOCITY = 0.82;
/** A note shorter than this (beats) is folded into the previous one when a voice simplifies. */
const SIMPLE_BEAT = 1;
/** Past a loop's end, the ringing kept to lay over its start (s); past a closing piece, its fade (s). */
const LOOP_TAIL_S = 8;
const END_FADE_S = 1.5;
/** The loudest a render is written (−1 dBFS), and the loudness the audio pipeline gives music (its manifest). */
const PEAK = 0.89;
const MUSIC_RMS = Math.pow(10, (JSON.parse(readFileSync('scripts/audio-manifest.json', 'utf8')) as { targets: { music: number } }).targets.music / 20);
/** Loudness is measured over windows of this many frames, those within this many dB of the loudest. */
const LOUDNESS_WINDOW = 2048;
const LOUDNESS_FLOOR_DB = 30;

/** A voice's loudness where it plays: the mean power of its windows near its loudest (silences left out). */
function activeLoudness(s: Stereo, from: number, to: number): number {
  const powers: number[] = [];
  for (let w = from; w + LOUDNESS_WINDOW <= to; w += LOUDNESS_WINDOW) {
    let p = 0;
    for (let i = w; i < w + LOUDNESS_WINDOW; i++) p += s.left[i]! * s.left[i]! + s.right[i]! * s.right[i]!;
    powers.push(p / (2 * LOUDNESS_WINDOW));
  }
  const max = Math.max(0, ...powers);
  if (max === 0) return 0;
  const active = powers.filter((p) => p >= max * Math.pow(10, -LOUDNESS_FLOOR_DB / 10));
  return Math.sqrt(active.reduce((a, p) => a + p, 0) / active.length);
}

interface InstrumentDef {
  readonly group: string;
  readonly attack: number;
  readonly release: number;
  readonly sustain: boolean;
}
interface HitDef {
  readonly files: readonly string[];
  readonly gain: number;
}
type PatternHit = readonly [number, string, number];

interface VoiceBase {
  /** Its loudness against the pass's lead (its first melody), in dB: the mix is staged by measure. */
  readonly level?: number;
  readonly pan?: number;
  readonly sections?: readonly string[];
}
type Voice =
  | (VoiceBase & { readonly type: 'melody'; readonly instrument: string; readonly transpose?: number; readonly legato?: number; readonly simplify?: boolean })
  | (VoiceBase & { readonly type: 'drone'; readonly instrument: string; readonly notes: readonly string[]; readonly bars: number })
  | (VoiceBase & { readonly type: 'pluck'; readonly instrument: string; readonly notes: readonly string[]; readonly pattern: readonly (readonly [number, number, number])[] })
  | (VoiceBase & { readonly type: 'drums'; readonly pattern?: string; readonly hits?: readonly PatternHit[] })
  | (VoiceBase & { readonly type: 'bells'; readonly hits: readonly (readonly [number, string, number])[] });

interface TrackDef {
  readonly id: string;
  readonly title: string;
  readonly tune: string;
  readonly bpm: number;
  readonly loop: boolean;
  /** Only these beats of the tune [from, to). */
  readonly excerpt?: readonly [number, number];
  /** The last beats slowed: [beats, factor]. */
  readonly slowLast?: readonly [number, number];
  readonly tailS?: number;
  readonly reverb: ReverbSettings;
  readonly passes: readonly (readonly Voice[])[];
}
interface Arrangements {
  readonly instruments: Readonly<Record<string, InstrumentDef>>;
  readonly hits: Readonly<Record<string, HitDef>>;
  readonly patterns: Readonly<Record<string, readonly PatternHit[]>>;
  readonly tracks: readonly TrackDef[];
}
interface SampleList {
  readonly groups: Readonly<Record<string, readonly { readonly path: string }[]>>;
}

const tunes = (JSON.parse(readFileSync('scripts/music/tunes.json', 'utf8')) as { tunes: Record<string, TuneData> }).tunes;
const arr = JSON.parse(readFileSync('scripts/music/arrangements.json', 'utf8')) as Arrangements;
const list = JSON.parse(readFileSync('scripts/music/samples.json', 'utf8')) as SampleList;
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : undefined;

/** mulberry32: the humanising's numbers, the same on every render of a track. */
function random(seedText: string): () => number {
  let a = [...seedText].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The samples, read once each.
const cache = new Map<string, Sample>();
function sampleAt(path: string, midi: number | null): Sample {
  let s = cache.get(path);
  if (!s) {
    s = readWav(join(SAMPLE_ROOT, path), midi);
    cache.set(path, s);
  }
  return s;
}
/** The group's sample nearest to `midi`, and the semitones to shift it by. */
function pitched(group: string, midi: number): { sample: Sample; shift: number } {
  const files = list.groups[group];
  if (!files) throw new Error(`no sample group ${group}`);
  let best: { path: string; midi: number } | null = null;
  for (const f of files) {
    const m = vcslPitch(f.path);
    if (m !== null && (!best || Math.abs(m - midi) < Math.abs(best.midi - midi))) best = { path: f.path, midi: m };
  }
  if (!best) throw new Error(`no pitched sample in ${group}`);
  return { sample: sampleAt(best.path, best.midi), shift: midi - best.midi };
}
function hitSample(name: string, rnd: () => number): { sample: Sample; gain: number } {
  const def = arr.hits[name];
  if (!def) throw new Error(`no hit ${name}`);
  const file = def.files[Math.floor(rnd() * def.files.length)]!;
  const entry = Object.values(list.groups).flat().find((f) => basename(f.path, '.wav') === file);
  if (!entry) throw new Error(`hit ${name}: no sample ${file}`);
  return { sample: sampleAt(entry.path, null), gain: def.gain };
}

/** The pass's notes: the excerpt's, from its start. */
function passNotes(tune: Tune, excerpt: readonly [number, number] | undefined): ScoreNote[] {
  const [from, to] = excerpt ?? [0, tune.length];
  return tune.notes.filter((n) => n.start >= from - 1e-6 && n.start < to - 1e-6).map((n) => ({ ...n, start: n.start - from, barStart: n.barStart - from }));
}

/** The section that plays at `beat` of the pass. */
function sectionAt(notes: readonly ScoreNote[], beat: number): string {
  let s = notes[0]?.section ?? '';
  for (const n of notes) {
    if (n.start > beat + 1e-6) break;
    s = n.section;
  }
  return s;
}

function render(track: TrackDef): Stereo {
  const tune = readTune(track.tune, tunes[track.tune] ?? (() => { throw new Error(`no tune ${track.tune}`); })());
  const rnd = random(track.id);
  const spb = 60 / track.bpm;
  const notes = passNotes(tune, track.excerpt);
  const span = (track.excerpt ? track.excerpt[1] - track.excerpt[0] : tune.length);
  const totalBeats = span * track.passes.length;
  // Beats → seconds, the last beats slowed when the piece closes.
  const [slowBeats, slowFactor] = track.slowLast ?? [0, 1];
  const slowFrom = totalBeats - slowBeats;
  const secOf = (beat: number) => (beat <= slowFrom ? beat * spb : slowFrom * spb + (beat - slowFrom) * spb * slowFactor);
  const lengthS = secOf(totalBeats);
  const tail = track.loop ? LOOP_TAIL_S : (track.tailS ?? LOOP_TAIL_S);
  // Humanised, but never before the piece starts: a loop's first notes keep their attack.
  const frame = (s: number) => Math.max(0, Math.round((s + (rnd() - 0.5) * 2 * JITTER_S) * RATE));
  const velocity = (accent: boolean) => (BASE_VELOCITY + (accent ? BAR_ACCENT : 0)) * (1 + (rnd() - 0.5) * 2 * VELOCITY_SPREAD);
  const excerptShift = track.excerpt ? track.excerpt[0] : 0;
  // The bar grid within a pass (after an upbeat), from the tune's own.
  const firstBar = ((tune.downbeat - excerptShift) % tune.bar + tune.bar) % tune.bar - tune.bar;
  const bars = (pass: number) => {
    const starts: number[] = [];
    for (let b = firstBar; b < span; b += tune.bar) starts.push(pass * span + b);
    return starts;
  };
  const inSections = (v: Voice, pass: number, beat: number) => !v.sections || v.sections.includes(sectionAt(notes, beat - pass * span));
  const play = (out: Stereo, instrument: string, midi: number, startS: number, holdS: number, gain: number, pan: number) => {
    const def = arr.instruments[instrument];
    if (!def) throw new Error(`no instrument ${instrument}`);
    const { sample, shift } = pitched(def.group, midi);
    addNote(out, sample, shift, frame(startS), { hold: Math.max(0.02, holdS), attack: def.attack, release: def.release, sustain: def.sustain, gain, pan });
  };

  const renderVoice = (out: Stereo, v: Voice, pass: number, level: number) => {
    const base = pass * span;
    {
      const pan = v.pan ?? 0;
      switch (v.type) {
        case 'melody': {
          const legato = v.legato ?? 1;
          const transpose = v.transpose ?? 0;
          // The voice's notes: with their ornaments, or simplified (heterophony: the long notes only).
          let main = notes.filter((n) => !n.grace && (!v.sections || v.sections.includes(n.section)));
          if (v.simplify) {
            const kept: ScoreNote[] = [];
            for (const n of main) {
              const last = kept[kept.length - 1];
              if (last && n.length < SIMPLE_BEAT && Math.abs(n.start - n.barStart) > 1e-6 && last.midi !== null) kept[kept.length - 1] = { ...last, length: n.start + n.length - last.start };
              else kept.push(n);
            }
            main = kept;
          }
          for (const n of main) {
            if (n.midi === null) continue;
            const graces = v.simplify ? [] : notes.filter((g) => g.grace && Math.abs(g.start - n.start) < 1e-6);
            let at = secOf(base + n.start);
            const end = secOf(base + n.start + n.length);
            const accent = Math.abs(n.start - n.barStart) < 1e-6;
            for (const g of graces) {
              play(out, v.instrument, g.midi! + transpose, at, GRACE_S, level * velocity(false) * 0.8, pan);
              at += GRACE_S;
            }
            play(out, v.instrument, n.midi + transpose, at, (end - at) * legato, level * velocity(accent), pan);
          }
          break;
        }
        case 'drone': {
          const starts = bars(pass).filter((b, i) => i % v.bars === 0 && b >= base - 1e-6);
          if (starts[0] === undefined || starts[0] > base + 1e-6) starts.unshift(base);
          starts.forEach((b, i) => {
            if (!inSections(v, pass, b)) return;
            const until = Math.min(starts[i + 1] ?? base + span, base + span);
            for (const name of v.notes) play(out, v.instrument, midiOf(name), secOf(b), secOf(until) - secOf(b), level * velocity(false), pan);
          });
          break;
        }
        case 'pluck':
          for (const b of bars(pass)) {
            for (const [pos, index, vel] of v.pattern) {
              const beat = b + pos;
              if (beat < base - 1e-6 || beat >= base + span - 1e-6 || !inSections(v, pass, beat)) continue;
              const name = v.notes[index];
              if (name === undefined) throw new Error(`${track.id}: pluck note ${index}`);
              play(out, v.instrument, midiOf(name), secOf(beat), tune.bar * spb, level * vel * velocity(false), pan);
            }
          }
          break;
        case 'drums': {
          const hits: PatternHit[] = [];
          if (v.pattern) {
            const pattern = arr.patterns[v.pattern];
            if (!pattern) throw new Error(`${track.id}: no pattern ${v.pattern}`);
            for (const b of bars(pass)) for (const [pos, name, vel] of pattern) hits.push([b + pos, name, vel]);
          }
          for (const [pos, name, vel] of v.hits ?? []) hits.push([base + pos, name, vel]);
          for (const [beat, name, vel] of hits) {
            if (beat < base - 1e-6 || beat > base + span + 1e-6 || !inSections(v, pass, beat)) continue;
            const { sample, gain } = hitSample(name, rnd);
            addNote(out, sample, 0, frame(secOf(beat)), { hold: sample.left.length / sample.rate, attack: 0.001, release: 0.05, sustain: false, gain: level * gain * vel * velocity(false), pan });
          }
          break;
        }
        case 'bells':
          for (const [pos, name, vel] of v.hits) play(out, 'bells', midiOf(name), secOf(base + pos), 6, level * vel, pan);
          break;
      }
    }
  };

  // Gain staging: each voice is first heard alone and measured, then mixed at its level against the lead.
  const out = stereo(Math.ceil((lengthS + tail) * RATE));
  track.passes.forEach((voices, pass) => {
    const from = Math.floor(secOf(pass * span) * RATE);
    const to = Math.min(out.left.length, Math.ceil((secOf((pass + 1) * span) + tail) * RATE));
    const loud = voices.map((v) => {
      const probe = stereo(out.left.length);
      renderVoice(probe, v, pass, 1);
      return activeLoudness(probe, from, to);
    });
    const leadAt = voices.findIndex((v) => v.type === 'melody');
    if (leadAt < 0) throw new Error(`${track.id}: pass ${pass + 1} has no melody to stage the mix against`);
    const ref = loud[leadAt]!;
    voices.forEach((v, i) => {
      const target = ref * Math.pow(10, (v.level ?? 0) / 20);
      if (loud[i]! > 0) renderVoice(out, v, pass, target / loud[i]!);
    });
  });

  let wet = reverb(out, track.reverb);
  const loopFrames = Math.round(lengthS * RATE);
  if (track.loop) {
    // The ringing past the loop's end is laid over its start: the loop turns without a seam.
    const looped = stereo(loopFrames);
    mixInto(looped, wet, 0);
    const tailPart = { left: wet.left.subarray(loopFrames), right: wet.right.subarray(loopFrames) };
    mixInto(looped, tailPart, 0);
    wet = looped;
  } else {
    const fade = Math.round(END_FADE_S * RATE);
    const n = wet.left.length;
    for (let i = 0; i < fade; i++) {
      const g = 1 - i / fade;
      wet.left[n - fade + i] = wet.left[n - fade + i]! * g;
      wet.right[n - fade + i] = wet.right[n - fade + i]! * g;
    }
  }
  const p = peak(wet);
  // Every piece at one loudness, its few peaks limited.
  level(wet, MUSIC_RMS, PEAK);
  console.log(`${track.id}: ${tune.data.title}, ${track.passes.length} pass(es), ${lengthS.toFixed(1)} s${track.loop ? ' (loop)' : ''}, peak ${(20 * Math.log10(p)).toFixed(1)} dB before levelling`);
  return wet;
}

mkdirSync(OUT, { recursive: true });
for (const track of arr.tracks) {
  if (only && track.id !== only) continue;
  writeWav(join(OUT, `${track.id}.wav`), render(track));
}
