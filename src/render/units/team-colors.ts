/**
 * Allegiance recolouring (brief §5.3, §6.5): the cloth of each body's painted atlas is found by
 * hue and re-hued to the faction colour, keeping the painted lightness variation (lifted: the
 * source cloths are dark). Done once per (body, faction) on a canvas: zero shader cost.
 */
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { Faction } from '../../core/rules/types.ts';

export interface HueRange {
  readonly from: number;
  readonly to: number;
  readonly minSaturation: number;
  /** Lightness multiplier applied to the recoloured cloth (default 1). */
  readonly lightnessGain?: number;
}

/**
 * Cloth hues per body (hue in turns; ranges may wrap through 0), measured on the atlases:
 * warrior red tabard, ranger green-teal hood and cloak (its red hair is left alone), rogue
 * maroon tunic.
 */
/** Tabard key colour painted by convert_rpg_characters.py (magenta, used by no source texture). */
const TABARD: HueRange = { from: 0.8, to: 0.92, minSaturation: 0.4, lightnessGain: 1.45 };

export const BODY_CLOTH_HUES: Readonly<Record<string, readonly HueRange[]>> = {
  warrior: [TABARD, { from: 0.95, to: 0.03, minSaturation: 0.28, lightnessGain: 1.8 }],
  ranger: [TABARD, { from: 0.2, to: 0.55, minSaturation: 0.1, lightnessGain: 2.0 }],
  rogue: [TABARD, { from: 0.95, to: 0.03, minSaturation: 0.3, lightnessGain: 2.2 }],
};

/** Gold accents (not skin nor leather, hue < 0.1): kept for the attacker, iron for the defender. */
const GOLD: HueRange = { from: 0.105, to: 0.17, minSaturation: 0.5 };

export interface FactionTint {
  readonly hue: number;
  readonly saturation: number;
  readonly lightnessBias: number;
  readonly goldToIron: boolean;
  /** Lightness gain of grey metal (armour): bright steel for the attacker, dark iron for the defender. */
  readonly metalGain: number;
}

export const FACTION_TINTS: Readonly<Record<Faction, FactionTint>> = {
  attacker: { hue: 0.617, saturation: 0.72, lightnessBias: 0.0, goldToIron: false, metalGain: 1.3 },
  defender: { hue: 0.992, saturation: 0.78, lightnessBias: -0.03, goldToIron: true, metalGain: 0.85 },
};

function inRange(h: number, s: number, r: HueRange): boolean {
  if (s < r.minSaturation) return false;
  return r.from <= r.to ? h >= r.from && h <= r.to : h >= r.from || h <= r.to;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const hue = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
}

const BYTE = 255;
/** Grey armour and iron fittings (skin and leather are more saturated). */
const METAL_MAX_SATURATION = 0.12;
const METAL_MIN_LIGHTNESS = 0.08;
const METAL_MAX_LIGHTNESS = 0.55;

export function recolorTexture(source: Texture, clothHues: readonly HueRange[], faction: Faction): Texture {
  const image = source.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  recolorPixels(pixels.data, clothHues, faction);
  ctx.putImageData(pixels, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = source.flipY;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.magFilter = source.magFilter;
  texture.minFilter = source.minFilter;
  texture.name = `${source.name}:${faction}`;
  return texture;
}

/** Re-hues cloth pixels (RGBA bytes, in place) to the faction colour; gold → iron for defenders. */
export function recolorPixels(data: Uint8ClampedArray, clothHues: readonly HueRange[], faction: Faction): void {
  const tint = FACTION_TINTS[faction];
  // Painted atlases hold few distinct colours: each is converted once (the per-pixel HSL round
  // trip was a third of a second of the battle's load). -1: left as it is.
  const done = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const key = (r << 16) | (g << 8) | b;
    let packed = done.get(key);
    if (packed === undefined) {
      const [h, s, l] = rgbToHsl(r / BYTE, g / BYTE, b / BYTE);
      let out: [number, number, number] | null = null;
      const cloth = clothHues.find((range) => inRange(h, s, range));
      if (cloth) {
        const lit = l * (cloth.lightnessGain ?? 1) + tint.lightnessBias;
        out = hslToRgb(tint.hue, Math.max(tint.saturation, s * 0.9), Math.min(0.92, Math.max(0.06, lit)));
      } else if (tint.goldToIron && inRange(h, s, GOLD)) {
        out = hslToRgb(0.6, 0.06, l * 0.75);
      } else if (s < METAL_MAX_SATURATION && l > METAL_MIN_LIGHTNESS && l < METAL_MAX_LIGHTNESS) {
        out = hslToRgb(h, s, Math.min(0.9, l * tint.metalGain));
      }
      packed = out ? (Math.round(out[0] * BYTE) << 16) | (Math.round(out[1] * BYTE) << 8) | Math.round(out[2] * BYTE) : -1;
      done.set(key, packed);
    }
    if (packed >= 0) {
      data[i] = (packed >> 16) & BYTE;
      data[i + 1] = (packed >> 8) & BYTE;
      data[i + 2] = packed & BYTE;
    }
  }
}
