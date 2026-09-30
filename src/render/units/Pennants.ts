/**
 * Allegiance pennants above units seen from afar (brief §5.1 "lisibilité tactique"): at
 * tactical zoom a 2.4 m figure is ~40 px and its colours get lost; a small flag on a pole,
 * in the side's colour and shape (attacker: pointed pennant ▲, defender: square banner ■),
 * reads at a glance. One InstancedMesh per side, billboarded towards the camera, fading in
 * beyond close-up distances.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { Faction } from '../../core/rules/types.ts';
import { PALETTE } from '../materials/palette.ts';

const POLE_M = 0.9;
const POLE_WIDTH_M = 0.05;
const FLAG_W_M = 0.5;
const FLAG_H_M = 0.34;
/** Camera distances (m) over which pennants fade in; they grow like the rings farther out. */
export const PENNANT_FADE_IN_M: readonly [number, number] = [22, 38];
const POLE_COLOR = '#3c3f44';

function quad(out: number[], colors: number[], c: Color, a: number[], b: number[], cc: number[], d: number[]): void {
  for (const v of [a, b, cc, a, cc, d]) {
    out.push(...v);
    colors.push(c.r, c.g, c.b);
  }
}

function pennantGeometry(faction: Faction): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const pole = new Color(POLE_COLOR);
  const flag = new Color(PALETTE[faction].primary);
  const hem = new Color(PALETTE[faction].secondary);
  const w = POLE_WIDTH_M / 2;
  quad(positions, colors, pole, [-w, 0, 0], [w, 0, 0], [w, POLE_M, 0], [-w, POLE_M, 0]);
  const top = POLE_M;
  const bottom = POLE_M - FLAG_H_M;
  if (faction === 'attacker') {
    // Pointed pennant with a gold hem along the top.
    for (const v of [[w, top, 0], [w, bottom, 0], [w + FLAG_W_M, (top + bottom) / 2, 0]]) {
      positions.push(...v);
      colors.push(flag.r, flag.g, flag.b);
    }
    const edgeY = top - (FLAG_H_M / 2) * 0.85;
    quad(positions, colors, hem, [w, top, 0.001], [w, top - 0.05, 0.001], [w + FLAG_W_M * 0.85, edgeY - 0.05, 0.001], [w + FLAG_W_M * 0.85, edgeY, 0.001]);
  } else {
    quad(positions, colors, flag, [w, bottom, 0], [w + FLAG_W_M, bottom, 0], [w + FLAG_W_M, top, 0], [w, top, 0]);
    quad(positions, colors, hem, [w, bottom, 0.001], [w + FLAG_W_M, bottom, 0.001], [w + FLAG_W_M, bottom + 0.06, 0.001], [w, bottom + 0.06, 0.001]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  return g;
}

export interface Pennants {
  readonly mesh: InstancedMesh;
  /** Places every pennant above its anchor, facing the camera, scaled for the distance. */
  update(anchors: readonly Vector3[], cameraPosition: Vector3, cameraDistance: number, sizeScale: number): void;
  dispose(): void;
}

export function createPennants(faction: Faction, capacity: number, heightM: number): Pennants {
  const geometry = pennantGeometry(faction);
  const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false });
  const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.name = `Pennants:${faction}`;
  mesh.frustumCulled = false;
  mesh.count = 0;
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const up = new Vector3(0, 1, 0);
  return {
    mesh,
    update(anchors, cameraPosition, cameraDistance, sizeScale) {
      const [a, b] = PENNANT_FADE_IN_M;
      const fade = Math.min(1, Math.max(0, (cameraDistance - a) / (b - a)));
      mesh.visible = fade > 0;
      if (!mesh.visible) return;
      mesh.count = anchors.length;
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i] as Vector3;
        p.set(anchor.x, anchor.y + heightM, anchor.z);
        q.setFromAxisAngle(up, Math.atan2(cameraPosition.x - p.x, cameraPosition.z - p.z));
        s.setScalar(fade * sizeScale);
        mesh.setMatrixAt(i, m.compose(p, q, s));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
