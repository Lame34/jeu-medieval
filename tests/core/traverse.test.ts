import { describe, expect, it } from 'vitest';
import { traverseSegment, type GridShape } from '@core/index.ts';

const GRID: GridShape = { width: 10, depth: 10, cellSize: 1 };

interface Visit {
  readonly cx: number;
  readonly cz: number;
  readonly t0: number;
  readonly t1: number;
}

function collect(ax: number, az: number, bx: number, bz: number): { cells: Visit[]; corners: [number, number, number, number][] } {
  const cells: Visit[] = [];
  const corners: [number, number, number, number][] = [];
  traverseSegment(
    GRID,
    ax,
    az,
    bx,
    bz,
    (cx, cz, t0, t1) => {
      cells.push({ cx, cz, t0, t1 });
      return true;
    },
    (sax, saz, sbx, sbz) => {
      corners.push([sax, saz, sbx, sbz]);
      return true;
    },
  );
  return { cells, corners };
}

describe('traverseSegment: axis-aligned segments', () => {
  it('reports every cell crossed on a horizontal segment, in order, with exact t-intervals', () => {
    const { cells } = collect(0, 0.5, 5, 0.5);
    expect(cells.map((c) => [c.cx, c.cz])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
    for (let i = 0; i < cells.length; i++) {
      expect(cells[i]?.t0).toBeCloseTo(i / 5, 12);
      expect(cells[i]?.t1).toBeCloseTo((i + 1) / 5, 12);
    }
  });

  it('reports every cell crossed on a vertical segment, in order, with exact t-intervals', () => {
    const { cells } = collect(0.5, 0, 0.5, 4);
    expect(cells.map((c) => [c.cx, c.cz])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
    for (let i = 0; i < cells.length; i++) {
      expect(cells[i]?.t0).toBeCloseTo(i / 4, 12);
      expect(cells[i]?.t1).toBeCloseTo((i + 1) / 4, 12);
    }
  });
});

describe('traverseSegment: exact diagonal', () => {
  it('crosses corner cells and invokes the corner visitor at each shared corner', () => {
    const { cells, corners } = collect(0, 0, 3, 3);
    expect(cells.map((c) => [c.cx, c.cz])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    // Passes exactly through (1,1) and (2,2): the corner visitor fires for each.
    expect(corners).toHaveLength(2);
    expect(corners[0]).toEqual([1, 0, 0, 1]);
    expect(corners[1]).toEqual([2, 1, 1, 2]);
  });

  it('stops early and skips remaining corners when the corner visitor returns false', () => {
    const seenCorners: [number, number, number, number][] = [];
    let cellCount = 0;
    const ok = traverseSegment(
      GRID,
      0,
      0,
      3,
      3,
      () => {
        cellCount++;
        return true;
      },
      (sax, saz, sbx, sbz) => {
        seenCorners.push([sax, saz, sbx, sbz]);
        return false; // abort right at the first corner
      },
    );
    expect(ok).toBe(false);
    expect(seenCorners).toHaveLength(1);
    // The cell visitor runs once for the first cell (0,0); the corner visitor then aborts
    // before the second cell (1,1) is ever reported.
    expect(cellCount).toBe(1);
  });
});

describe('traverseSegment: parametric coverage', () => {
  it('the visited (t0, t1) intervals always sum to exactly 1', () => {
    const cases: [number, number, number, number][] = [
      [0.3, 0.7, 4.9, 2.1],
      [0.05, 8.9, 9.9, 0.2],
      [2.5, 2.5, 2.5, 7.5],
      [1.1, 9.9, 8.4, 0.6],
    ];
    for (const [ax, az, bx, bz] of cases) {
      const { cells } = collect(ax, az, bx, bz);
      const total = cells.reduce((sum, c) => sum + (c.t1 - c.t0), 0);
      expect(total).toBeCloseTo(1, 9);
    }
  });

  it('a zero-length segment (a point) reports only its own cell, spanning the full [0, 1]', () => {
    const { cells } = collect(2.2, 3.3, 2.2, 3.3);
    expect(cells).toEqual([{ cx: 2, cz: 3, t0: 0, t1: 1 }]);
  });
});

describe('traverseSegment: abort via the cell visitor', () => {
  it('stops immediately when the cell visitor returns false, and returns false', () => {
    const visited: [number, number][] = [];
    const ok = traverseSegment(GRID, 0.5, 0.5, 5.5, 0.5, (cx, cz) => {
      visited.push([cx, cz]);
      return visited.length < 2; // abort after the 2nd cell
    });
    expect(ok).toBe(false);
    expect(visited).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it('cells outside the grid are still reported (bounds checks are the visitor’s job)', () => {
    const visited: [number, number][] = [];
    traverseSegment(GRID, -2, 0.5, 2, 0.5, (cx, cz) => {
      visited.push([cx, cz]);
      return true;
    });
    expect(visited[0]).toEqual([-2, 0]);
  });
});
