import { create } from 'zustand';
import type { QualityPresetId } from '../render/quality/presets.ts';

export interface SettingsState {
  readonly quality: QualityPresetId;
  /** Local hour of the day for look-dev / battle start (decimal hours). */
  readonly hour: number;
  setQuality(quality: QualityPresetId): void;
  setHour(hour: number): void;
}

export const DEFAULT_HOUR = 16.5;

export const useSettings = create<SettingsState>((set) => ({
  quality: 'portable',
  hour: DEFAULT_HOUR,
  setQuality: (quality) => set({ quality }),
  setHour: (hour) => set({ hour }),
}));
