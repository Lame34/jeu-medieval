/**
 * Battle maps generated off the main thread (worldgen.worker.ts), the last one kept: the council
 * of war draws the scouts' plan from the map the battle is then fought on, which then loads without
 * generating it again.
 */
import type { CastleIndex } from '../../core/campaign/types.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';
import type { WorldgenRequest, WorldgenResponse } from '../workers/worldgen.worker.ts';

export interface GeneratedLayout {
  readonly layout: WorldLayout;
  /** Generation time (ms), the same when the map is taken again from the cache. */
  readonly ms: number;
}

let last: { key: string; promise: Promise<GeneratedLayout> } | null = null;

const keyOf = (seed: string, castleIndex: CastleIndex) => `${castleIndex}:${seed}`;

/** The map of `seed`, generated in a worker (or the one generated last, if it is the same). */
export function requestBattleMap(seed: string, castleIndex: CastleIndex): Promise<GeneratedLayout> {
  const key = keyOf(seed, castleIndex);
  if (last?.key === key) return last.promise;
  const promise = new Promise<GeneratedLayout>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/worldgen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorldgenResponse>) => {
      const data = event.data;
      worker.terminate();
      if (data.ok) resolve({ layout: data.layout, ms: data.ms });
      else reject(new Error(data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    const request: WorldgenRequest = { seed, castleIndex };
    worker.postMessage(request);
  });
  last = { key, promise };
  // A failed generation is not kept: the next request tries again.
  promise.catch(() => {
    if (last?.promise === promise) last = null;
  });
  return promise;
}
