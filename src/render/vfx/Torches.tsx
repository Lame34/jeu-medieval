/**
 * Torches and braziers at night (J5, brief §9.11): small flames at the castle's gates and towers
 * and before each house of the village, and the warm pools they cast, baked once into a map the
 * painted shaders read (one texture fetch; the torches never move). They come up at dusk and go
 * out at dawn; the rain dims them. Where they burn, shots at night are not penalised.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { DataTexture, LinearFilter, Matrix4, RGBAFormat, Vector2, type InstancedBufferAttribute } from 'three';
import type { Vec2 } from '../../core/math/vec2.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import { DEFAULT_RULES } from '../../data/index.ts';
import { useSceneConditions, useSceneHour } from '../../state/scene-conditions.ts';
import { nightness } from '../atmosphere/time-of-day.ts';
import { paintedGlobals, setTorchMap } from '../materials/painted-globals.ts';
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
/** The torchlight map: metres per texel, and the flame heights it can hold (m). */
const TORCH_TEXEL_M = 2;
const TORCH_HEIGHT_RANGE_M = 128;
/** A pool is full within this share of the reach, then fades out to it. */
const TORCH_CORE = 0.3;

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

/** Bakes the pools: r = strongest glow at the texel, g = that torch's height (/ range). */
function bakeTorchMap(sites: readonly TorchSite[], widthM: number, depthM: number, reachM: number): DataTexture {
  const w = Math.ceil(widthM / TORCH_TEXEL_M);
  const h = Math.ceil(depthM / TORCH_TEXEL_M);
  const data = new Uint8Array(w * h * 4);
  const span = Math.ceil(reachM / TORCH_TEXEL_M);
  for (const s of sites) {
    const cx = Math.floor(s.x / TORCH_TEXEL_M);
    const cz = Math.floor(s.z / TORCH_TEXEL_M);
    for (let z = Math.max(0, cz - span); z <= Math.min(h - 1, cz + span); z++) {
      for (let x = Math.max(0, cx - span); x <= Math.min(w - 1, cx + span); x++) {
        const d = Math.hypot((x + 0.5) * TORCH_TEXEL_M - s.x, (z + 0.5) * TORCH_TEXEL_M - s.z);
        const k = d >= reachM ? 0 : d <= reachM * TORCH_CORE ? 1 : 1 - smoothstep01((d - reachM * TORCH_CORE) / (reachM * (1 - TORCH_CORE)));
        const i = (z * w + x) * 4;
        const glow = Math.round(k * 255);
        if (glow <= (data[i] as number)) continue;
        data[i] = glow;
        data[i + 1] = Math.round(Math.min(1, Math.max(0, s.y / TORCH_HEIGHT_RANGE_M)) * 255);
        data[i + 3] = 255;
      }
    }
  }
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
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
    const widthM = layout.terrain.width * layout.terrain.cellSize;
    const depthM = layout.terrain.depth * layout.terrain.cellSize;
    const map = bakeTorchMap(sites, widthM, depthM, DEFAULT_RULES.weather.lightRadiusM);
    setTorchMap(map, new Vector2(widthM, depthM), TORCH_HEIGHT_RANGE_M);
    return () => {
      flames.geometry.dispose();
      (flames.material as { dispose(): void }).dispose();
      setTorchMap(null, null, 1);
      map.dispose();
      paintedGlobals.uTorchStrength.value = 0;
    };
  }, [flames, sites, layout]);

  useEffect(() => {
    // Flames only while it is dark enough (no draw call by day; the program is compiled anyway).
    flames.count = strength > 0 ? sites.length : 0;
    paintedGlobals.uTorchStrength.value = strength;
  }, [flames, sites, strength]);

  useFrame((_, delta) => {
    time.value += delta;
  });

  return <primitive object={flames} />;
}
