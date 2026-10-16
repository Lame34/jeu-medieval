/**
 * The land's colours in each season of the campaign (ADR-052), mirror of docs/STYLE_BIBLE.md §2:
 * - spring (April): fresh grass, the wheat young and green over dark wet furrows, the paths soaked,
 *   the hawthorn in flower, the leaves light and yellow-green;
 * - early summer (May, June): deep green, the wheat greening to gold, the dog-rose in the hedges;
 * - harvest (July): the reference palette, ripe wheat and dry grass, as a skirmish shows it;
 * - autumn (October): tawny grass, the fields harvested to stubble or ploughed, the broad-leaved
 *   trees turned gold, copper and rust (the pines stay green).
 * Colours are set when a battle's scene is built (uniforms, vertex colours): nothing per frame.
 * Rule of §2: nothing exceeds HSV saturation 0.55.
 */
import { Color, SRGBColorSpace, type BufferGeometry } from 'three';
import type { SeasonLook } from '../../core/rules/types.ts';
import { PALETTE } from './palette.ts';

export interface Tone {
  readonly lit: string;
  readonly base: string;
}

/** How the broad leaves turn: a hue shift for every leaf, or hues to turn to (one per tree variant). */
export type LeafTurn =
  | { readonly kind: 'shift'; readonly hue: number; readonly light: number }
  /** Each variant's hue, how far it has turned (0–1) and its lightness shift; the turned leaves' saturation over the green's. */
  | { readonly kind: 'turn'; readonly hues: readonly number[]; readonly share: readonly number[]; readonly light: readonly number[]; readonly saturation: number };

export interface SeasonPalette {
  readonly grassLush: Tone;
  readonly grassDry: Tone;
  readonly dirt: Tone;
  readonly path: Tone;
  readonly mud: Tone;
  readonly wheat: Tone;
  readonly rye: Tone;
  readonly fieldBed: string;
  /** Fallow and ploughed parcels of the distant land. */
  readonly fallow: string;
  readonly hedge: string;
  /** The crop's height over the ripe wheat's, and whether it bears ears (none when young, none on stubble). */
  readonly cropHeight: number;
  readonly ears: boolean;
  /** Blossom on the hedges (hawthorn, dog-rose), or none. */
  readonly blossom: string | null;
  readonly leaves: LeafTurn | null;
}

const HARVEST: SeasonPalette = {
  grassLush: PALETTE.grassLush,
  grassDry: PALETTE.grassDry,
  dirt: PALETTE.dirt,
  path: PALETTE.path,
  mud: PALETTE.mud,
  wheat: PALETTE.wheat,
  rye: PALETTE.rye,
  fieldBed: PALETTE.fieldBed,
  fallow: PALETTE.fallow.lit,
  hedge: PALETTE.moss.base,
  cropHeight: 1,
  ears: true,
  blossom: null,
  leaves: null,
};

export const SEASON_PALETTES: Readonly<Record<SeasonLook, SeasonPalette>> = {
  spring: {
    grassLush: { lit: '#93a85a', base: '#58703a' },
    grassDry: { lit: '#a2a660', base: '#6a7040' },
    dirt: { lit: '#8a6c4a', base: '#5e4834' },
    path: { lit: '#a68c66', base: '#786246' },
    mud: { lit: '#5e4c3a', base: '#3f3226' },
    wheat: { lit: '#9fb05c', base: '#5e7238' },
    rye: { lit: '#98aa62', base: '#5a6c3c' },
    fieldBed: '#6f5c42',
    fallow: '#7c6c4c',
    hedge: PALETTE.moss.base,
    cropHeight: 0.55,
    ears: false,
    blossom: '#efe8dc',
    leaves: { kind: 'shift', hue: -0.02, light: 0.05 },
  },
  earlySummer: {
    ...HARVEST,
    grassLush: { lit: '#8ea25a', base: '#546a3a' },
    grassDry: { lit: '#aaa762', base: '#767440' },
    wheat: { lit: '#bdb466', base: '#7f7c46' },
    rye: { lit: '#b4aa68', base: '#7a7444' },
    fieldBed: '#8e7850',
    cropHeight: 0.9,
    blossom: '#eee2da',
  },
  harvest: HARVEST,
  autumn: {
    ...HARVEST,
    // The autumn rains have greened the meadows again (the aftermath): olive, a little tawny.
    grassLush: { lit: '#8a9a5a', base: '#536438' },
    grassDry: { lit: '#a29c64', base: '#6e6a44' },
    wheat: { lit: '#cbb57e', base: '#94805a' },
    rye: { lit: '#c4ae7c', base: '#8c7a56' },
    fieldBed: '#8a7452',
    fallow: '#7a6648',
    hedge: '#5c5030',
    cropHeight: 0.24,
    ears: false,
    // Gold, ochre, copper, rust, and a tree still green; how far each variant has turned.
    leaves: { kind: 'turn', hues: [0.11, 0.09, 0.065, 0.05, 0.2], share: [0.95, 0.9, 0.95, 0.9, 0.35], light: [0.03, 0, -0.07, -0.11, 0], saturation: 1.7 },
  },
};

/** A leaf is green: its green channel leads the red one by this factor (bark, trunks and blossoms never do). */
const LEAF_GREEN_LEAD = 1.05;
/** §2: no colour above this HSV saturation. */
const MAX_SATURATION = 0.55;

const hsl = { h: 0, s: 0, l: 0 };
const c = new Color();

/** Brings an sRGB colour under the saturation cap, towards its own grey. */
function capSaturation(color: Color): void {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  if (max <= 0 || (max - min) / max <= MAX_SATURATION) return;
  const target = max * (1 - MAX_SATURATION);
  const k = (max - target) / (max - min);
  color.setRGB(max - (max - color.r) * k, max - (max - color.g) * k, max - (max - color.b) * k);
}

/**
 * Turns the green vertices of a broad-leaved tree's geometry to the season (in place); `variant`
 * picks its autumn hue, so a wood mixes them. The trunks and the blossoms keep their colours.
 */
export function turnLeaves(geometry: BufferGeometry, turn: LeafTurn | null, variant: number): void {
  if (!turn) return;
  const colors = geometry.getAttribute('color');
  if (!colors) return;
  const k = turn.kind === 'turn' ? variant % turn.hues.length : 0;
  for (let i = 0; i < colors.count; i++) {
    c.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    if (c.g <= c.r * LEAF_GREEN_LEAD || c.g <= c.b) continue;
    c.getHSL(hsl, SRGBColorSpace);
    if (turn.kind === 'shift') {
      c.setHSL(hsl.h + turn.hue, hsl.s, Math.min(1, hsl.l + turn.light), SRGBColorSpace);
    } else {
      const share = turn.share[k] ?? 1;
      c.setHSL(hsl.h + ((turn.hues[k] ?? hsl.h) - hsl.h) * share, Math.min(1, hsl.s * (1 + (turn.saturation - 1) * share)), Math.min(1, Math.max(0, hsl.l + (turn.light[k] ?? 0))), SRGBColorSpace);
    }
    c.convertLinearToSRGB();
    capSaturation(c);
    c.convertSRGBToLinear();
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  colors.needsUpdate = true;
}
