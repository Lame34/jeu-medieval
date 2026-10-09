/**
 * Effects with nothing to draw (no fire, no arrow in flight, no torch by day, no guard cone)
 * are hidden so the renderer skips them: an empty object still costs a program switch and its
 * uniform uploads every frame, in the main and the shadow pass. Until the scene's programs are
 * compiled behind the loading screen (SceneReady), they stay visible so that compile() sees
 * them and their first use does not stall.
 */
import type { Object3D } from 'three';

let precompiled = false;
const waiting = new Set<Object3D>();

/** Shows `o` only while it has something to draw (deferred until the programs are compiled). */
export function setDrawable(o: Object3D, drawable: boolean): void {
  o.userData['drawable'] = drawable;
  if (precompiled) o.visible = drawable;
  else waiting.add(o);
}

/** The scene's programs are compiled: hide what has nothing to draw. */
export function markScenePrecompiled(): void {
  precompiled = true;
  for (const o of waiting) o.visible = o.userData['drawable'] !== false;
  waiting.clear();
}

/** A new scene is loading: keep effects visible for its compile. */
export function resetScenePrecompiled(): void {
  precompiled = false;
}
