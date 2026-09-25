import type { CameraLimits, CameraView } from '../camera/TacticalCamera.tsx';

/** The four fixed look-dev angles captured at three hours (brief §13). */
export const LOOKDEV_VIEWS: readonly (CameraView & { readonly id: string; readonly label: string })[] = [
  { id: 'overview', label: 'Vue d’ensemble', focus: { x: 72, z: 66 }, distance: 118, yawTurns: 0.11, pitchDeg: 48 },
  { id: 'tactical', label: 'Vue tactique', focus: { x: 74, z: 64 }, distance: 58, yawTurns: 0.05, pitchDeg: 50 },
  { id: 'close', label: 'Plan rapproché', focus: { x: 69, z: 67 }, distance: 17, yawTurns: 0.16, pitchDeg: 30 },
  { id: 'castle', label: 'Mur et tour', focus: { x: 98, z: 34 }, distance: 48, yawTurns: 0.36, pitchDeg: 13 },
];

export const LOOKDEV_HOURS: readonly { readonly id: string; readonly label: string; readonly hour: number }[] = [
  { id: 'morning', label: 'Matin', hour: 8 },
  { id: 'afternoon', label: 'Fin d’après-midi', hour: 16.5 },
  { id: 'dusk', label: 'Crépuscule', hour: 19.5 },
];

export const LOOKDEV_LIMITS: CameraLimits = {
  minDistance: 8,
  maxDistance: 180,
  minPitchDeg: 12,
  maxPitchDeg: 68,
  bounds: { minX: 0, minZ: 0, maxX: 128, maxZ: 128 },
};
