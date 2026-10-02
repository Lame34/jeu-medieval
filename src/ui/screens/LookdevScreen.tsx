import { useEffect, useMemo, useRef, useState } from 'react';
import { generateLookdev } from '../../core/worldgen/lookdev.ts';
import { TacticalCamera, type CameraHandle } from '../../render/camera/TacticalCamera.tsx';
import { isBenchMode } from '../../render/debug/PerfProbe.tsx';
import { GameCanvas } from '../../render/GameCanvas.tsx';
import { LOOKDEV_HOURS, LOOKDEV_LIMITS, LOOKDEV_VIEWS } from '../../render/lookdev/views.ts';
import { WorldScene } from '../../render/WorldScene.tsx';
import { useSceneStatus } from '../../state/scene-status.ts';
import { useSettings } from '../../state/settings.ts';
import { navigate, ROUTES } from '../router.ts';
import { LoadingScreen } from './LoadingScreen.tsx';
import './screens.css';
import './lookdev.css';

const DEFAULT_VIEW = 1;

export default function LookdevScreen() {
  const layout = useMemo(() => generateLookdev(), []);
  const camera = useRef<CameraHandle | null>(null);
  const [view, setView] = useState(DEFAULT_VIEW);
  const hour = useSettings((s) => s.hour);
  const setHour = useSettings((s) => s.setHour);
  const bench = isBenchMode();
  const sceneReady = useSceneStatus((s) => s.ready);

  // Hooks for capture/bench scripts: window.__perf.control.setView(i) / setHour(h).
  useEffect(() => {
    const install = () => {
      const perf = window.__perf;
      if (!perf) return false;
      perf.control['setView'] = ((i: number) => {
        const v = LOOKDEV_VIEWS[i];
        if (v) camera.current?.setView(v, true);
        setView(i);
      }) as (...args: never[]) => unknown;
      perf.control['setHour'] = ((h: number) => setHour(h)) as (...args: never[]) => unknown;
      perf.control['viewCount'] = () => LOOKDEV_VIEWS.length;
      perf.control['viewIds'] = () => LOOKDEV_VIEWS.map((v) => v.id);
      return true;
    };
    if (install()) return undefined;
    const timer = window.setInterval(() => {
      if (install()) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [setHour]);

  const initial = LOOKDEV_VIEWS[DEFAULT_VIEW] ?? LOOKDEV_VIEWS[0];
  if (!initial) return null;

  return (
    <main className="scene-screen">
      <GameCanvas>
        <WorldScene layout={layout} />
        <TacticalCamera terrain={layout.terrain} initial={initial} limits={LOOKDEV_LIMITS} handleRef={camera} inputEnabled={!bench} />
      </GameCanvas>
      {!sceneReady && <LoadingScreen label="Le peintre prépare ses couleurs" />}
      {!bench && (
        <>
          <button type="button" className="scene-back" onClick={() => navigate(ROUTES.title)}>
            ← Retour
          </button>
          <aside className="lookdev-panel" aria-label="Réglages du look-dev">
            <h2>Atelier du peintre</h2>
            <p className="lookdev-panel__hint">ZQSD/WASD, molette, A/E ou Q/E</p>
            <div className="lookdev-panel__group" role="group" aria-label="Angle">
              {LOOKDEV_VIEWS.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === i}
                  onClick={() => {
                    camera.current?.setView(v);
                    setView(i);
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="lookdev-panel__group" role="group" aria-label="Heure">
              {LOOKDEV_HOURS.map((h) => (
                <button key={h.id} type="button" aria-pressed={hour === h.hour} onClick={() => setHour(h.hour)}>
                  {h.label}
                </button>
              ))}
            </div>
          </aside>
        </>
      )}
    </main>
  );
}
