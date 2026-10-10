/**
 * The heater shield (« écu ») of shield-bearing infantry, built in code: a curved heater outline
 * with a rim, a leather back and the side's arms on its face (the countess's gold chevron on
 * azure, the Félon's iron fess on gules). Vertex-coloured, painted like the units, carried on the
 * left fist bone: soldiers and wall guards read apart from militia and knights at a glance.
 */
import { BufferAttribute, Color, ExtrudeGeometry, Shape, ShapeGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Faction } from '../../core/rules/types.ts';
import { PALETTE } from '../materials/palette.ts';

/** Shield size (m): a heater for a 2.4 m figure. */
export const SHIELD_SIZE_M = { width: 0.56, height: 0.74, depth: 0.035 } as const;
/** Upper share of the sides that runs straight before curving to the point. */
const STRAIGHT_SHARE = 0.38;
/** Front bulge (m of depth at the edges per m² of x): the face curves round the arm. */
const BULGE_PER_M2 = 0.35;
/** The charge stands this far off the face (no depth fight). */
const CHARGE_LIFT_M = 0.004;
/** Charge width (share of the shield's height). */
const CHARGE_BAND = 0.16;
const CURVE_SEGMENTS = 6;

interface Arms {
  readonly field: string;
  readonly charge: string;
  readonly rim: string;
  readonly kind: 'chevron' | 'fess';
}

const ARMS: Readonly<Record<Faction, Arms>> = {
  attacker: { field: PALETTE.attacker.primary, charge: PALETTE.attacker.secondary, rim: PALETTE.attacker.secondary, kind: 'chevron' },
  defender: { field: PALETTE.defender.primary, charge: PALETTE.defender.secondary, rim: PALETTE.defender.secondary, kind: 'fess' },
};

function outline(): Shape {
  const { width: w, height: h } = SHIELD_SIZE_M;
  const top = h / 2;
  const bottom = -h / 2;
  const shoulder = top - h * STRAIGHT_SHARE;
  const s = new Shape();
  s.moveTo(-w / 2, top);
  s.lineTo(w / 2, top);
  s.lineTo(w / 2, shoulder);
  s.quadraticCurveTo(w / 2, bottom + h * 0.18, 0, bottom);
  s.quadraticCurveTo(-w / 2, bottom + h * 0.18, -w / 2, shoulder);
  s.closePath();
  return s;
}

/** The charge on the face: a chevron (point up) or a fess (a band across), inside the outline. */
function charge(kind: Arms['kind']): Shape {
  const { width: w, height: h } = SHIELD_SIZE_M;
  const band = h * CHARGE_BAND;
  const s = new Shape();
  if (kind === 'fess') {
    const y = h * 0.08;
    s.moveTo(-w / 2 + 0.01, y - band / 2);
    s.lineTo(w / 2 - 0.01, y - band / 2);
    s.lineTo(w / 2 - 0.01, y + band / 2);
    s.lineTo(-w / 2 + 0.01, y + band / 2);
  } else {
    const apex = h * 0.22;
    const foot = -h * 0.12;
    const x = w / 2 - 0.02;
    s.moveTo(0, apex);
    s.lineTo(x, foot);
    s.lineTo(x, foot - band);
    s.lineTo(0, apex - band * 1.3);
    s.lineTo(-x, foot - band);
    s.lineTo(-x, foot);
  }
  s.closePath();
  return s;
}

function paint(geometry: BufferGeometry, colorOf: (nz: number) => Color): void {
  const n = geometry.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) colorOf(n.getZ(i)).toArray(colors, i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

/** Bends a geometry round the arm: the face's edges fall back (z) with the square of x. */
function bend(geometry: BufferGeometry): void {
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - BULGE_PER_M2 * p.getX(i) * p.getX(i));
  p.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** One shield of a side, centred on its face (x right, y up, z out of the face), in metres. */
export function createShieldGeometry(faction: Faction): BufferGeometry {
  const arms = ARMS[faction];
  const field = new Color(arms.field);
  const rim = new Color(arms.rim);
  const back = new Color(PALETTE.woodWarm.base);
  const body = new ExtrudeGeometry(outline(), { depth: SHIELD_SIZE_M.depth, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
  body.translate(0, 0, -SHIELD_SIZE_M.depth);
  bend(body);
  paint(body, (nz) => (nz > 0.5 ? field : nz < -0.5 ? back : rim));
  const mark = new ShapeGeometry(charge(arms.kind), CURVE_SEGMENTS);
  mark.translate(0, 0, CHARGE_LIFT_M);
  bend(mark);
  const ink = new Color(arms.charge);
  paint(mark, () => ink);
  const merged = mergeGeometries([body.toNonIndexed(), mark.toNonIndexed()]);
  body.dispose();
  mark.dispose();
  if (!merged) throw new Error('shield: geometries could not be merged');
  merged.name = `Shield:${faction}`;
  return merged;
}
