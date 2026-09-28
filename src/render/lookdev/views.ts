import type { CameraLimits, CameraView } from '../camera/TacticalCamera.tsx';

/** The four fixed look-dev angles captured at three hours (brief §13). */
export const LOOKDEV_VIEWS: readonly (CameraView & { readonly id: string; readonly label: string })[] = [
  { id: 'overview', label: 'Vue d’ensemble', focus: { x: 72, z: 66 }, distance: 140, yawTurns: 0.11, pitchDeg: 26 },
  { id: 'tactical', label: 'Vue tactique', focus: { x: 74, z: 64 }, distance: 58, yawTurns: 0.05, pitchDeg: 50 },
  // Low (12°) and facing the open south so the sky shows; the two units at about 1/3 and 2/3.
  { id: 'close', label: 'Plan rapproché', focus: { x: 72, z: 64.75 }, distance: 10, yawTurns: 0.5, pitchDeg: 12 },
  // Seen from the meadow (the camera stays inside the map): wall-walk and guard in view.
  { id: 'castle', label: 'Mur et tour', focus: { x: 96, z: 31 }, distance: 54, yawTurns: 0.855, pitchDeg: 12 },
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
