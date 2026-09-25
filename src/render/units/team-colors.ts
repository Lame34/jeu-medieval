/**
 * Allegiance recolouring (brief §5.3, §6.5): KayKit textures are palette atlases of gradient
 * swatches. The cloth swatches of each body are identified by hue and re-hued to the faction
 * colour, preserving the painted gradient (lightness). Done once per (body, faction) on a
 * canvas: zero shader cost, exact result.
 */
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import type { Faction } from '../../core/rules/types.ts';

export interface HueRange {
  readonly from: number;
  readonly to: number;
  readonly minSaturation: number;
}

/** Cloth hues per KayKit body (hue in turns; ranges may wrap through 0). */
export const BODY_CLOTH_HUES: Readonly<Record<string, readonly HueRange[]>> = {
  knight: [{ from: 0.93, to: 0.025, minSaturation: 0.45 }],
  rogue: [{ from: 0.28, to: 0.52, minSaturation: 0.3 }],
  rogue_hooded: [{ from: 0.28, to: 0.52, minSaturation: 0.3 }],
  barbarian: [{ from: 0.53, to: 0.66, minSaturation: 0.22 }],
  mage: [{ from: 0.7, to: 0.9, minSaturation: 0.3 }],
  shield: [
    { from: 0.93, to: 0.025, minSaturation: 0.4 },
    { from: 0.53, to: 0.7, minSaturation: 0.3 },
  ],
};

/** Gold/yellow accents: kept gold for the attacker, forged to iron for the defender. */
const GOLD: HueRange = { from: 0.08, to: 0.17, minSaturation: 0.5 };

export interface FactionTint {
  readonly hue: number;
  readonly saturation: number;
  readonly lightnessBias: number;
  readonly goldToIron: boolean;
}

export const FACTION_TINTS: Readonly<Record<Faction, FactionTint>> = {
  attacker: { hue: 0.617, saturation: 0.72, lightnessBias: 0.0, goldToIron: false },
  defender: { hue: 0.992, saturation: 0.78, lightnessBias: -0.03, goldToIron: true },
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
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = rgbToHsl((data[i] as number) / BYTE, (data[i + 1] as number) / BYTE, (data[i + 2] as number) / BYTE);
    let out: [number, number, number] | null = null;
    if (clothHues.some((r) => inRange(h, s, r))) {
      out = hslToRgb(tint.hue, Math.max(tint.saturation, s * 0.9), Math.min(0.92, Math.max(0.06, l + tint.lightnessBias)));
    } else if (tint.goldToIron && inRange(h, s, GOLD)) {
      out = hslToRgb(0.6, 0.06, l * 0.75);
    }
    if (out) {
      data[i] = Math.round(out[0] * BYTE);
      data[i + 1] = Math.round(out[1] * BYTE);
      data[i + 2] = Math.round(out[2] * BYTE);
    }
  }
}
