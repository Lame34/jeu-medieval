import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { structureDef } from '../../core/battle/structures.ts';
import type { UnitMarker, WorldLayout } from '../../core/worldgen/types.ts';
import type { CastleHandle, CastleSiegeState } from '../../render/castle/Castle.tsx';
import { Fire, type FireHandle } from '../../render/vfx/Fire.tsx';
import { BattleDirector } from '../../render/battle/BattleDirector.tsx';
import { BattleOverlays } from '../../render/battle/BattleOverlays.tsx';
import { battleLimits, battleViews, openingView } from '../../render/battle/views.ts';
import { TacticalCamera, type CameraHandle, type CameraView } from '../../render/camera/TacticalCamera.tsx';
import { isBenchMode } from '../../render/debug/PerfProbe.tsx';
import { GameCanvas } from '../../render/GameCanvas.tsx';
import { WorldScene } from '../../render/WorldScene.tsx';
import type { UnitHandle } from '../../render/units/Units.tsx';
import { useBattleUi } from '../../state/battle-ui.ts';
import { useSceneStatus } from '../../state/scene-status.ts';
import { useSettings } from '../../state/settings.ts';
import { BattleHud } from '../battle/BattleHud.tsx';
import { BattleSession, PLAYER_FACTION } from '../battle/session.ts';
import { navigate, ROUTES } from '../router.ts';
import type { WorldgenRequest, WorldgenResponse } from '../workers/worldgen.worker.ts';
import { LoadingScreen } from './LoadingScreen.tsx';
import './screens.css';

const DEFAULT_SEED = 'siege-1';
const OPENING_VIEW = 1;

/** Seed and castle from the URL (`/battle?seed=…&castle=1..4`), for benches and replays. */
function mapParams(): WorldgenRequest {
  const query = new URLSearchParams(window.location.search);
  const castle = Number(query.get('castle') ?? '1');
  return { seed: query.get('seed') ?? DEFAULT_SEED, castleIndex: castle === 2 || castle === 3 || castle === 4 ? castle : 1 };
}

/** Markers of a battle's units, for the unit renderer (standing on decks where there are). */
function markersOf(session: BattleSession): UnitMarker[] {
  return session.state.units.map((u) => ({
    id: u.id,
    faction: u.faction,
    typeKey: u.typeKey,
    position: u.position,
    facingTurns: Math.atan2(u.facing.x, u.facing.z) / (2 * Math.PI),
    elevationM: session.standHeight(u.position.x, u.position.z),
  }));
}

/** The castle structures' condition, for the castle renderer (raised drawbridges, breaches, cracks). */
function siegeOf(session: BattleSession): CastleSiegeState[] {
  return session.state.structures.map((s) => {
    const def = structureDef(session.ctx, s.id);
    return { id: s.id, hpFraction: def && def.maxHp > 0 ? s.hp / def.maxHp : 1, broken: s.broken };
  });
}

/** Generates the 500 m battle map in a worker (the page stays responsive), then shows it. */
function useBattleMap(): { layout: WorldLayout | null; error: string | null } {
  const [state, setState] = useState<{ layout: WorldLayout | null; error: string | null }>({ layout: null, error: null });
  useEffect(() => {
    const worker = new Worker(new URL('../workers/worldgen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorldgenResponse>) => {
      const data = event.data;
      if (data.ok) {
        // Read by the bench and capture scripts (load-time budget, brief §7).
        document.body.dataset['worldgenMs'] = data.ms.toFixed(0);
        document.body.dataset['layoutAtMs'] = performance.now().toFixed(0);
        setState({ layout: data.layout, error: null });
      } else setState({ layout: null, error: data.error });
      worker.terminate();
    };
    worker.onerror = (event) => setState({ layout: null, error: event.message });
    worker.postMessage(mapParams());
    return () => worker.terminate();
  }, []);
  return state;
}

export default function BattleScreen() {
  const { layout, error } = useBattleMap();
  const views = useMemo(() => (layout ? battleViews(layout) : []), [layout]);
  const camera = useRef<CameraHandle | null>(null);
  const setHour = useSettings((s) => s.setHour);
  const bench = isBenchMode();
  // The battle itself (not in bench mode: measurements keep the map's fixed markers).
  const session = useMemo(() => (layout && !bench ? new BattleSession(layout, mapParams().seed) : null), [layout, bench]);
  const units = useMemo(() => (session ? markersOf(session) : undefined), [session]);
  const siege = useMemo(() => (session ? siegeOf(session) : undefined), [session]);
  const [handles, setHandles] = useState<ReadonlyMap<string, UnitHandle> | null>(null);
  const [castle, setCastle] = useState<CastleHandle | null>(null);
  const [fire, setFire] = useState<FireHandle | null>(null);
  const heightAt = useCallback((x: number, z: number) => session?.standHeight(x, z) ?? 0, [session]);
  const sceneReady = useSceneStatus((s) => s.ready);
  useEffect(() => () => useBattleUi.getState().reset(), []);

  // Hooks for capture/bench scripts: window.__perf.control.setView(i) / setHour(h).
  useEffect(() => {
    if (views.length === 0) return undefined;
    const install = () => {
      const perf = window.__perf;
      if (!perf) return false;
      perf.control['setView'] = ((i: number) => {
        const v = views[i];
        if (v) camera.current?.setView(v, true);
      }) as (...args: never[]) => unknown;
      perf.control['setHour'] = ((h: number) => setHour(h)) as (...args: never[]) => unknown;
      perf.control['viewCount'] = () => views.length;
      perf.control['viewIds'] = () => views.map((v) => v.id);
      return true;
    };
    if (install()) return undefined;
    const timer = window.setInterval(() => {
      if (install()) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [views, setHour]);

  // Test hook (?e2e): frame the camera from Playwright (captures of the siege, J4).
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('e2e') || views.length === 0) return undefined;
    window.__battleCamera = {
      viewIds: () => views.map((v) => v.id),
      setView: (id) => {
        const v = views.find((x) => x.id === id);
        if (v) camera.current?.setView(v, true);
      },
      look: (view) => camera.current?.setView(view, true),
    };
    return () => {
      delete window.__battleCamera;
    };
  }, [views]);

  const playerUnits = session ? session.state.units.filter((u) => u.faction === PLAYER_FACTION).map((u) => u.position) : [];
  const initial = session && layout ? openingView(layout, playerUnits) : (views[OPENING_VIEW] ?? views[0]);
  const focusOn = (p: { x: number; z: number }) => {
    const view = camera.current?.getView();
    if (view) camera.current?.setView({ ...view, focus: { x: p.x, z: p.z } });
  };
  if (error) return <LoadingScreen label={`Échec de la génération : ${error}`} />;
  if (!layout || !initial) return <LoadingScreen label="Le cartographe trace le champ de bataille" />;
  return (
    <main className="scene-screen">
      <GameCanvas>
        <WorldScene layout={layout} units={units} onUnitHandles={setHandles} {...(siege ? { siege } : {})} onCastleHandle={setCastle} />
        {session && <Fire width={layout.terrain.width} heightAt={heightAt} onHandle={setFire} />}
        {session && <BattleDirector session={session} handles={handles} castle={castle} fire={fire} terrain={layout.terrain} focusOn={focusOn} />}
        {session && <BattleOverlays session={session} handles={handles} terrain={layout.terrain} />}
        <TacticalCamera terrain={layout.terrain} initial={initial} limits={battleLimits(layout)} handleRef={camera} inputEnabled={!bench} />
      </GameCanvas>
      {!sceneReady && <LoadingScreen label="Le peintre prépare ses couleurs" />}
      {session && (
        <BattleHud
          onEndTurn={() => {
            useBattleUi.getState().select(null);
            session.issue({ type: 'endTurn' });
          }}
        />
      )}
      {!bench && (
        <button type="button" className="scene-back" onClick={() => navigate(ROUTES.title)}>
          ← Retour
        </button>
      )}
    </main>
  );
}

/** Camera hook installed with `?e2e`. */
export interface BattleCameraHook {
  viewIds(): string[];
  setView(id: string): void;
  look(view: CameraView): void;
}

declare global {
  interface Window {
    __battleCamera?: BattleCameraHook;
  }
}
