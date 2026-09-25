import { describe, expect, it } from 'vitest';
import { TerrainLayer, lineOfSight, setHeightAtCorner, vec2 } from '@core/index.ts';
import { DEFAULT_RULES } from '@data/index.ts';
import { buildNav, fillRect, flatTerrain } from './helpers.ts';

const EYE_HEIGHT_M = DEFAULT_RULES.movement.eyeHeightM;
const TARGET_HEIGHT_M = DEFAULT_RULES.movement.targetHeightM;
const CORRIDOR_DEPTH = 3;
const CORRIDOR_Z = 1.5; // centre of the middle row, cell cz = 1

describe('lineOfSight: clear terrain', () => {
  it('is visible with zero obscurance across flat, empty ground', () => {
    const nav = buildNav(flatTerrain(20, CORRIDOR_DEPTH, 1));
    const result = lineOfSight(nav, {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(19.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    });
    expect(result).toEqual({ visible: true, obscurance: 0, blockedBy: null });
  });
});

describe('lineOfSight: terrain relief', () => {
  it('a hill between shooter and target blocks sight ("terrain")', () => {
    const width = 20;
    const t = flatTerrain(width, CORRIDOR_DEPTH, 1);
    // A tall plateau in the middle of the corridor, well above eye/target height.
    for (let iz = 0; iz <= CORRIDOR_DEPTH; iz++) {
      for (let ix = 8; ix <= 12; ix++) setHeightAtCorner(t, ix, iz, 20);
    }
    const nav = buildNav(t);
    const result = lineOfSight(nav, {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(19.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    });
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('terrain');
  });

  it('elevating the shooter (fromElevationM) lets it see over the same hill', () => {
    const width = 20;
    const t = flatTerrain(width, CORRIDOR_DEPTH, 1);
    for (let iz = 0; iz <= CORRIDOR_DEPTH; iz++) {
      for (let ix = 8; ix <= 12; ix++) setHeightAtCorner(t, ix, iz, 5);
    }
    const nav = buildNav(t);
    const query = {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(19.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    };
    const blocked = lineOfSight(nav, query);
    expect(blocked.blockedBy).toBe('terrain');
    const fromTower = lineOfSight(nav, { ...query, fromElevationM: 10 });
    expect(fromTower.visible).toBe(true);
    expect(fromTower.blockedBy).toBeNull();
  });
});

describe('lineOfSight: obstacles', () => {
  it('a wall blocks sight entirely ("obstacle")', () => {
    const t = flatTerrain(6, CORRIDOR_DEPTH, 1);
    fillRect(t, 2, 1, 3, 1, TerrainLayer.Wall); // two Wall cells strictly between shooter and target
    const nav = buildNav(t);
    const result = lineOfSight(nav, {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(5.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    });
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('obstacle');
    expect(result.obscurance).toBe(1);
  });

  it('a short stretch of forest is visible but obscured (obscurance > 0)', () => {
    const t = flatTerrain(10, CORRIDOR_DEPTH, 1);
    fillRect(t, 5, 1, 5, 1, TerrainLayer.Forest); // one Forest cell
    const nav = buildNav(t);
    const result = lineOfSight(nav, {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(9.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    });
    expect(result.visible).toBe(true);
    expect(result.obscurance).toBeGreaterThan(0);
    expect(result.obscurance).toBeLessThan(1);
    expect(result.blockedBy).toBeNull();
  });

  it('a long stretch of forest accumulates enough obscurance to block sight', () => {
    const width = 30;
    const t = flatTerrain(width, CORRIDOR_DEPTH, 1);
    fillRect(t, 3, 1, 24, 1, TerrainLayer.Forest); // 22 consecutive Forest cells
    const nav = buildNav(t);
    const result = lineOfSight(nav, {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(29.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    });
    expect(result.visible).toBe(false);
    expect(result.blockedBy).toBe('obstacle');
    expect(result.obscurance).toBe(1); // clamped to OPAQUE_OBSCURANCE
  });
});

describe('lineOfSight: shooter/target cells never self-block', () => {
  it('standing the shooter on a Wall cell does not block its own sight', () => {
    const t = flatTerrain(6, CORRIDOR_DEPTH, 1);
    fillRect(t, 0, 1, 0, 1, TerrainLayer.Wall); // the shooter's own cell is a Wall
    const nav = buildNav(t);
    const result = lineOfSight(nav, {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(5.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    });
    expect(result.visible).toBe(true);
    expect(result.obscurance).toBe(0);
  });

  it('standing the target on a Wall cell does not block sight to it', () => {
    const t = flatTerrain(6, CORRIDOR_DEPTH, 1);
    fillRect(t, 5, 1, 5, 1, TerrainLayer.Wall); // the target's own cell is a Wall
    const nav = buildNav(t);
    const result = lineOfSight(nav, {
      from: vec2(0.5, CORRIDOR_Z),
      to: vec2(5.5, CORRIDOR_Z),
      eyeHeightM: EYE_HEIGHT_M,
      targetHeightM: TARGET_HEIGHT_M,
    });
    expect(result.visible).toBe(true);
  });
});
