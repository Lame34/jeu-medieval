/**
 * Arrows, bolts and catapult stones in flight (projectiles.ts), launched by the battle director
 * through a handle: no React state, no allocation per frame.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { PerspectiveCamera, Vector3 } from 'three';
import { ProjectilePool } from './projectiles.ts';

export interface ProjectileHandle {
  /** Flight time (s). The points are copied. */
  arrow(from: Vector3, to: Vector3, burning: boolean, onLand: (() => void) | null): number;
  stone(from: Vector3, to: Vector3, onLand: (() => void) | null): number;
}

/** Tests (`?fast`) play the battle animations this much faster (same switch as BattleDirector). */
const TIME_SCALE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fast') ? 8 : 1;

export function Projectiles({
  waterAt,
  groundAt,
  onHandle,
}: {
  readonly waterAt: (x: number, z: number) => boolean;
  readonly groundAt: (x: number, z: number) => number;
  readonly onHandle: (h: ProjectileHandle | null) => void;
}) {
  const size = useThree((s) => s.size);
  const pool = useMemo(() => new ProjectilePool({ waterAt, groundAt }), [waterAt, groundAt]);
  useEffect(() => {
    onHandle({ arrow: (a, b, burning, land) => pool.arrow(a, b, burning, land), stone: (a, b, land) => pool.stone(a, b, land) });
    return () => onHandle(null);
  }, [pool, onHandle]);
  useEffect(() => () => pool.dispose(), [pool]);
  useFrame((state, delta) => {
    const camera = state.camera as PerspectiveCamera;
    pool.update(Math.min(delta, 0.1) * TIME_SCALE, size.height / (2 * Math.tan(((camera.fov ?? 50) * Math.PI) / 360)));
  });
  return <primitive object={pool.group} />;
}
