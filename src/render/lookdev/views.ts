import type { CameraLimits, CameraView } from '../camera/TacticalCamera.tsx';

/** The four fixed look-dev angles captured at three hours (brief §13). */
export const LOOKDEV_VIEWS: readonly (CameraView & { readonly id: string; readonly label: string })[] = [
  { id: 'overview', label: 'Vue d’ensemble', focus: { x: 72, z: 66 }, distance: 118, yawTurns: 0.11, pitchDeg: 42 },
  { id: 'tactical', label: 'Vue tactique', focus: { x: 74, z: 64 }, distance: 58, yawTurns: 0.05, pitchDeg: 50 },
  // Aimed 2 m past the units: their feet sit in the lower third.
  { id: 'close', label: 'Plan rapproché', focus: { x: 70.3, z: 63.7 }, distance: 9.5, yawTurns: 0.16, pitchDeg: 17 },
  // Seen from the meadow (the camera stays inside the map): wall-walk and guard in view.
  { id: 'castle', label: 'Mur et tour', focus: { x: 96, z: 31 }, distance: 75, yawTurns: 0.9, pitchDeg: 14 },
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
