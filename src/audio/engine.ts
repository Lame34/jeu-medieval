/**
 * Audio engine (J5, brief §11), on Howler: one-shots with variants, placed in the 2.5D tactical
 * view (louder near the camera's focus, panned left or right of it), and named loops (music
 * layers, ambiences) that fade to a target volume. Sounds come from the pipeline
 * (scripts/blender/process_audio.py → public/assets/audio, audio-manifest.json). Loaded after
 * the scene is ready, never blocking it; browsers unlock audio on the first input.
 */
import { Howl, Howler } from 'howler';
import manifest from './audio-manifest.json' with { type: 'json' };

export type SoundId = keyof typeof manifest.sounds;
type Category = 'sfx' | 'ui' | 'ambience' | 'music';

/** Bus volumes (× each sound's normalised level). */
const BUS: Readonly<Record<Category, number>> = { sfx: 0.9, ui: 0.6, ambience: 0.55, music: 0.45 };
/** A sound at the focus plays at full volume; it fades with distance beyond this (m). */
const NEAR_M = 18;
const FALLOFF = 0.8;
/** Quietest a placed sound gets before it is skipped. */
const AUDIBLE_MIN = 0.04;
/** Panning: full left/right this far across (m), scaled by the camera's distance. */
const PAN_ACROSS_M = 30;
const PAN_MAX = 0.75;
/** Pitch variation of one-shots, ±. */
const PITCH_JITTER = 0.06;

interface Entry {
  readonly category: Category;
  readonly loop: boolean;
  readonly variants: readonly { readonly url: string; readonly durationS: number }[];
}

interface Listener {
  x: number;
  z: number;
  /** Camera's right on the ground. */
  rightX: number;
  rightZ: number;
  /** Camera to focus (m): a far camera hears the field more evenly. */
  distance: number;
}

class AudioEngine {
  private readonly howls = new Map<SoundId, Howl[]>();
  private readonly loops = new Map<SoundId, { howl: Howl; id: number; target: number }>();
  private readonly listener: Listener = { x: 0, z: 0, rightX: 1, rightZ: 0, distance: 40 };
  private loaded = false;
  private master = 1;

  private entry(id: SoundId): Entry {
    return manifest.sounds[id] as Entry;
  }

  /** Loads every one-shot and ambience (music streams on first play). */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    for (const id of Object.keys(manifest.sounds) as SoundId[]) {
      if (this.entry(id).category !== 'music') this.variants(id);
    }
  }

  private variants(id: SoundId): Howl[] {
    let list = this.howls.get(id);
    if (!list) {
      const e = this.entry(id);
      list = e.variants.map((v) => new Howl({ src: [v.url], loop: e.loop, html5: e.category === 'music', preload: true, volume: 0 }));
      this.howls.set(id, list);
    }
    return list;
  }

  setMuted(muted: boolean): void {
    Howler.mute(muted);
  }

  setMasterVolume(v: number): void {
    this.master = Math.max(0, Math.min(1, v));
    Howler.volume(this.master);
  }

  /** Where the player listens from: the camera's focus and its right on the ground. */
  setListener(x: number, z: number, yawTurns: number, distance: number): void {
    const yaw = yawTurns * 2 * Math.PI;
    this.listener.x = x;
    this.listener.z = z;
    this.listener.rightX = Math.cos(yaw);
    this.listener.rightZ = -Math.sin(yaw);
    this.listener.distance = distance;
  }

  /** A one-shot, at a place on the field (or flat, for the interface). */
  play(id: SoundId, opts: { readonly at?: { readonly x: number; readonly z: number }; readonly volume?: number; readonly rate?: number } = {}): void {
    if (!this.loaded) return;
    const list = this.variants(id);
    const howl = list[Math.floor(Math.random() * list.length)];
    if (!howl) return;
    const e = this.entry(id);
    let gain = BUS[e.category] * (opts.volume ?? 1);
    let pan = 0;
    if (opts.at) {
      const dx = opts.at.x - this.listener.x;
      const dz = opts.at.z - this.listener.z;
      const d = Math.hypot(dx, dz);
      const reach = NEAR_M + this.listener.distance * 0.35;
      gain *= d <= reach ? 1 : (reach / d) ** FALLOFF;
      const across = dx * this.listener.rightX + dz * this.listener.rightZ;
      pan = Math.max(-PAN_MAX, Math.min(PAN_MAX, across / (PAN_ACROSS_M + this.listener.distance * 0.3)));
    }
    if (gain < AUDIBLE_MIN) return;
    const sid = howl.play();
    howl.volume(gain, sid);
    howl.stereo(pan, sid);
    howl.rate((opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * PITCH_JITTER), sid);
  }

  /** A loop towards `volume` (0 stops it after the fade). */
  loop(id: SoundId, volume: number, fadeMs = 2000): void {
    if (!this.loaded) return;
    const e = this.entry(id);
    const target = BUS[e.category] * Math.max(0, Math.min(1, volume));
    let l = this.loops.get(id);
    if (!l) {
      if (target <= 0) return;
      const howl = this.variants(id)[0];
      if (!howl) return;
      const sid = howl.play();
      howl.volume(0, sid);
      l = { howl, id: sid, target: 0 };
      this.loops.set(id, l);
    }
    if (Math.abs(l.target - target) < 0.005) return;
    const from = l.howl.volume(l.id) as number;
    l.howl.fade(from, target, fadeMs, l.id);
    l.target = target;
    if (target <= 0) {
      const done = l;
      done.howl.once('fade', () => {
        if (done.target <= 0) {
          done.howl.stop(done.id);
          this.loops.delete(id);
        }
      }, done.id);
    }
  }

  /** Every loop fades out (leaving a battle). */
  stopLoops(fadeMs = 800): void {
    for (const id of [...this.loops.keys()]) this.loop(id, 0, fadeMs);
  }
}

export const audio = new AudioEngine();
