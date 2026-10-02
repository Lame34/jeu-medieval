/**
 * Whether the 3D scene is ready: assets in, every shader program compiled. Until then the canvas
 * renders nothing (a frame drawn mid-load compiles its programs synchronously, one by one, on the
 * main thread) and the screens keep their loading overlay up.
 */
import { create } from 'zustand';

export interface SceneStatus {
  readonly ready: boolean;
  setReady(ready: boolean): void;
}

export const useSceneStatus = create<SceneStatus>((set) => ({
  ready: false,
  setReady: (ready) => set({ ready }),
}));
