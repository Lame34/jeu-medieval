/**
 * The VCSL samples' pitches (ADR-051), read from their file names. VCSL names a sample an octave
 * low (middle C is « C3 », the convention of some samplers): its alto recorder's « F3 » sounds
 * the F above middle C. Measured on every instrument the soundtrack plays.
 */
import { basename } from 'node:path';
import { midiOf } from './score.ts';

export const VCSL_OCTAVE = 12;

/** The pitch (MIDI) a VCSL sample sounds, from its name (« EWHarp_Normal_C3_v2_RR1.wav »), or null. */
export function vcslPitch(path: string): number | null {
  const m = /_([A-G]#?)(-?\d)(?:_|\.wav$)/.exec(basename(path));
  return m ? midiOf(`${m[1]}${m[2]}`) + VCSL_OCTAVE : null;
}
