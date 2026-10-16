/**
 * The battle's soundscape (J5, brief §11): the listener follows the camera; ambiences follow the
 * hour (birds by day, crickets at night), the rain, the wind, the fires and the water near the
 * camera's focus; the music moves between its layers (calm, tension, battle) as the fighting
 * comes closer, with crossfades, and closes the battle with a short piece of victory or defeat
 * (ADR-051). Re-evaluated a few times a second and on battle events, never through React state.
 * The sounds' loading and the player's volumes are the screen's (ui/ScreenMusic.tsx).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { audio } from '../../audio/engine.ts';
import { hourOf } from '../../core/battle/conditions.ts';
import type { BattleState } from '../../core/battle/types.ts';
import { TerrainLayer } from '../../core/rules/types.ts';
import type { TerrainData } from '../../core/terrain-data/terrain-data.ts';
import { PLAYER_FACTION, type BattleSession } from '../../ui/battle/session.ts';
import { nightness } from '../atmosphere/time-of-day.ts';
import { paintedGlobals } from '../materials/painted-globals.ts';

/** How often the ambiences are re-evaluated (s). */
const AMBIENCE_EVERY_S = 0.5;
/** Fires and water are heard within these distances of the focus (m); fires at full past this count. */
const FIRE_HEARD_M = 45;
const FIRES_FULL = 6;
const WATER_HEARD_M = 35;
/** Water cells sampled every this many metres (nearest-water distance). */
const WATER_SAMPLE_M = 3;
/** Music: battle while blows fell this round or the last; tension while an enemy is this close to one of ours (m). */
const BATTLE_ROUNDS = 1;
const TENSION_M = 60;
const MUSIC_FADE_MS = 3500;
/** At the battle's end: the layers fade this fast, then the calm returns this softly after the closing piece. */
const END_FADE_MS = 1200;
const AFTER_END_LEVEL = 0.5;
const MS_PER_S = 1000;

type Layer = 'music_calm' | 'music_tension' | 'music_battle';

function waterCells(terrain: TerrainData): Float32Array {
  const out: number[] = [];
  for (let z = 0; z < terrain.depth; z += WATER_SAMPLE_M) {
    for (let x = 0; x < terrain.width; x += WATER_SAMPLE_M) {
      const l = terrain.layers[z * terrain.width + x];
      if (l === TerrainLayer.River || l === TerrainLayer.Moat || l === TerrainLayer.Ford) out.push(x + 0.5, z + 0.5);
    }
  }
  return new Float32Array(out);
}

export function BattleSoundscape({ session, terrain }: { readonly session: BattleSession; readonly terrain: TerrainData }) {
  const water = useMemo(() => waterCells(terrain), [terrain]);
  const clock = useRef(AMBIENCE_EVERY_S);
  const lastBlowRound = useRef(Number.NEGATIVE_INFINITY);

  // Leaving the battle, its loops fade.
  useEffect(() => () => audio.stopLoops(), []);

  // Music: the layer for the state of the battle.
  useEffect(() => {
    const pick = (state: BattleState): Layer => {
      if (state.status !== 'ongoing') return 'music_calm';
      if (state.turn - lastBlowRound.current <= BATTLE_ROUNDS) return 'music_battle';
      const ours = state.units.filter((u) => u.alive && u.faction === PLAYER_FACTION);
      const near = state.units.some((e) => e.alive && e.faction !== PLAYER_FACTION && ours.some((u) => Math.hypot(u.position.x - e.position.x, u.position.z - e.position.z) <= TENSION_M));
      return near ? 'music_tension' : 'music_calm';
    };
    const apply = (state: BattleState) => {
      const layer = pick(state);
      for (const l of ['music_calm', 'music_tension', 'music_battle'] as const) audio.loop(l, l === layer ? 1 : 0, MUSIC_FADE_MS);
    };
    let after: number | undefined;
    if (session.state.status === 'ongoing') apply(session.state);
    const stop = session.subscribe((events, state) => {
      if (events.some((e) => e.type === 'unitAttacked' || e.type === 'structureDamaged' || e.type === 'structureBroken')) lastBlowRound.current = state.turn;
      if (events.some((e) => e.type === 'battleEnded')) {
        // The battle closes on its own piece; the calm comes back after it, softly.
        for (const l of ['music_calm', 'music_tension', 'music_battle'] as const) audio.loop(l, 0, END_FADE_MS);
        const closing = state.status === 'attackerWon' ? 'music_victory' : 'music_defeat';
        audio.play(closing);
        after = window.setTimeout(() => audio.loop('music_calm', AFTER_END_LEVEL, MUSIC_FADE_MS), audio.durationS(closing) * MS_PER_S);
        return;
      }
      if (state.status === 'ongoing') apply(state);
    });
    return () => {
      stop();
      window.clearTimeout(after);
    };
  }, [session]);

  useFrame(({ camera }, delta) => {
    const focus = paintedGlobals.uFocus.value;
    const dx = camera.position.x - focus.x;
    const dz = camera.position.z - focus.z;
    audio.setListener(focus.x, focus.z, Math.atan2(dx, dz) / (2 * Math.PI), camera.position.distanceTo(focus));
    clock.current += delta;
    if (clock.current < AMBIENCE_EVERY_S) return;
    clock.current = 0;
    const state = session.state;
    const night = nightness(hourOf(session.ctx.rules, state));
    audio.loop('amb_day', 1 - night);
    audio.loop('amb_night', night);
    audio.loop('amb_rain', state.weather === 'rain' ? 1 : 0);
    audio.loop('amb_wind', 0.3 + 0.7 * state.wind.strength);
    let fires = 0;
    for (const f of state.fires) {
      const x = (f.cell % terrain.width) + 0.5;
      const z = Math.floor(f.cell / terrain.width) + 0.5;
      if (Math.hypot(x - focus.x, z - focus.z) <= FIRE_HEARD_M) fires++;
    }
    audio.loop('amb_fire', Math.min(1, fires / FIRES_FULL), 1200);
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < water.length; i += 2) nearest = Math.min(nearest, Math.hypot((water[i] as number) - focus.x, (water[i + 1] as number) - focus.z));
    audio.loop('amb_water', Math.max(0, 1 - nearest / WATER_HEARD_M), 1200);
  });

  return null;
}
