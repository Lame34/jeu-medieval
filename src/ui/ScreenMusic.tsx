/**
 * The game's sound outside the battle field (ADR-051): the sounds load at the player's first input
 * (browsers play nothing before one, and decoding them as a screen first shows stole frames); the
 * player's volumes and silence apply everywhere; each screen has its air — « Kalenda maya » over
 * the menus and the map of the Val, « Reis glorios » on the harp over the chronicle. In a battle,
 * its own soundscape takes over (render/battle/BattleSoundscape.tsx).
 */
import { useEffect } from 'react';
import { audio, type SoundId } from '../audio/engine.ts';
import { useSettings } from '../state/settings.ts';
import { ROUTES, useRoute } from './router.ts';

/** Each screen's music (none: the battle plays its own, the painter's workshop is silent). */
const SCREEN_MUSIC: Readonly<Record<string, SoundId | null>> = {
  [ROUTES.battle]: null,
  [ROUTES.lookdev]: null,
  [ROUTES.chronicle]: 'music_chronicle',
};
const DEFAULT_MUSIC: SoundId = 'music_map';
const SCREEN_MUSICS: readonly SoundId[] = ['music_map', 'music_chronicle'];
/** A screen's air fades in and out this fast (ms). */
const SCREEN_FADE_MS = 1800;

export function ScreenMusic() {
  const path = useRoute();
  const muted = useSettings((s) => s.muted);
  const volumes = useSettings((s) => s.volumes);
  const silent = new URLSearchParams(window.location.search).has('nosound');

  useEffect(() => {
    if (silent) return undefined;
    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      audio.load();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    return () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
  }, [silent]);
  useEffect(() => audio.setMuted(muted), [muted]);
  useEffect(() => {
    audio.setMasterVolume(volumes.master);
    audio.setBusVolumes(volumes);
  }, [volumes]);

  useEffect(() => {
    if (silent) return;
    const music = path in SCREEN_MUSIC ? SCREEN_MUSIC[path] : DEFAULT_MUSIC;
    for (const id of SCREEN_MUSICS) audio.loop(id, id === music ? 1 : 0, SCREEN_FADE_MS);
  }, [path, silent]);
  return null;
}
