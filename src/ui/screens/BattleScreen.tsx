import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { structureDef } from '../../core/battle/structures.ts';
import type { UnitMarker, WorldLayout } from '../../core/worldgen/types.ts';
import type { CastleHandle, CastleSiegeState } from '../../render/castle/Castle.tsx';
import { Fire, type FireHandle } from '../../render/vfx/Fire.tsx';
import { Rain } from '../../render/vfx/Rain.tsx';
import { MiniMap } from '../battle/MiniMap.tsx';
import { CameraButtons } from '../battle/CameraButtons.tsx';
import { actionsFor } from '../battle/actions.ts';
import { triggerAction } from '../battle/intent.ts';
import { Torches } from '../../render/vfx/Torches.tsx';
import { BattleSoundscape } from '../../render/battle/BattleSoundscape.tsx';
import { hourOf, isSeenBy, WEATHERS, type BattleConditions, type Weather } from '../../core/battle/conditions.ts';
import { useSceneConditions } from '../../state/scene-conditions.ts';
import type { BattleState } from '../../core/battle/types.ts';
import { Projectiles, type ProjectileHandle } from '../../render/vfx/Projectiles.tsx';
import { TerrainLayer } from '../../core/rules/types.ts';
import { BattleDirector } from '../../render/battle/BattleDirector.tsx';
import { BattleOverlays } from '../../render/battle/BattleOverlays.tsx';
import { battleLimits, battleViews, introView, openingView } from '../../render/battle/views.ts';
import { TacticalCamera, type CameraHandle, type CameraIntro, type CameraView } from '../../render/camera/TacticalCamera.tsx';
import { isBenchMode } from '../../render/debug/PerfProbe.tsx';
import { GameCanvas } from '../../render/GameCanvas.tsx';
import { WorldScene } from '../../render/WorldScene.tsx';
import type { UnitHandle } from '../../render/units/Units.tsx';
import { useBattleUi } from '../../state/battle-ui.ts';
import { useSceneStatus } from '../../state/scene-status.ts';
import { useSettings } from '../../state/settings.ts';
import { BattleHud } from '../battle/BattleHud.tsx';
import { BattleSession, PLAYER_FACTION, type BattleShape } from '../battle/session.ts';
import { requestEndTurn, unitsStillActing } from '../battle/end-turn.ts';
import { navigate, ROUTES } from '../router.ts';
import { bannersOf, woundedHeroes } from '../../core/campaign/scenario.ts';
import { CAMPAIGN } from '../../data/index.ts';
import { useCampaign } from '../../state/campaign.ts';
import { requestBattleMap } from '../campaign/battle-map.ts';
import { battleKey, battleQuery, battleSetupFrom, battleTitle, shapeOf, type BattleSetup } from '../campaign/battle-setup.ts';
import { hashBattleState } from '../../core/battle/replay.ts';
import type { BattleSave } from '../../core/save/battle-save.ts';
import { clearBattleSave, loadBattleSave, savedAtLabel, storeBattleSave } from '../../state/battle-save.ts';
import { briefingFor, endFor } from '../campaign/battle-story.tsx';
import { Tutorial } from '../tutorial/Tutorial.tsx';
import { LoadingScreen } from './LoadingScreen.tsx';
import { E2E } from '../test-flags.ts';
import './screens.css';

const OPENING_VIEW = 1;

/** Fixed weather and hour for captures and tests (?weather=rain&hour=21); drawn from the seed otherwise. */
function conditionsParams(): Partial<BattleConditions> {
  const query = new URLSearchParams(window.location.search);
  const weather = query.get('weather');
  const hour = query.get('hour');
  return {
    ...((WEATHERS as readonly string[]).includes(weather ?? '') ? { weather: weather as Weather } : {}),
    ...(hour !== null && Number.isFinite(Number(hour)) ? { startHour: Number(hour) } : {}),
  };
}

/** Tests (?e2e&turns=N): the garrison holds only N rounds, so a test reaches the battle's end quickly. */
function testTurnLimit(): number | null {
  const query = new URLSearchParams(window.location.search);
  const n = Number(query.get('turns'));
  return E2E && Number.isInteger(n) && n > 0 ? n : null;
}

/** The battle's shape, with a test's deadline last (it wins over the castle's). */
function battleShape(setup: BattleSetup, resting: readonly string[]): BattleShape | undefined {
  const shape = shapeOf(setup.mode, resting, setup.rank);
  const turns = testTurnLimit();
  if (turns === null) return shape;
  return { effects: [...(shape?.effects ?? []), { turnLimit: turns }], ...(shape?.absentHeroes ? { absentHeroes: shape.absentHeroes } : {}) };
}

/**
 * The establishing shot (the castle, then the army) opens a battle, except in test runs (?e2e,
 * ?fast), with instant animations or for a player who asked the system for less motion.
 */
function wantsIntro(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (E2E || params.has('fast')) return false;
  if (useSettings.getState().animation === 'instant') return false;
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Driven test runs and benches (?e2e, ?bench) neither save their battle nor take one up. */
function isTestRun(): boolean {
  return E2E || isBenchMode();
}

/** A step of the camera's buttons: a sixteenth of a turn, and the zoom of a wheel notch and a half. */
const CAMERA_BUTTON_TURNS = 1 / 16;
const CAMERA_BUTTON_ZOOM = 1.2;

/** Take up the saved battle (`resume`), start afresh, or ask first. */
type ResumeChoice = 'ask' | 'resume' | 'fresh';

/** The question when this battle was left unfinished: take it up, or start it again. */
function ResumeDialog({ save, onChoose }: { readonly save: BattleSave; readonly onChoose: (choice: 'resume' | 'fresh') => void }) {
  return (
    <div className="resume-screen">
      <section className="resume-dialog parchment-sheet" role="dialog" aria-modal="true" aria-labelledby="resume-title">
        <h2 id="resume-title">Une bataille était en cours</h2>
        <p>
          {save.title} : vous l’aviez laissée au <strong>tour {save.turn}</strong>, {savedAtLabel(save.savedAt)}.
        </p>
        <div className="resume-dialog__actions">
          <button type="button" data-primary onClick={() => onChoose('resume')}>
            Reprendre la bataille
          </button>
          <button
            type="button"
            onClick={() => {
              clearBattleSave();
              onChoose('fresh');
            }}
          >
            Recommencer depuis le début
          </button>
        </div>
      </section>
    </div>
  );
}

/** ?nosound: no soundscape (benches comparing with and without audio). */
const NO_SOUND = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('nosound');

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

/** Generates the 500 m battle map in a worker (the page stays responsive) — or takes the one the council drew its plan from — then shows it. */
function useBattleMap(setup: BattleSetup): { layout: WorldLayout | null; error: string | null } {
  const [state, setState] = useState<{ layout: WorldLayout | null; error: string | null }>({ layout: null, error: null });
  useEffect(() => {
    let live = true;
    requestBattleMap(setup.seed, setup.castleIndex).then(
      (g) => {
        if (!live) return;
        // Read by the bench and capture scripts (load-time budget, brief §7).
        document.body.dataset['worldgenMs'] = g.ms.toFixed(0);
        document.body.dataset['layoutAtMs'] = performance.now().toFixed(0);
        setState({ layout: g.layout, error: null });
      },
      (e: unknown) => live && setState({ layout: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [setup]);
  return state;
}

export default function BattleScreen() {
  // The battle the URL asks for (tutorial, campaign castle, skirmish), and the heroes resting.
  const setup = useMemo(() => battleSetupFrom(window.location.search), []);
  // A battle left unfinished is taken up: at once from the menus (?resume), after a question here.
  const testRun = isTestRun();
  const [saved] = useState(() => {
    const save = testRun ? null : loadBattleSave();
    return save && save.key === battleKey(setup) ? save : null;
  });
  const [choice, setChoice] = useState<ResumeChoice>(() => (!saved ? 'fresh' : new URLSearchParams(window.location.search).has('resume') ? 'resume' : 'ask'));
  const resuming = choice === 'resume' && saved !== null;
  // The heroes resting when the battle began (the saved ones when it is taken up).
  const resting = useMemo(() => (resuming ? saved.absentHeroes : setup.mode.kind === 'campaign' ? useCampaign.getState().resting : []), [setup, resuming, saved]);
  const { layout, error } = useBattleMap(setup);
  const views = useMemo(() => (layout ? battleViews(layout) : []), [layout]);
  const camera = useRef<CameraHandle | null>(null);
  const setHour = useSettings((s) => s.setHour);
  const bench = isBenchMode();
  // The battle itself (not in bench mode: measurements keep the map's fixed markers), unless
  // the bench asks for a live one (?bench&live: units, torches, weather, sound; no input).
  const live = !bench || new URLSearchParams(window.location.search).has('live');
  const started = useMemo(() => {
    if (!layout || !live || choice === 'ask') return null;
    const fresh = () => new BattleSession(layout, setup.seed, conditionsParams(), battleShape(setup, setup.mode.kind === 'campaign' ? useCampaign.getState().resting : []));
    if (!resuming) return { session: fresh(), lost: false };
    const session = new BattleSession(layout, setup.seed, conditionsParams(), battleShape(setup, resting));
    if (session.restore(saved)) return { session, lost: false };
    // Saved by another version of the game: it starts again, and the save is set aside.
    clearBattleSave();
    return { session: fresh(), lost: true };
  }, [layout, live, setup, resting, choice, resuming, saved]);
  const session = started?.session ?? null;
  const units = useMemo(() => (session ? markersOf(session) : undefined), [session]);
  const siege = useMemo(() => (session ? siegeOf(session) : undefined), [session]);
  const [handles, setHandles] = useState<ReadonlyMap<string, UnitHandle> | null>(null);
  const [castle, setCastle] = useState<CastleHandle | null>(null);
  const [fire, setFire] = useState<FireHandle | null>(null);
  // The garrison's AI plans in a worker of its own.
  useEffect(() => {
    if (!session || !layout) return undefined;
    const worker = new Worker(new URL('../workers/ai.worker.ts', import.meta.url), { type: 'module' });
    session.attachAi(worker, layout);
    return () => worker.terminate();
  }, [session, layout]);
  // The battle's wind (smoke drift, painted sway) shows from the start, before any fire.
  useEffect(() => {
    if (fire && session) fire.syncFrom(session.state);
  }, [fire, session]);
  const heightAt = useCallback((x: number, z: number) => session?.standHeight(x, z) ?? 0, [session]);
  const [projectiles, setProjectiles] = useState<ProjectileHandle | null>(null);
  const waterAt = useCallback(
    (x: number, z: number) => {
      const t = layout?.terrain;
      if (!t || x < 0 || z < 0 || x >= t.width || z >= t.depth) return false;
      const layer = t.layers[Math.floor(z) * t.width + Math.floor(x)];
      return layer === TerrainLayer.Moat || layer === TerrainLayer.River;
    },
    [layout],
  );
  const sceneReady = useSceneStatus((s) => s.ready);
  useEffect(() => () => useBattleUi.getState().reset(), []);

  // After every order, the battle is saved; once it is over, the save goes.
  useEffect(() => {
    if (!session || testRun) return undefined;
    const key = battleKey(setup);
    const url = `${ROUTES.battle}?${new URLSearchParams(battleQuery(setup)).toString()}`;
    const title = battleTitle(setup);
    return session.subscribe((_, state) => {
      if (state.status !== 'ongoing') {
        clearBattleSave();
        return;
      }
      storeBattleSave({ key, url, title, turn: state.turn, savedAt: Date.now(), absentHeroes: [...resting], commands: session.commands, hash: hashBattleState(state) });
    });
  }, [session, setup, testRun, resting]);

  // A battle taken up skips its opening briefing; left during the garrison's turn, the garrison plays on.
  useEffect(() => {
    if (!session || session.commands.length === 0) return;
    const ui = useBattleUi.getState();
    ui.setBriefed();
    if (session.state.status === 'ongoing' && session.state.activeFaction !== PLAYER_FACTION) ui.setBusy(true);
  }, [session]);

  // The campaign keeps the outcome: the castle taken and its banners, the heroes wounded (they rest
  // through the next battle); the tutorial won is done.
  useEffect(() => {
    if (!session || setup.mode.kind === 'skirmish') return undefined;
    const mode = setup.mode;
    return session.subscribe((events, state) => {
      if (!events.some((e) => e.type === 'battleEnded')) return;
      if (mode.kind === 'tutorial') {
        if (state.status === 'attackerWon') useCampaign.getState().finishTutorial();
        return;
      }
      useCampaign.getState().recordBattle(mode.level.id, mode.stratagem?.id ?? null, bannersOf(CAMPAIGN, state), state.turn, woundedHeroes(session.ctx, state));
    });
  }, [session, setup]);
  const toMap = useCallback(() => navigate(ROUTES.campaign), []);
  const finishTutorial = useCallback(() => useCampaign.getState().finishTutorial(), []);

  // The scene is lit for the battle's hour and weather, round after round; under fog the
  // enemies none of the player's men can see are hidden (fog of war).
  useEffect(() => {
    if (!session) return undefined;
    const apply = (state: BattleState) => {
      useSceneConditions.getState().set(hourOf(session.ctx.rules, state), state.weather);
      if (handles) {
        for (const u of state.units) {
          if (u.faction === PLAYER_FACTION) continue;
          handles.get(u.id)?.setHidden(!isSeenBy(session.ctx, state, PLAYER_FACTION, u.position));
        }
      }
    };
    apply(session.state);
    const off = session.subscribe((_, state) => apply(state));
    return () => {
      off();
      useSceneConditions.getState().set(null, 'clear');
    };
  }, [session, handles]);

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
    if (!E2E || views.length === 0) return undefined;
    window.__battleCamera = {
      viewIds: () => views.map((v) => v.id),
      setView: (id) => {
        const v = views.find((x) => x.id === id);
        if (v) camera.current?.setView(v, true);
      },
      look: (view) => camera.current?.setView(view, true),
      view: () => camera.current?.getView() ?? null,
    };
    return () => {
      delete window.__battleCamera;
    };
  }, [views]);

  const playerUnits = session ? session.state.units.filter((u) => u.faction === PLAYER_FACTION).map((u) => u.position) : [];
  const initial = session && layout ? openingView(layout, playerUnits) : (views[OPENING_VIEW] ?? views[0]);
  // Chosen once per battle: the shot plays when the scene shows, and the briefing waits for it.
  const [withIntro] = useState(() => !bench && !resuming && wantsIntro());
  const intro: CameraIntro | undefined = useMemo(
    () => (session && layout && withIntro ? { from: introView(layout, session.state.units.filter((u) => u.faction === PLAYER_FACTION).map((u) => u.position)), play: false, onDone: () => useBattleUi.getState().setIntroDone() } : undefined),
    [session, layout, withIntro],
  );
  useEffect(() => {
    if (session && !intro) useBattleUi.getState().setIntroDone();
  }, [session, intro]);
  const getView = useCallback(() => camera.current?.getView() ?? null, []);
  const focusOn = (p: { x: number; z: number }) => {
    const view = camera.current?.getView();
    if (view) camera.current?.setView({ ...view, focus: { x: p.x, z: p.z } });
  };
  /** The camera's button: back on the chosen man, or on the middle of our army. */
  const focusHome = () => {
    if (!session) return;
    const ui = useBattleUi.getState();
    const chosen = session.state.units.find((u) => u.id === ui.selectedId && u.alive);
    const ours = session.state.units.filter((u) => u.alive && u.faction === PLAYER_FACTION);
    if (chosen) focusOn(chosen.position);
    else if (ours.length > 0) focusOn({ x: ours.reduce((s, u) => s + u.position.x, 0) / ours.length, z: ours.reduce((s, u) => s + u.position.z, 0) / ours.length });
  };
  if (choice === 'ask' && saved) return <ResumeDialog save={saved} onChoose={setChoice} />;
  if (error) return <LoadingScreen label={`Le champ de bataille n’a pas pu être tracé : ${error}`} />;
  if (!layout || !initial) return <LoadingScreen label="Le cartographe trace le champ de bataille" tips />;
  return (
    <main className="scene-screen">
      <GameCanvas>
        <WorldScene layout={layout} units={units} onUnitHandles={setHandles} {...(siege ? { siege } : {})} onCastleHandle={setCastle} />
        {session && <Fire width={layout.terrain.width} heightAt={heightAt} onHandle={setFire} />}
        {session && <Torches layout={layout} />}
        {session && sceneReady && !NO_SOUND && <BattleSoundscape session={session} terrain={layout.terrain} />}
        {session?.state.weather === 'rain' && <Rain windX={session.state.wind.x} windZ={session.state.wind.z} windStrength={session.state.wind.strength} />}
        {session && <Projectiles waterAt={waterAt} groundAt={heightAt} onHandle={setProjectiles} />}
        {session && <BattleDirector session={session} handles={handles} castle={castle} fire={fire} projectiles={projectiles} terrain={layout.terrain} focusOn={focusOn} />}
        {session && <BattleOverlays session={session} handles={handles} terrain={layout.terrain} />}
        <TacticalCamera terrain={layout.terrain} initial={initial} limits={battleLimits(layout)} handleRef={camera} inputEnabled={!bench} {...(intro ? { intro: { ...intro, play: sceneReady } } : {})} />
      </GameCanvas>
      {!sceneReady && <LoadingScreen label="Le peintre prépare ses couleurs" tips />}
      {session && sceneReady && (
        <div className="hud-map-dock">
          <MiniMap layout={layout} session={session} getView={getView} onFocus={focusOn} />
          <CameraButtons onTurn={(d) => camera.current?.nudge({ turns: d * CAMERA_BUTTON_TURNS })} onZoom={(d) => camera.current?.nudge({ zoom: d > 0 ? 1 / CAMERA_BUTTON_ZOOM : CAMERA_BUTTON_ZOOM })} onHome={focusHome} />
        </div>
      )}
      {session && (
        <BattleHud
          onEndTurn={() => requestEndTurn(session)}
          stillActing={() => unitsStillActing(session)}
          briefing={briefingFor(setup.mode, resting, setup.rank)}
          end={(battle) => endFor(setup.mode, battle, { replay: () => window.location.reload(), toMap, toTitle: () => navigate(ROUTES.title) })}
          actionsFor={(u) => actionsFor(session, u)}
          onAction={(id) => triggerAction(session, id)}
        />
      )}
      {started?.lost && sceneReady && <p className="hud-card hud-notice">La bataille sauvegardée vient d’une autre version du jeu : elle reprend depuis le début.</p>}
      {session && sceneReady && setup.mode.kind === 'tutorial' && <Tutorial session={session} layout={layout} getView={getView} focusOn={focusOn} onDone={finishTutorial} />}
      {!bench && (
        <button type="button" className="scene-back" onClick={setup.mode.kind === 'skirmish' ? () => navigate(ROUTES.title) : toMap}>
          {setup.mode.kind === 'skirmish' ? '← Retour' : '← Carte'}
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
  /** Where the camera is now (eased towards its target). */
  view(): CameraView | null;
}

declare global {
  interface Window {
    __battleCamera?: BattleCameraHook;
  }
}
