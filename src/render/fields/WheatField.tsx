/**
 * Wheat and rye fields: instanced tufts of stalks with ears, on a jittered grid clipped to the
 * parcel polygon with a noisy, thinning edge. The painted wind (phase = world position) makes
 * travelling waves roll across the field.
 */
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { createSimplex } from '../../core/noise/noise.ts';
import { Rng } from '../../core/rng.ts';
import { sampleHeight, type TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { distanceToPolygonEdge, pointInPolygon } from '../../core/worldgen/geometry.ts';
import type { FieldPatch } from '../../core/worldgen/types.ts';
import { PALETTE } from '../materials/palette.ts';
import { createPaintedMaterial } from '../materials/painted-material.ts';

const SPACING_M = 0.34;
const EDGE_FADE_M = 2.2;
const STALKS = 7;
const TUFT_HEIGHT_M = 1.05;
const STALK_WIDTH_M = 0.1;
const EAR_LENGTH_M = 0.26;
const EAR_WIDTH_M = 0.14;
const WHEAT_SWAY_M = 0.2;
const UP = new Vector3(0, 1, 0);

function tuftGeometry(lit: string, base: string): BufferGeometry {
  const rng = Rng.create('wheat-tuft');
  const positions: number[] = [];
  const colors: number[] = [];
  const cLit = new Color(lit);
  const cBase = new Color(base);
  const earColor = new Color(lit).offsetHSL(0, -0.04, 0.06);
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, ca: Color, cb: Color) => {
    for (const [p, col] of [
      [a, ca],
      [b, ca],
      [c, cb],
      [a, ca],
      [c, cb],
      [d, cb],
    ] as const) {
      positions.push(p.x, p.y, p.z);
      colors.push(col.r, col.g, col.b);
    }
  };
  for (let s = 0; s < STALKS; s++) {
    const angle = (s / STALKS) * Math.PI + rng.float(-0.3, 0.3);
    const lean = new Vector3(rng.float(-0.12, 0.12), 0, rng.float(-0.12, 0.12));
    const h = TUFT_HEIGHT_M * rng.float(0.8, 1.1);
    const offset = new Vector3(rng.float(-0.12, 0.12), 0, rng.float(-0.12, 0.12));
    const side = new Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(STALK_WIDTH_M / 2);
    const top = offset.clone().add(lean).setY(h - EAR_LENGTH_M);
    quad(offset.clone().sub(side), offset.clone().add(side), top.clone().add(side.clone().multiplyScalar(0.5)), top.clone().sub(side.clone().multiplyScalar(0.5)), cBase, cLit);
    const earSide = side.clone().normalize().multiplyScalar(EAR_WIDTH_M / 2);
    const earTop = top.clone().add(lean.clone().multiplyScalar(0.4)).setY(h);
    quad(top.clone().sub(earSide), top.clone().add(earSide), earTop.clone().add(earSide.clone().multiplyScalar(0.3)), earTop.clone().sub(earSide.clone().multiplyScalar(0.3)), earColor, earColor);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  // Stalk normals point up-ish: fields read as a soft lit mass, not as flickering cards.
  const nor = g.getAttribute('normal');
  const n = new Vector3();
  for (let i = 0; i < nor.count; i++) {
    n.fromBufferAttribute(nor, i).lerp(UP, 0.65).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

export function Fields({ fields, terrain }: { readonly fields: readonly FieldPatch[]; readonly terrain: TerrainData }) {
  const meshes = useMemo(() => {
    const out: InstancedMesh[] = [];
    for (const field of fields) {
      if (field.crop === 'fallow') continue;
      const palette = field.crop === 'wheat' ? PALETTE.wheat : PALETTE.rye;
      const rng = Rng.create(`field:${field.id}`);
      const noise = createSimplex(rng.fork('edge'));
      const xs = field.polygon.map((p) => p.x);
      const zs = field.polygon.map((p) => p.z);
      const spots: { x: number; z: number; s: number }[] = [];
      for (let z = Math.min(...zs); z < Math.max(...zs); z += SPACING_M) {
        for (let x = Math.min(...xs); x < Math.max(...xs); x += SPACING_M) {
          const p = { x: x + rng.float(-0.18, 0.18), z: z + rng.float(-0.18, 0.18) };
          if (!pointInPolygon(p, field.polygon)) continue;
          const edge = distanceToPolygonEdge(p, field.polygon);
          const keep = Math.min(1, edge / EDGE_FADE_M) + noise(p.x * 0.3, p.z * 0.3) * 0.35;
          if (rng.next() > keep) continue;
          spots.push({ x: p.x, z: p.z, s: Math.min(1, 0.55 + edge / EDGE_FADE_M) });
        }
      }
      const geometry = tuftGeometry(palette.lit, palette.base);
      const material = createPaintedMaterial({
        name: `Field:${field.id}`,
        vertexColors: true,
        heightM: TUFT_HEIGHT_M,
        windSwayM: WHEAT_SWAY_M,
        gradientBase: 0.62,
        gradientTop: 1.12,
        groundAO: 0.15,
        side: DoubleSide,
        keepNormalOnBackFaces: true,
      });
      const mesh = new InstancedMesh(geometry, material, spots.length);
      const m = new Matrix4();
      const q = new Quaternion();
      const s = new Vector3();
      const p = new Vector3();
      const c = new Color();
      spots.forEach((spot, i) => {
        p.set(spot.x, sampleHeight(terrain, spot.x, spot.z) - 0.05, spot.z);
        q.setFromAxisAngle(UP, rng.next() * Math.PI * 2);
        s.set(1, spot.s * rng.float(0.85, 1.1), 1);
        mesh.setMatrixAt(i, m.compose(p, q, s));
        const v = 0.9 + 0.2 * (noise(spot.x * 0.08, spot.z * 0.08) * 0.5 + 0.5);
        mesh.setColorAt(i, c.setRGB(v, v, v * 0.97));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = `Field:${field.id}`;
      out.push(mesh);
    }
    return out;
  }, [fields, terrain]);

  useEffect(
    () => () => {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as { dispose(): void }).dispose();
        mesh.dispose();
      }
    },
    [meshes],
  );

  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </>
  );
}
