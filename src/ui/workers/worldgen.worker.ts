/**
 * Battle map generation off the main thread (brief §7: load < 10 s, the UI stays alive).
 * The core is pure TypeScript: the layout is plain data (typed arrays included) and crosses
 * the worker boundary by structured clone.
 */
import { generateBattleMap, type BattleMapParams } from '../../core/worldgen/battle.ts';
import type { WorldLayout } from '../../core/worldgen/types.ts';

export interface WorldgenRequest {
  readonly seed: string;
  readonly castleIndex: BattleMapParams['castleIndex'];
}

export type WorldgenResponse = { readonly ok: true; readonly layout: WorldLayout; readonly ms: number } | { readonly ok: false; readonly error: string };

// The app tsconfig types `self` as a Window; this file runs in a dedicated worker.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorldgenRequest>) => void) | null;
  postMessage(message: WorldgenResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  try {
    const start = performance.now();
    const { layout } = generateBattleMap({ seed: event.data.seed, castleIndex: event.data.castleIndex });
    const ms = performance.now() - start;
    scope.postMessage({ ok: true, layout, ms }, [layout.terrain.heights.buffer, layout.terrain.layers.buffer]);
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
