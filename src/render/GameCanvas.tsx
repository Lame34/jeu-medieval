/**
 * The single WebGL2 canvas, configured for the "Portable" budget: DPR capped, no native MSAA
 * (SMAA in post), one shadow-casting light, ACES tone mapping in the post chain.
 */
import { Canvas } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { NoToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import { useSettings } from '../state/settings.ts';
import { PerfProbe } from './debug/PerfProbe.tsx';
import { QUALITY_PRESETS } from './quality/presets.ts';

const NEAR_M = 0.5;
const FAR_M = 6000;
const FOV_DEG = 38;

export function GameCanvas({ children }: { readonly children: ReactNode }) {
  const preset = QUALITY_PRESETS[useSettings((s) => s.quality)];
  const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio, preset.maxDpr);
  return (
    <Canvas
      dpr={dpr}
      shadows={{ type: PCFShadowMap }}
      camera={{ fov: FOV_DEG, near: NEAR_M, far: FAR_M, position: [60, 60, 120] }}
      gl={{
        antialias: false,
        alpha: false,
        stencil: false,
        depth: true,
        powerPreference: 'high-performance',
        toneMapping: NoToneMapping,
        outputColorSpace: SRGBColorSpace,
      }}
      flat
    >
      {children}
      <PerfProbe />
    </Canvas>
  );
}
