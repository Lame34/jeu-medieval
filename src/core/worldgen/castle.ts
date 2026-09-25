/**
 * Castle planning (brief §9.12 step 6): an enclosure hugging the butte top — a noisy ring of
 * 3–8 towers joined by curtain walls, a gatehouse facing the approach road, a keep at the back
 * of the courtyard and a moat ring. Pure geometry; the battle generator stamps it into terrain.
 */
import type { Vec2 } from '../math/vec2.ts';
import type { Rng } from '../rng.ts';
import type { GateSite, KeepSite, TowerSite, WallRun, WaterBody } from './types.ts';

export interface CastleParams {
  readonly center: Vec2;
  readonly radiusM: number;
  readonly towerCount: number;
  /** Unit direction from the castle towards the approach (gate side). */
  readonly approach: Vec2;
  readonly baseHeightM: number;
  readonly wallHeightM: number;
  readonly wallThicknessM: number;
  readonly towerRadiusM: number;
  readonly towerHeightM: number;
  readonly gateOpeningM: number;
  readonly moatOffsetM: number;
  readonly moatWidthM: number;
  /** Moat water sits this far below the plateau. */
  readonly moatDepthM: number;
  readonly idPrefix: string;
}

export interface CastlePlan {
  readonly ring: readonly Vec2[];
  readonly walls: readonly WallRun[];
  readonly towers: readonly TowerSite[];
  readonly gate: GateSite;
  readonly keep: KeepSite | null;
  readonly moat: WaterBody;
  /** Where the drawbridge lands outside the moat (road target). */
  readonly gateApproach: Vec2;
}

const RING_JITTER = 0.14;
const ANGLE_JITTER = 0.18;
const GATE_TOWER_OFFSET = 1.15;
const GATE_TOWER_SIZE = 0.8;
const KEEP_BACK_OFFSET = 0.32;
const KEEP_SIZE = 0.34;
const KEEP_HEIGHT_RATIO = 1.7;
const MOAT_SAMPLES = 48;

function angleOf(v: Vec2): number {
  return Math.atan2(v.z, v.x);
}

/** Turns such that a local +z axis points along `dir` (matches three's rotation.y convention). */
export function turnsFacing(dir: Vec2): number {
  return Math.atan2(dir.x, dir.z) / (2 * Math.PI);
}

export function planCastle(rng: Rng, p: CastleParams): CastlePlan {
  const gateAngle = angleOf(p.approach);
  // Towers: evenly spread, jittered, with the gate between the two towers nearest the approach.
  const n = p.towerCount;
  const offset = gateAngle + Math.PI / n;
  const corners: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * 2 * Math.PI + rng.float(-ANGLE_JITTER, ANGLE_JITTER) * (Math.PI / n);
    const r = p.radiusM * (1 + rng.float(-RING_JITTER, RING_JITTER));
    corners.push({ x: p.center.x + Math.cos(a) * r, z: p.center.z + Math.sin(a) * r });
  }
  // The gate sits on the segment from the last corner back to the first (it straddles gateAngle).
  const a = corners[n - 1] as Vec2;
  const b = corners[0] as Vec2;
  const gateCenter = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const segLen = Math.hypot(b.x - a.x, b.z - a.z);
  const ux = (b.x - a.x) / segLen;
  const uz = (b.z - a.z) / segLen;
  const outward = { x: gateCenter.x - p.center.x, z: gateCenter.z - p.center.z };
  const outLen = Math.hypot(outward.x, outward.z) || 1;
  const out = { x: outward.x / outLen, z: outward.z / outLen };
  const half = p.gateOpeningM / 2 + p.towerRadiusM * GATE_TOWER_OFFSET;
  const gateLeft = { x: gateCenter.x - ux * half, z: gateCenter.z - uz * half };
  const gateRight = { x: gateCenter.x + ux * half, z: gateCenter.z + uz * half };

  // gateRight → corner0 … corner(n-1) → gateLeft: the whole ring minus the gate opening.
  const walls: WallRun[] = [
    { id: `${p.idPrefix}wall-main`, points: [gateRight, ...corners, gateLeft], heightM: p.wallHeightM, thicknessM: p.wallThicknessM, baseHeightM: p.baseHeightM },
  ];

  const towers: TowerSite[] = corners.map((c, i) => ({
    id: `${p.idPrefix}tower-${i}`,
    center: c,
    radiusM: p.towerRadiusM,
    heightM: p.towerHeightM,
    baseHeightM: p.baseHeightM,
    shape: 'round',
  }));
  for (const [side, pos] of [
    ['l', gateLeft],
    ['r', gateRight],
  ] as const) {
    towers.push({
      id: `${p.idPrefix}gate-tower-${side}`,
      center: pos,
      radiusM: p.towerRadiusM * GATE_TOWER_SIZE,
      heightM: p.towerHeightM * 0.92,
      baseHeightM: p.baseHeightM,
      shape: 'square',
    });
  }

  const gate: GateSite = {
    id: `${p.idPrefix}gate`,
    center: gateCenter,
    rotationTurns: turnsFacing(out),
    openingM: p.gateOpeningM,
    heightM: p.wallHeightM,
    baseHeightM: p.baseHeightM,
    drawbridge: true,
  };

  const keepCenter = { x: p.center.x - out.x * p.radiusM * KEEP_BACK_OFFSET, z: p.center.z - out.z * p.radiusM * KEEP_BACK_OFFSET };
  const keepSize = p.radiusM * KEEP_SIZE;
  const keep: KeepSite = {
    id: `${p.idPrefix}keep`,
    center: keepCenter,
    widthM: keepSize,
    depthM: keepSize * rng.float(0.85, 1.1),
    heightM: p.towerHeightM * KEEP_HEIGHT_RATIO,
    rotationTurns: turnsFacing(out),
    baseHeightM: p.baseHeightM,
  };

  // Moat: a closed loop at a constant distance outside the ring (radial offset of a smoothed ring).
  const moatLine: Vec2[] = [];
  for (let i = 0; i <= MOAT_SAMPLES; i++) {
    const ang = (i / MOAT_SAMPLES) * 2 * Math.PI;
    const r = ringRadiusAt(corners, p.center, ang) + p.moatOffsetM;
    moatLine.push({ x: p.center.x + Math.cos(ang) * r, z: p.center.z + Math.sin(ang) * r });
  }
  const moat: WaterBody = { id: `${p.idPrefix}moat`, kind: 'moat', centerline: moatLine, widthM: p.moatWidthM, levelM: p.baseHeightM - p.moatDepthM };
  const gateReach = ringRadiusAt(corners, p.center, angleOf(out)) + p.moatOffsetM + p.moatWidthM;
  const gateApproach = { x: p.center.x + out.x * (gateReach + 4), z: p.center.z + out.z * (gateReach + 4) };

  return { ring: corners, walls, towers, gate, keep, moat, gateApproach };
}

/** Distance from the centre to the (polygonal) ring along an angle. */
export function ringRadiusAt(corners: readonly Vec2[], center: Vec2, angle: number): number {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  let best = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i] as Vec2;
    const b = corners[(i + 1) % corners.length] as Vec2;
    // Ray (center, d) vs segment (a, b).
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const det = dx * -ez - dz * -ex;
    if (Math.abs(det) < 1e-9) continue;
    const ax = a.x - center.x;
    const az = a.z - center.z;
    const t = (ax * -ez - az * -ex) / det;
    const u = (dx * az - dz * ax) / det;
    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  return best;
}
