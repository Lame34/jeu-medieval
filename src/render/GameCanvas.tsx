/**
 * The single WebGL2 canvas: DPR capped by the quality preset (supersampled at high), no native MSAA
 * (SMAA in post), one shadow-casting light, ACES tone mapping in the post chain. It draws no
 * frame until the scene is ready (useSceneStatus, set by WorldScene once every program is
 * compiled in parallel): a frame drawn mid-load links its programs synchronously.
 */
import { Canvas } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { NoToneMapping, PCFShadowMap, SRGBColorSpace } from 'three';
import { useSceneStatus } from '../state/scene-status.ts';
import { PerfProbe } from './debug/PerfProbe.tsx';
import { useQualityPreset } from './quality/use-quality-preset.ts';
import { MIRROR_HIDDEN_LAYER } from './water/reflection.ts';

const NEAR_M = 0.5;
const FAR_M = 6000;
const FOV_DEG = 38;

export function GameCanvas({ children }: { readonly children: ReactNode }) {
  const preset = useQualityPreset();
  // Supersampling (the high preset draws at 1.5 times the screen's pixels), within the preset's cap.
  const dpr = Math.min((typeof window === 'undefined' ? 1 : window.devicePixelRatio) * preset.renderScale, preset.maxDpr);
  const ready = useSceneStatus((s) => s.ready);
  return (
    <Canvas
      frameloop={ready ? 'always' : 'never'}
      dpr={dpr}
      shadows={{ type: PCFShadowMap }}
      camera={{ fov: FOV_DEG, near: NEAR_M, far: FAR_M, position: [60, 60, 120] }}
      // The view sees what the moat's mirror leaves out (water/reflection.ts).
      onCreated={({ camera }) => camera.layers.enable(MIRROR_HIDDEN_LAYER)}
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
