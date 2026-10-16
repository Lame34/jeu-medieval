/**
 * The soundtrack's signal work (ADR-051), done offline: WAV files read (PCM 16 and 24 bits) and
 * written, a sampler that plays a sampled instrument at any pitch (nearest sample, resampled
 * with linear interpolation, its rate folded in), envelopes, a sustain that loops the steady part
 * of a sample for long notes, and a reverb of the Freeverb kind (comb and all-pass filters) for
 * the stone hall the instruments play in.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export const RATE = 44100;

/** A stereo signal at RATE. */
export interface Stereo {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

export interface Sample extends Stereo {
  readonly rate: number;
  /** Its pitch (MIDI), when it has one. */
  readonly midi: number | null;
}

export function stereo(length: number): Stereo {
  return { left: new Float32Array(length), right: new Float32Array(length) };
}

/** A PCM WAV file (16 or 24 bits, mono or stereo) as floats. */
export function readWav(path: string, midi: number | null = null): Sample {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`);
  let o = 12;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let data: { start: number; size: number } | null = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      const codec = b.readUInt16LE(o + 8);
      if (codec !== 1) throw new Error(`${path}: codec ${codec}, PCM expected`);
      channels = b.readUInt16LE(o + 10);
      rate = b.readUInt32LE(o + 12);
      bits = b.readUInt16LE(o + 22);
    } else if (id === 'data') data = { start: o + 8, size: Math.min(size, b.length - o - 8) };
    o += 8 + size + (size % 2);
  }
  if (!data || (bits !== 16 && bits !== 24) || (channels !== 1 && channels !== 2)) throw new Error(`${path}: ${bits} bits, ${channels} channels`);
  const bytes = bits / 8;
  const frames = Math.floor(data.size / (bytes * channels));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const read = (at: number) => (bits === 16 ? b.readInt16LE(at) / 32768 : b.readIntLE(at, 3) / 8388608);
  for (let i = 0; i < frames; i++) {
    const at = data.start + i * bytes * channels;
    left[i] = read(at);
    right[i] = channels === 2 ? read(at + bytes) : left[i]!;
  }
  return { left, right, rate, midi };
}

/** A 16-bit stereo WAV of `s`, dithered by nothing (the encoder follows). */
export function writeWav(path: string, s: Stereo): void {
  const frames = s.left.length;
  const b = Buffer.alloc(44 + frames * 4);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + frames * 4, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(frames * 4, 40);
  const clip = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < frames; i++) {
    b.writeInt16LE(clip(s.left[i]!), 44 + i * 4);
    b.writeInt16LE(clip(s.right[i]!), 46 + i * 4);
  }
  writeFileSync(path, b);
}

/** How a note sounds: its length, its envelope, its loudness and place. */
export interface NoteShape {
  /** Seconds the note is held (a plucked string rings past it, within `release`). */
  readonly hold: number;
  readonly attack: number;
  readonly release: number;
  /** Long notes of a held instrument loop the steady part of the sample. */
  readonly sustain: boolean;
  readonly gain: number;
  /** -1 left … 1 right. */
  readonly pan: number;
}

/** The steady part of a held sample, looped: between these shares of its length. */
const LOOP_FROM = 0.35;
const LOOP_TO = 0.85;
/** Crossfade between two turns of a loop (s). */
const LOOP_FADE_S = 0.08;

/**
 * Adds the sample `s`, played `semitones` higher, into `out` at frame `at`, shaped by `shape`.
 * The sample's own rate is folded into the step, so a 48 kHz sample plays true at 44.1 kHz.
 */
export function addNote(out: Stereo, s: Sample, semitones: number, at: number, shape: NoteShape): void {
  const step = Math.pow(2, semitones / 12) * (s.rate / RATE);
  const holdFrames = Math.round(shape.hold * RATE);
  const releaseFrames = Math.max(1, Math.round(shape.release * RATE));
  const attackFrames = Math.max(1, Math.round(shape.attack * RATE));
  const total = holdFrames + releaseFrames;
  const srcLength = s.left.length;
  const loopFrom = Math.floor(srcLength * LOOP_FROM);
  const loopTo = Math.floor(srcLength * LOOP_TO);
  const loopLength = loopTo - loopFrom;
  const fade = Math.round(LOOP_FADE_S * s.rate);
  // A held note longer than the sample's steady part turns within it, never reaching the sample's
  // own dying away (that dip, then a jump back to full, was heard as a click).
  const looping = shape.sustain && total * step > loopTo && loopLength > fade * 2;
  // Equal-power pan.
  const angle = ((shape.pan + 1) * Math.PI) / 4;
  const gl = Math.cos(angle) * shape.gain * Math.SQRT2;
  const gr = Math.sin(angle) * shape.gain * Math.SQRT2;
  for (let i = 0; i < total; i++) {
    const o = at + i;
    if (o < 0) continue;
    if (o >= out.left.length) break;
    let pos = i * step;
    let crossfade = 0;
    let crossPos = 0;
    if (looping && pos >= loopFrom) {
      // Within the steady part, each turn crossfading into the next.
      const into = (pos - loopFrom) % loopLength;
      pos = loopFrom + into;
      if (into > loopLength - fade) {
        // Blended with the sound a turn earlier: at the turn, it is where the next turn starts.
        crossfade = (into - (loopLength - fade)) / fade;
        crossPos = pos - loopLength;
      }
    } else if (pos >= srcLength - 1) break;
    const read = (p: number, c: Float32Array) => {
      const k = Math.floor(p);
      const f = p - k;
      return (c[k] ?? 0) * (1 - f) + (c[k + 1] ?? 0) * f;
    };
    let l = read(pos, s.left);
    let r = read(pos, s.right);
    if (crossfade > 0) {
      l = l * (1 - crossfade) + read(crossPos, s.left) * crossfade;
      r = r * (1 - crossfade) + read(crossPos, s.right) * crossfade;
    }
    let env = i < attackFrames ? i / attackFrames : 1;
    if (i >= holdFrames) env *= 1 - (i - holdFrames) / releaseFrames;
    out.left[o] = out.left[o]! + l * env * gl;
    out.right[o] = out.right[o]! + r * env * gr;
  }
}

/** Adds `src` into `out` at frame `at`, scaled. */
export function mixInto(out: Stereo, src: Stereo, at: number, gain = 1): void {
  for (let i = 0; i < src.left.length; i++) {
    const o = at + i;
    if (o < 0 || o >= out.left.length) continue;
    out.left[o] = out.left[o]! + src.left[i]! * gain;
    out.right[o] = out.right[o]! + src.right[i]! * gain;
  }
}

/** Freeverb's tunings (in samples at 44.1 kHz) and the right channel's spread. */
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;
const ALLPASS_FEEDBACK = 0.5;
/** Freeverb's fixed input gain. */
const FIXED_GAIN = 0.015;

export interface ReverbSettings {
  /** 0…1: how long the hall rings. */
  readonly room: number;
  /** 0…1: how dull its walls make the echoes. */
  readonly damp: number;
  readonly wet: number;
  readonly dry: number;
}

function reverbChannel(input: Float32Array, spread: number, r: ReverbSettings): Float32Array {
  const feedback = 0.7 + 0.28 * r.room;
  const damp = 0.4 * r.damp;
  const combs = COMBS.map((n) => ({ buf: new Float32Array(n + spread), i: 0, store: 0 }));
  const alls = ALLPASSES.map((n) => ({ buf: new Float32Array(n + spread), i: 0 }));
  const out = new Float32Array(input.length);
  for (let k = 0; k < input.length; k++) {
    const x = input[k]! * FIXED_GAIN;
    let y = 0;
    for (const c of combs) {
      const v = c.buf[c.i]!;
      c.store = v * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      y += v;
    }
    for (const a of alls) {
      const v = a.buf[a.i]!;
      a.buf[a.i] = y + v * ALLPASS_FEEDBACK;
      a.i = (a.i + 1) % a.buf.length;
      y = v - y;
    }
    out[k] = y;
  }
  return out;
}

/** The hall around `s`: its echoes mixed with the dry sound. */
export function reverb(s: Stereo, r: ReverbSettings): Stereo {
  const wl = reverbChannel(s.left, 0, r);
  const wr = reverbChannel(s.right, SPREAD, r);
  const left = new Float32Array(s.left.length);
  const right = new Float32Array(s.left.length);
  for (let i = 0; i < left.length; i++) {
    left[i] = s.left[i]! * r.dry + wl[i]! * r.wet;
    right[i] = s.right[i]! * r.dry + wr[i]! * r.wet;
  }
  return { left, right };
}

/** The RMS level of `s` (both channels). */
export function rms(s: Stereo): number {
  let p = 0;
  for (let i = 0; i < s.left.length; i++) p += s.left[i]! * s.left[i]! + s.right[i]! * s.right[i]!;
  return Math.sqrt(p / (2 * Math.max(1, s.left.length)));
}

/**
 * Brings `s` to the loudness `targetRms` under the ceiling `peak`: scaled, then a look-ahead
 * limiter takes down the few peaks above the ceiling (gain reaches its floor before the peak
 * arrives, and comes back slowly), so that every piece plays at one loudness.
 */
export function level(s: Stereo, targetRms: number, peak: number, lookAheadS = 0.003, releaseS = 0.15): void {
  const scale = targetRms / Math.max(rms(s), 1e-9);
  const n = s.left.length;
  const ahead = Math.max(1, Math.round(lookAheadS * RATE));
  const release = Math.exp(-1 / (releaseS * RATE));
  // The gain each sample needs, then its minimum over the coming look-ahead window.
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(s.left[i]!), Math.abs(s.right[i]!)) * scale;
    need[i] = a > peak ? peak / a : 1;
  }
  const floor = new Float32Array(n);
  const window: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // A monotonic queue over [i, i + ahead]: its head is the window's minimum.
    while (window.length > 0 && need[window[window.length - 1]!]! >= need[i]!) window.pop();
    window.push(i);
    while (window[0]! > i + ahead) window.shift();
    floor[i] = need[window[0]!]!;
  }
  // The gain goes down smoothly: the floor averaged over the look-ahead still meets each peak, every
  // window holding the peak being at its floor or lower; then it comes back slowly.
  let sum = 0;
  let g = 1;
  for (let i = 0; i < n; i++) {
    sum += floor[i]!;
    if (i >= ahead) sum -= floor[i - ahead]!;
    const box = sum / Math.min(i + 1, ahead);
    g = box < g ? box : box + (g - box) * release;
    s.left[i] = s.left[i]! * scale * g;
    s.right[i] = s.right[i]! * scale * g;
  }
}

/** The loudest sample of `s`. */
export function peak(s: Stereo): number {
  let p = 0;
  for (let i = 0; i < s.left.length; i++) p = Math.max(p, Math.abs(s.left[i]!), Math.abs(s.right[i]!));
  return p;
}
