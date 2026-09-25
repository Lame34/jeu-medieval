import { describe, expect, it } from 'vitest';
import {
  TerrainLayer,
  cellAt,
  cellCenter,
  cellCenterHeight,
  cellCoord,
  cellGrade,
  cellIndex,
  createTerrainData,
  inBounds,
  layerAt,
  sampleHeight,
  setHeightAtCorner,
  setLayer,
} from '@core/index.ts';
import { setPlaneHeights } from './helpers.ts';

describe('createTerrainData', () => {
  it('rejects invalid sizes', () => {
    expect(() => createTerrainData(0, 5)).toThrow(RangeError);
    expect(() => createTerrainData(5, -1)).toThrow(RangeError);
    expect(() => createTerrainData(1.5, 5)).toThrow(RangeError);
    expect(() => createTerrainData(5, 5, 0)).toThrow(RangeError);
  });

  it('allocates (w+1)x(d+1) heights and w*d layers, all Plain by default', () => {
    const t = createTerrainData(3, 2);
    expect(t.heights.length).toBe(4 * 3);
    expect(t.layers.length).toBe(3 * 2);
    for (const l of t.layers) expect(l).toBe(TerrainLayer.Plain);
  });
});

describe('sampleHeight (bilinear)', () => {
  it('returns the exact corner height at each of the 4 corners of a cell', () => {
    const t = createTerrainData(2, 2, 1);
    setHeightAtCorner(t, 0, 0, 1);
    setHeightAtCorner(t, 1, 0, 3);
    setHeightAtCorner(t, 0, 1, 5);
    setHeightAtCorner(t, 1, 1, 7);
    expect(sampleHeight(t, 0, 0)).toBe(1);
    expect(sampleHeight(t, 1, 0)).toBe(3);
    expect(sampleHeight(t, 0, 1)).toBe(5);
    expect(sampleHeight(t, 1, 1)).toBe(7);
  });

  it('returns the average of the 4 corners at the cell centre', () => {
    const t = createTerrainData(1, 1, 1);
    setHeightAtCorner(t, 0, 0, 1);
    setHeightAtCorner(t, 1, 0, 3);
    setHeightAtCorner(t, 0, 1, 5);
    setHeightAtCorner(t, 1, 1, 7);
    expect(sampleHeight(t, 0.5, 0.5)).toBe((1 + 3 + 5 + 7) / 4);
    expect(cellCenterHeight(t, 0, 0)).toBe((1 + 3 + 5 + 7) / 4);
  });

  it('interpolates linearly along a straight-line plane', () => {
    const t = createTerrainData(4, 4, 1);
    setPlaneHeights(t, 2, -1, 10); // h = 10 + 2x - z
    expect(sampleHeight(t, 1.5, 0.5)).toBeCloseTo(10 + 2 * 1.5 - 0.5, 6);
    expect(sampleHeight(t, 3.25, 2.75)).toBeCloseTo(10 + 2 * 3.25 - 2.75, 6);
  });

  it('clamps out-of-range world coordinates to the map extents', () => {
    const t = createTerrainData(2, 2, 1);
    setHeightAtCorner(t, 0, 0, 100); // only the (0,0) corner is distinctive
    expect(sampleHeight(t, -50, -50)).toBe(sampleHeight(t, 0, 0));
    expect(sampleHeight(t, 500, 500)).toBe(sampleHeight(t, 2, 2));
    expect(sampleHeight(t, -5, 1)).toBe(sampleHeight(t, 0, 1));
  });
});

describe('cellGrade', () => {
  it('measures the magnitude of the height gradient on an inclined plane', () => {
    const t = createTerrainData(3, 3, 1);
    const gradeX = 0.4;
    const gradeZ = -0.3;
    setPlaneHeights(t, gradeX, gradeZ);
    const expected = Math.hypot(gradeX, gradeZ);
    for (let cz = 0; cz < 3; cz++) {
      // Corner heights are stored in a Float32Array: allow for float32 rounding (~1e-7 relative).
      for (let cx = 0; cx < 3; cx++) expect(cellGrade(t, cx, cz)).toBeCloseTo(expected, 6);
    }
  });

  it('is zero on a flat terrain', () => {
    const t = createTerrainData(2, 2, 1);
    t.heights.fill(5);
    expect(cellGrade(t, 0, 0)).toBe(0);
  });

  it('scales inversely with cellSize for the same absolute height jump', () => {
    const small = createTerrainData(1, 1, 1);
    const large = createTerrainData(1, 1, 2);
    setHeightAtCorner(small, 1, 0, 1);
    setHeightAtCorner(small, 1, 1, 1);
    setHeightAtCorner(large, 1, 0, 1);
    setHeightAtCorner(large, 1, 1, 1);
    // Same corner deltas, but the "run" is twice as long for cellSize=2 => half the grade.
    expect(cellGrade(large, 0, 0)).toBeCloseTo(cellGrade(small, 0, 0) / 2, 9);
  });
});

describe('cell indexing helpers', () => {
  it('cellIndex / cellCoord round-trip', () => {
    const shape = { width: 5 };
    for (let cz = 0; cz < 4; cz++) {
      for (let cx = 0; cx < 5; cx++) {
        const idx = cellIndex(shape, cx, cz);
        expect(cellCoord(shape, idx)).toEqual({ cx, cz });
      }
    }
  });

  it('cellAt maps a world position to its containing cell', () => {
    const t = createTerrainData(4, 4, 2);
    expect(cellAt(t, 0, 0)).toEqual({ cx: 0, cz: 0 });
    expect(cellAt(t, 1.9, 1.9)).toEqual({ cx: 0, cz: 0 });
    expect(cellAt(t, 2, 0)).toEqual({ cx: 1, cz: 0 });
    expect(cellAt(t, 7.99, 3.5)).toEqual({ cx: 3, cz: 1 });
  });

  it('cellCenter returns the centre of the cell in world metres', () => {
    expect(cellCenter({ cellSize: 2 }, 1, 3)).toEqual({ x: 3, z: 7 });
    expect(cellCenter({ cellSize: 1 }, 0, 0)).toEqual({ x: 0.5, z: 0.5 });
  });

  it('inBounds rejects negative and out-of-range coordinates', () => {
    const shape = { width: 3, depth: 3 };
    expect(inBounds(shape, 0, 0)).toBe(true);
    expect(inBounds(shape, 2, 2)).toBe(true);
    expect(inBounds(shape, -1, 0)).toBe(false);
    expect(inBounds(shape, 0, 3)).toBe(false);
    expect(inBounds(shape, 3, 0)).toBe(false);
  });
});

describe('layerAt / setLayer', () => {
  it('reads back exactly what was written', () => {
    const t = createTerrainData(3, 3);
    setLayer(t, 1, 2, TerrainLayer.Forest);
    expect(layerAt(t, 1, 2)).toBe(TerrainLayer.Forest);
    expect(layerAt(t, 0, 0)).toBe(TerrainLayer.Plain);
  });
});
