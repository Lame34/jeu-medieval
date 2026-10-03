/**
 * The hour and weather the scene is lit for (UI state, never the simulation's truth): a battle
 * sets them from its state at each round; elsewhere (look-dev, title) the settings' hour rules,
 * under a clear sky.
 */
import { create } from 'zustand';
import type { Weather } from '../core/battle/conditions.ts';
import { useSettings } from './settings.ts';

export interface SceneConditionsState {
  /** The battle's hour, or null to follow the settings. */
  readonly hour: number | null;
  readonly weather: Weather;
  set(hour: number | null, weather: Weather): void;
}

export const useSceneConditions = create<SceneConditionsState>((set) => ({
  hour: null,
  weather: 'clear',
  set: (hour, weather) => set({ hour, weather }),
}));

/** The hour the scene is lit for. */
export function useSceneHour(): number {
  const battleHour = useSceneConditions((s) => s.hour);
  const settingsHour = useSettings((s) => s.hour);
  return battleHour ?? settingsHour;
}
