/**
 * Torches and braziers at night (J5, brief §9.11): small flames at the castle's gates and towers
 * and before each house of the village, and the warm pools they cast (the painted shaders' torch
 * light, fed with the flames nearest to the camera focus). They come up at dusk and go out at
 * dawn; the rain dims them. Where they burn, shots at night are not penalised.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Matrix4, type InstancedBufferAttribute } from 'three';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useSceneConditions, useSceneHour } from '../../state/scene-conditions.ts';
import { nightness } from '../atmosphere/time-of-day.ts';
import { MAX_TORCHES } from '../materials/painted-chunks.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';
import { createFlameMesh } from './fire-fx.ts';

/** A flame's size (× the fire's flame); gate torches stand this high, braziers before the door. */
const TORCH_FLAME_SCALE = 0.32;
const BRAZIER_FLAME_SCALE = 0.42;
const GATE_TORCH_HEIGHT_M = 3.2;
const GATE_TORCH_OUT_M = 0.6;
const TOWER_TORCH_BELOW_TOP_M = 1.2;
const BRAZIER_HEIGHT_M = 1.0;
const BRAZIER_OUT_M = 1.4;
/** The rain dims the torches. */
const RAIN_DIM = 0.8;
/** Re-pick the nearest torches when the focus moves this far (m). */
const REPICK_STEP_M = 4;

interface TorchSite {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
}

/** Where the flames burn: either side of each gate, high on each tower's outer face, before each house. */
function torchSites(layout: WorldLayout): TorchSite[] {
  const out: TorchSite[] = [];
  const castle = [...layout.gates.map((g) => g.center), ...layout.towers.map((t) => t.center)];
  const centre: Vec2 = castle.length > 0 ? { x: castle.reduce((s, p) => s + p.x, 0) / castle.length, z: castle.reduce((s, p) => s + p.z, 0) / castle.length } : layout.focus;
  for (const g of layout.gates) {
    const a = g.rotationTurns * 2 * Math.PI;
    const fwd = { x: Math.sin(a), z: Math.cos(a) };
    const right = { x: fwd.z, z: -fwd.x };
    for (const side of [-1, 1]) {
      const off = g.openingM / 2 + GATE_TORCH_OUT_M;
      out.push({ x: g.center.x + right.x * off * side + fwd.x * 1.6, y: g.baseHeightM + GATE_TORCH_HEIGHT_M, z: g.center.z + right.z * off * side + fwd.z * 1.6, scale: TORCH_FLAME_SCALE });
    }
  }
  for (const t of layout.towers) {
    const dx = t.center.x - centre.x;
    const dz = t.center.z - centre.z;
    const len = Math.hypot(dx, dz) || 1;
    out.push({ x: t.center.x + (dx / len) * (t.radiusM + 0.3), y: t.baseHeightM + t.heightM - TOWER_TORCH_BELOW_TOP_M, z: t.center.z + (dz / len) * (t.radiusM + 0.3), scale: TORCH_FLAME_SCALE });
  }
  for (const h of layout.houses) {
    const a = h.rotationTurns * 2 * Math.PI;
    const d = h.depthM / 2 + BRAZIER_OUT_M;
    out.push({ x: h.center.x + Math.sin(a) * d, y: h.baseHeightM + BRAZIER_HEIGHT_M, z: h.center.z + Math.cos(a) * d, scale: BRAZIER_FLAME_SCALE });
  }
  return out;
}

export function Torches({ layout }: { readonly layout: WorldLayout }) {
  const hour = useSceneHour();
  const weather = useSceneConditions((s) => s.weather);
  const sites = useMemo(() => torchSites(layout), [layout]);
  const time = useMemo(() => ({ value: 0 }), []);
  const flames = useMemo(() => createFlameMesh(Math.max(1, sites.length), time, 'Torches:flames'), [sites, time]);
  const strength = nightness(hour) * (weather === 'rain' ? RAIN_DIM : 1);

  useEffect(() => {
    const m = new Matrix4();
    const seeds = flames.geometry.getAttribute('aFlame') as InstancedBufferAttribute;
    sites.forEach((s, i) => {
      flames.setMatrixAt(i, m.makeTranslation(s.x, s.y, s.z));
      seeds.setXYZW(i, (i * 0.618) % 1, s.scale, (i * 0.37) % 1, 0);
    });
    flames.instanceMatrix.needsUpdate = true;
    seeds.needsUpdate = true;
    paintedGlobals.uTorchRadius.value = DEFAULT_RULES.weather.lightRadiusM;
    return () => {
      flames.geometry.dispose();
      (flames.material as { dispose(): void }).dispose();
      paintedGlobals.uTorchStrength.value = 0;
    };
  }, [flames, sites]);

  useEffect(() => {
    // Flames only while it is dark enough (no draw call by day; the program is compiled anyway).
    flames.count = strength > 0 ? sites.length : 0;
    paintedGlobals.uTorchStrength.value = strength;
  }, [flames, sites, strength]);

  const last = useMemo(() => ({ x: Number.POSITIVE_INFINITY, z: 0, n: -1 }), []);
  const order = useMemo(() => new Int32Array(sites.length), [sites]);
  const dist = useMemo(() => new Float32Array(sites.length), [sites]);
  useFrame((_, delta) => {
    time.value += delta;
    if (strength <= 0) return;
    const focus = paintedGlobals.uFocus.value;
    if (Math.hypot(focus.x - last.x, focus.z - last.z) < REPICK_STEP_M && last.n === sites.length) return;
    last.x = focus.x;
    last.z = focus.z;
    last.n = sites.length;
    // The nearest MAX_TORCHES flames light the shaders (insertion into a short sorted list).
    let kept = 0;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i] as TorchSite;
      const d = (s.x - focus.x) ** 2 + (s.z - focus.z) ** 2;
      let j = Math.min(kept, MAX_TORCHES - 1);
      if (kept === MAX_TORCHES && d >= (dist[j] as number)) continue;
      while (j > 0 && (dist[j - 1] as number) > d) {
        dist[j] = dist[j - 1] as number;
        order[j] = order[j - 1] as number;
        j--;
      }
      dist[j] = d;
      order[j] = i;
      if (kept < MAX_TORCHES) kept++;
    }
    const torches = paintedGlobals.uTorches.value;
    for (let k = 0; k < MAX_TORCHES; k++) {
      const v = torches[k];
      if (!v) continue;
      if (k < kept) {
        const s = sites[order[k] as number] as TorchSite;
        v.set(s.x, s.y, s.z, 1);
      } else v.set(0, -1e4, 0, 0);
    }
  });

  return <primitive object={flames} />;
}
