/** `window.__perf` as seen from Playwright tests (see src/render/debug/PerfProbe.tsx). */
interface TestPerfApi {
  readonly gpu: string;
  readonly webgl2: boolean;
  ready: boolean;
  renderer(): { calls: number; triangles: number; geometries: number; textures: number; programs: number; renderScale?: number };
  /** Bench/capture hooks installed by the current screen (e.g. BattleScreen: setView, viewCount, viewIds). */
  control: Record<string, (...args: never[]) => unknown>;
}

interface Window {
  __perf?: TestPerfApi;
}

/**
 * `window.__battle` as seen from Playwright tests (installed under `?e2e`; see the
 * `BattleTestHook` interface in src/render/battle/BattleDirector.tsx). Declared independently
 * here, like `TestPerfApi` above, so tests/e2e never has to import src (which is outside
 * tsconfig.tests.json's `include`) just for a type.
 */
interface TestVec2 {
  readonly x: number;
  readonly z: number;
}

type TestFaction = 'attacker' | 'defender';

interface TestUnitState {
  readonly id: string;
  readonly typeKey: string;
  readonly faction: TestFaction;
  readonly position: TestVec2;
  readonly facing: TestVec2;
  readonly hp: number;
  readonly ap: number;
  readonly actions: number;
  readonly overwatch: TestVec2 | null;
  readonly morale: number;
  readonly alive: boolean;
}

interface TestBattleState {
  readonly turn: number;
  readonly activeFaction: TestFaction;
  readonly status: 'ongoing' | 'attackerWon' | 'defenderWon';
  readonly units: readonly TestUnitState[];
}

/** Plain JSON, mirroring `Command` (src/core/commands/types.ts): safe to `JSON.stringify` across
 * a `page.evaluate` boundary and to replay unchanged on a fresh page (ADR: a battle replays from
 * `seed + scenario + Command[]`). */
type TestCommand =
  | { readonly type: 'move'; readonly unitId: string; readonly to: TestVec2 }
  | { readonly type: 'attack'; readonly unitId: string; readonly targetId: string }
  | { readonly type: 'overwatch'; readonly unitId: string; readonly direction: TestVec2 }
  | { readonly type: 'endTurn' };

interface TestBattleApi {
  state(): TestBattleState;
  issue(command: TestCommand): unknown;
  /** The AI plays the active side's whole turn (normally triggered automatically; exposed for
   * tests that want to drive it directly). */
  aiTurn(): void;
  /** Animations, the event queue or the AI turn in progress: no orders accepted while true. */
  busy(): boolean;
  /** Screen position (CSS px) of a unit's body, or null when it has no renderer handle yet. */
  unitScreen(id: string): { x: number; y: number } | null;
  /** Screen position (CSS px) of a ground point. */
  groundScreen(x: number, z: number): { x: number; y: number };
}

interface Window {
  __battle?: TestBattleApi;
}
