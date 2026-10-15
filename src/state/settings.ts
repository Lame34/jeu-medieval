/**
 * The player's options (Options screen), kept in the browser between sessions. Reading or
 * writing storage can fail (private window, blocked site data): the defaults then hold.
 */
import { create } from 'zustand';
import { POINTER_DEVICES, type PointerDevice } from '../render/camera/wheel-gesture.ts';
import { QUALITY_PRESET_IDS, type QualityPresetId } from '../render/quality/presets.ts';
import { DEFAULT_RANK, RANKS, type Rank } from '../core/campaign/types.ts';
import { readStored, writeStored } from './storage.ts';

/** How fast the battle's animations play: ×1, ×2, or at once (brief §10). */
export const ANIMATION_SPEEDS = { normal: 1, fast: 2, instant: 30 } as const;
export type AnimationSpeed = keyof typeof ANIMATION_SPEEDS;

/** Camera pan and rotation speed factors. */
export const CAMERA_SPEEDS = { slow: 0.6, normal: 1, fast: 1.6 } as const;
export type CameraSpeed = keyof typeof CAMERA_SPEEDS;

/** Size of the battle's interface text. */
export const TEXT_SCALES = { normal: 1, large: 1.15, larger: 1.3 } as const;
export type TextScale = keyof typeof TEXT_SCALES;

export type VolumeBus = 'master' | 'music' | 'sfx' | 'ambience';
export type Volumes = Readonly<Record<VolumeBus, number>>;

/** What is saved (the look-dev hour is not). */
export interface SavedSettings {
  readonly quality: QualityPresetId;
  readonly muted: boolean;
  readonly volumes: Volumes;
  readonly animation: AnimationSpeed;
  /** Ending the turn with units still able to act asks for a confirmation. */
  readonly confirmEndTurn: boolean;
  /** The opening briefing and the battle's hint lines. */
  readonly hints: boolean;
  /** The camera pans when the pointer touches a screen edge. */
  readonly edgeScroll: boolean;
  readonly cameraSpeed: CameraSpeed;
  readonly textScale: TextScale;
  /** Mouse or touchpad: what two fingers sliding on the pad do (pan, not zoom). */
  readonly pointer: PointerDevice;
  /** The rank last chosen, offered again at the council and used for skirmishes (ADR-045). */
  readonly rank: Rank;
}

export interface SettingsState extends SavedSettings {
  /** Local hour of the day for look-dev / battle start (decimal hours). */
  readonly hour: number;
  setQuality(quality: QualityPresetId): void;
  setHour(hour: number): void;
  setMuted(muted: boolean): void;
  setVolume(bus: VolumeBus, value: number): void;
  /** Any saved option. */
  set<K extends keyof SavedSettings>(key: K, value: SavedSettings[K]): void;
  /** Every option back to its default. */
  restoreDefaults(): void;
}

export const DEFAULT_HOUR = 16.5;
const STORAGE_KEY = 'siege.settings.v1';

export const DEFAULT_SETTINGS: SavedSettings = {
  quality: 'portable',
  muted: false,
  volumes: { master: 1, music: 0.8, sfx: 1, ambience: 0.8 },
  animation: 'normal',
  confirmEndTurn: true,
  hints: true,
  edgeScroll: true,
  cameraSpeed: 'normal',
  textScale: 'normal',
  pointer: 'auto',
  rank: DEFAULT_RANK,
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => ((allowed as readonly unknown[]).includes(v) ? (v as T) : fallback);
const unit = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const asRecord = (v: unknown): Readonly<Record<string, unknown>> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Saved options, each checked (an old, damaged or hand-edited save keeps what is valid). */
function load(): SavedSettings {
  const raw = asRecord(readStored(STORAGE_KEY));
  const d = DEFAULT_SETTINGS;
  const v = asRecord(raw['volumes']);
  return {
    quality: oneOf(raw['quality'], QUALITY_PRESET_IDS, d.quality),
    muted: flag(raw['muted'], d.muted),
    volumes: { master: unit(v['master'], d.volumes.master), music: unit(v['music'], d.volumes.music), sfx: unit(v['sfx'], d.volumes.sfx), ambience: unit(v['ambience'], d.volumes.ambience) },
    animation: oneOf(raw['animation'], Object.keys(ANIMATION_SPEEDS) as AnimationSpeed[], d.animation),
    confirmEndTurn: flag(raw['confirmEndTurn'], d.confirmEndTurn),
    hints: flag(raw['hints'], d.hints),
    edgeScroll: flag(raw['edgeScroll'], d.edgeScroll),
    cameraSpeed: oneOf(raw['cameraSpeed'], Object.keys(CAMERA_SPEEDS) as CameraSpeed[], d.cameraSpeed),
    textScale: oneOf(raw['textScale'], Object.keys(TEXT_SCALES) as TextScale[], d.textScale),
    // Added with ADR-042: an older save without it keeps all its other options.
    pointer: oneOf(raw['pointer'], POINTER_DEVICES, d.pointer),
    rank: oneOf(raw['rank'], RANKS, d.rank),
  };
}

const SAVED_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SavedSettings)[];

/** Writes the options (refused by the browser: they hold for this session). */
function save(s: SavedSettings): void {
  writeStored(STORAGE_KEY, JSON.stringify(Object.fromEntries(SAVED_KEYS.map((k) => [k, s[k]]))));
}

export const useSettings = create<SettingsState>((set) => ({
  ...(typeof window !== 'undefined' ? load() : DEFAULT_SETTINGS),
  hour: DEFAULT_HOUR,
  setQuality: (quality) => set({ quality }),
  setHour: (hour) => set({ hour }),
  setMuted: (muted) => set({ muted }),
  setVolume: (bus, value) => set((s) => ({ volumes: { ...s.volumes, [bus]: Math.max(0, Math.min(1, value)) } })),
  set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
  restoreDefaults: () => set({ ...DEFAULT_SETTINGS }),
}));

if (typeof window !== 'undefined') {
  useSettings.subscribe((s, prev) => {
    if (SAVED_KEYS.some((k) => s[k] !== prev[k])) save(s);
  });
}
