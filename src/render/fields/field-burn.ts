/**
 * Burnt and burning crops (J4 fire, review J4): the battle's fire handle writes the cells here at
 * each fire event; the wheat fields read them when they rebuild their streamed tufts (burnt tufts
 * flattened and charred, burning ones glowing). Event-driven: nothing happens per frame.
 */

/** Burnt tufts keep this share of their height and take this tint (×, linear) at 85 %. */
export const BURNT_HEIGHT = 0.2;
export const BURNT_TINT: readonly [number, number, number] = [0.05, 0.045, 0.06];
export const BURNT_MIX = 0.85;
/** Burning tufts: their colour × this (lit by the flames). */
export const BURNING_TINT: readonly [number, number, number] = [1.3, 0.85, 0.55];

interface FieldBurnState {
  /** Width of the battle grid (cells per row): cell = floor(z) * width + floor(x). */
  width: number;
  burnt: ReadonlySet<number>;
  burning: ReadonlySet<number>;
  /** Bumped at every change: the fields rebuild their tufts when it moves. */
  version: number;
}

export const fieldBurn: FieldBurnState = { width: 0, burnt: new Set(), burning: new Set(), version: 0 };

export function setFieldBurn(width: number, burnt: readonly number[], burning: readonly number[]): void {
  fieldBurn.width = width;
  fieldBurn.burnt = new Set(burnt);
  fieldBurn.burning = new Set(burning);
  fieldBurn.version++;
}

export function clearFieldBurn(): void {
  setFieldBurn(0, [], []);
}

/**
 * The tufts of a chunk as the fire left them: a copy with burnt tufts flattened and charred and
 * burning ones tinted, or the originals when no tuft of the chunk is touched.
 */
export function burnTufts(matrices: Float32Array, colors: Float32Array): { matrices: Float32Array; colors: Float32Array } {
  const { width, burnt, burning } = fieldBurn;
  if (width === 0 || (burnt.size === 0 && burning.size === 0)) return { matrices, colors };
  let outM: Float32Array | null = null;
  let outC: Float32Array | null = null;
  const count = colors.length / 3;
  for (let i = 0; i < count; i++) {
    const x = matrices[i * 16 + 12] as number;
    const z = matrices[i * 16 + 14] as number;
    const cell = Math.floor(z) * width + Math.floor(x);
    const isBurnt = burnt.has(cell);
    if (!isBurnt && !burning.has(cell)) continue;
    outM ??= matrices.slice();
    outC ??= colors.slice();
    if (isBurnt) {
      // The Y column of the matrix (rotation about Y only): shrink the tuft's height.
      outM[i * 16 + 4] = (outM[i * 16 + 4] as number) * BURNT_HEIGHT;
      outM[i * 16 + 5] = (outM[i * 16 + 5] as number) * BURNT_HEIGHT;
      outM[i * 16 + 6] = (outM[i * 16 + 6] as number) * BURNT_HEIGHT;
      for (let c = 0; c < 3; c++) {
        const v = outC[i * 3 + c] as number;
        outC[i * 3 + c] = v + ((BURNT_TINT[c] as number) - v) * BURNT_MIX;
      }
    } else {
      for (let c = 0; c < 3; c++) outC[i * 3 + c] = (outC[i * 3 + c] as number) * (BURNING_TINT[c] as number);
    }
  }
  return outM && outC ? { matrices: outM, colors: outC } : { matrices, colors };
}
