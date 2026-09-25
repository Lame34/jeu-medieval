import { useMemo } from 'react';
import { generateLookdev } from '../../core/worldgen/lookdev.ts';
import { TacticalCamera } from '../../render/camera/TacticalCamera.tsx';
import { GameCanvas } from '../../render/GameCanvas.tsx';
import { LOOKDEV_LIMITS, LOOKDEV_VIEWS } from '../../render/lookdev/views.ts';
import { WorldScene } from '../../render/WorldScene.tsx';
import { navigate, ROUTES } from '../router.ts';
import './screens.css';

/** Trial battle screen. Uses the look-dev slice until the 500 m battle generator lands (J2 §12). */
export default function BattleScreen() {
  const layout = useMemo(() => generateLookdev('battle-trial'), []);
  const initial = LOOKDEV_VIEWS[1] ?? LOOKDEV_VIEWS[0];
  if (!initial) return null;
  return (
    <main className="scene-screen">
      <GameCanvas>
        <WorldScene layout={layout} />
        <TacticalCamera terrain={layout.terrain} initial={initial} limits={LOOKDEV_LIMITS} />
      </GameCanvas>
      <button type="button" className="scene-back" onClick={() => navigate(ROUTES.title)}>
        ← Retour
      </button>
    </main>
  );
}
