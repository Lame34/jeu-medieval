/**
 * The battle's fires on screen (fire-fx.ts), synced by the battle director on fire events through
 * a handle: no React state, no allocation per frame.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import type { PerspectiveCamera } from 'three';
import type { BattleState } from '../../core/battle/types.ts';
import { FireField, type FireCell } from './fire-fx.ts';

export interface FireHandle {
  /** Shows the fires and scorched ground of `state`. */
  syncFrom(state: BattleState): void;
}

/** Tests (`?fast`) play the battle animations this much faster (same switch as BattleDirector). */
const TIME_SCALE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('fast') ? 8 : 1;

export function Fire({ width, heightAt, onHandle }: { readonly width: number; readonly heightAt: (x: number, z: number) => number; readonly onHandle: (h: FireHandle | null) => void }) {
  const size = useThree((s) => s.size);
  const field = useMemo(() => new FireField(), []);
  useEffect(() => {
    const cellOf = (cell: number): FireCell => {
      const x = (cell % width) + 0.5;
      const z = Math.floor(cell / width) + 0.5;
      return { x, y: heightAt(x, z), z, seed: cell };
    };
    onHandle({ syncFrom: (state) => field.sync(state.fires.map((f) => cellOf(f.cell)), state.burnt.map(cellOf)) });
    return () => onHandle(null);
  }, [field, width, heightAt, onHandle]);
  useEffect(() => () => field.dispose(), [field]);
  useFrame((state, delta) => {
    const camera = state.camera as PerspectiveCamera;
    field.update(Math.min(delta, 0.1) * TIME_SCALE, size.height / (2 * Math.tan(((camera.fov ?? 50) * Math.PI) / 360)));
  });
  return <primitive object={field.group} />;
}
