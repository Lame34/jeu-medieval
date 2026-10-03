"""Audio pipeline (J5, brief §11), run headless by Blender (its audaspace module decodes and
encodes every format we need; no ffmpeg on this machine):

    blender -b --factory-startup --python scripts/blender/process_audio.py -- \
        scripts/audio-manifest.json assets-src/raw/audio public/assets/audio src/audio/audio-manifest.json

For each sound of the manifest and each of its source files: leading and trailing silence cut
(one-shots), optional start / maximum length with a fade-out, optional rate (speed and pitch),
then a gain bringing its RMS level to its category's target, bounded by a peak ceiling. One-shots
and UI sounds are written mono, ambiences and music stereo, all Ogg Vorbis at 44.1 kHz. Writes
the runtime manifest the game loads (urls, durations, loop flags, categories).
"""
import json
import math
import os
import sys

import aud

SILENCE_DB = -50.0
RATE = 44100
BITRATE = {"sfx": 80000, "ui": 64000, "ambience": 96000, "music": 128000}
STEREO = {"ambience", "music"}


def db_to_gain(db):
    return 10.0 ** (db / 20.0)


def analyse(sound):
    """(rms, peak, length in s) of a sound."""
    data = sound.data()
    rate = sound.specs[0]
    if data.size == 0:
        return 0.0, 0.0, 0.0
    flat = data.reshape(-1)
    peak = float(abs(flat).max())
    rms = float(math.sqrt(float((flat * flat).mean())))
    return rms, peak, data.shape[0] / rate


def trimmed_span(sound, threshold):
    """First and last time (s) the sound rises above `threshold` (linear)."""
    data = sound.data()
    rate = sound.specs[0]
    mono = abs(data).max(axis=1) if data.ndim > 1 else abs(data)
    above = (mono > threshold).nonzero()[0]
    if above.size == 0:
        return 0.0, data.shape[0] / rate
    return float(above[0]) / rate, float(above[-1] + 1) / rate


def process(entry, src, targets, peak_db):
    category = entry["category"]
    loop = entry.get("loop", False)
    s = aud.Sound(src)
    if entry.get("rate"):
        s = s.pitch(float(entry["rate"]))
    if not loop:
        start, end = trimmed_span(s, db_to_gain(SILENCE_DB))
        start = max(start, float(entry.get("startS", 0.0)))
        if entry.get("maxS"):
            end = min(end, start + float(entry["maxS"]))
        s = s.limit(start, end)
        if entry.get("fadeS"):
            fade = float(entry["fadeS"])
            s = s.fadeout(max(0.0, end - start - fade), fade)
    channels = 2 if category in STEREO else 1
    s = s.rechannel(channels).resample(RATE, True)
    rms, peak, length = analyse(s)
    target = targets[category] + float(entry.get("gainDb", 0.0))
    gain = db_to_gain(target) / max(rms, 1e-6)
    gain = min(gain, db_to_gain(peak_db) / max(peak, 1e-6))
    return s.volume(gain), channels, length, 20 * math.log10(max(rms * gain, 1e-9))


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    manifest_path, raw_root, out_dir, runtime_path = args[:4]
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    os.makedirs(out_dir, exist_ok=True)
    runtime = {"generated": "scripts/blender/process_audio.py", "sounds": {}}
    total = 0
    for sid, entry in manifest["sounds"].items():
        variants = []
        for k, rel in enumerate(entry["sources"]):
            src = os.path.join(raw_root, rel)
            if not os.path.exists(src):
                raise SystemExit(f"[audio] {sid}: missing source {src}")
            sound, channels, length, level = process(entry, src, manifest["targets"], manifest["peakDb"])
            name = f"{sid}_{k}.ogg"
            path = os.path.join(out_dir, name)
            sound.write(path, rate=RATE, channels=aud.CHANNELS_STEREO if channels == 2 else aud.CHANNELS_MONO, format=aud.FORMAT_S16,
                        container=aud.CONTAINER_OGG, codec=aud.CODEC_VORBIS, bitrate=BITRATE[entry["category"]])
            size = os.path.getsize(path)
            total += size
            variants.append({"url": f"/assets/audio/{name}", "durationS": round(length, 3)})
            print(f"[audio] {name:28s} {length:6.2f} s {level:6.1f} dB {size / 1024:7.0f} KiB")
        runtime["sounds"][sid] = {"category": entry["category"], "loop": entry.get("loop", False), "variants": variants}
    runtime["totalBytes"] = total
    with open(runtime_path, "w", encoding="utf-8") as f:
        json.dump(runtime, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"[audio] {len(runtime['sounds'])} sounds, {total / 1024 / 1024:.1f} MiB -> {out_dir}")


main()
