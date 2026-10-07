"""Pustaka SFX bawaan app (sintetis, deterministik) -> resources/sfx-default/: <id>.wav + catalog.json + _fitur.json.

    python3 scripts/make-default-sfx.py

Dipakai selama pustaka SFX asli Steven (resources/sfx/, format sama dengan skill: sfx_slice.py) belum ada.
Kategori = yang dipakai aturan SFX otomatis build_html.py: riser, klik, ketik, whoosh, swish, boom, impact, pop, ding, tick.
peak_at dihitung seperti sfx_slice.py (posisi puncak envelope / panjang), dibulatkan 2 desimal.
"""
import json
import wave
from pathlib import Path

import numpy as np

SR = 48000
OUT = Path(__file__).resolve().parents[1] / "resources" / "sfx-default"
rng = np.random.default_rng(20261007)


def t(d):
    return np.arange(int(d * SR)) / SR


def env_ad(n, attack, decay_pow=3.0):
    a = max(1, int(attack * SR))
    e = np.ones(n)
    e[:a] = np.linspace(0, 1, a)
    e[a:] = np.linspace(1, 0, n - a) ** decay_pow
    return e


def bandnoise(n, lo, hi):
    x = rng.normal(0, 1, n)
    f = np.fft.rfftfreq(n, 1 / SR)
    s = np.fft.rfft(x)
    s[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(s, n)
    return y / (np.abs(y).max() + 1e-9)


def sweep_noise(d, f0, f1, peak):
    """Derau yang filternya menyapu f0 -> f1 (whoosh/swish/riser), envelope naik sampai `peak` lalu turun."""
    n = int(d * SR)
    hop = 1024
    out = np.zeros(n)
    for i in range(0, n, hop):
        p = i / n
        fc = f0 * (f1 / f0) ** p
        out[i:i + hop] = bandnoise(min(hop, n - i) + 0, fc * 0.6, fc * 1.6)[: min(hop, n - i)]
    k = int(peak * n)
    e = np.concatenate([np.linspace(0, 1, k) ** 2, np.linspace(1, 0, n - k) ** 1.5])
    return out * e


def tone(d, f, decay=4.0, harm=(1.0, 0.4, 0.2)):
    x = t(d)
    y = sum(a * np.sin(2 * np.pi * f * (h + 1) * x) for h, a in enumerate(harm))
    return y * np.exp(-decay * x)


def click(d=0.06):
    n = int(d * SR)
    return bandnoise(n, 2000, 9000) * env_ad(n, 0.0008, 6)


def typing(d=0.9, cps=14):
    n = int(d * SR)
    y = np.zeros(n)
    for k in range(int(d * cps)):
        at = int(k * SR / cps + rng.uniform(-0.01, 0.01) * SR)
        c = click(0.035) * rng.uniform(0.6, 1.0)
        if 0 <= at < n - len(c):
            y[at:at + len(c)] += c
    return y


def boom(d=1.4):
    x = t(d)
    f = 55 * np.exp(-1.2 * x) + 35
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-2.2 * x)
    n = len(x)
    y[: int(0.03 * SR)] += bandnoise(int(0.03 * SR), 80, 2000) * np.linspace(1, 0, int(0.03 * SR))
    return y * env_ad(n, 0.002, 1.0)


def impact(d=0.7):
    x = t(d)
    y = np.sin(2 * np.pi * 90 * x) * np.exp(-7 * x) + 0.6 * bandnoise(len(x), 200, 5000) * np.exp(-14 * x)
    return y


def pop(d=0.15):
    x = t(d)
    f = 900 * np.exp(-18 * x) + 300
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-25 * x)


SOUNDS = {
    "def-riser-1": ("riser", "riser naik 2 dtk", lambda: sweep_noise(2.0, 300, 6000, 0.98)),
    "def-whoosh-1": ("whoosh", "whoosh lebar", lambda: sweep_noise(0.55, 400, 4000, 0.45)),
    "def-whoosh-2": ("whoosh", "whoosh pendek", lambda: sweep_noise(0.4, 600, 5000, 0.5)),
    "def-swish-1": ("swish", "swish lembut", lambda: sweep_noise(0.45, 2500, 9000, 0.55) * 0.7),
    "def-klik-1": ("klik", "klik", lambda: click(0.06)),
    "def-klik-2": ("klik", "klik ringan", lambda: click(0.05) * 0.8),
    "def-ketik-1": ("ketik", "ketik keyboard", lambda: typing(1.0)),
    "def-boom-1": ("boom", "boom bass", lambda: boom()),
    "def-impact-1": ("impact", "impact", lambda: impact()),
    "def-pop-1": ("pop", "pop", lambda: pop()),
    "def-ding-1": ("ding", "ding", lambda: tone(0.9, 1318.5, 5.0)),
    "def-tick-1": ("tick", "tick", lambda: click(0.03) * 0.7),
}


def peak_at(y):
    hop = 480  # 10 ms
    env = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) for i in range(0, len(y), hop)])
    return round(int(np.argmax(env)) / max(1, len(env)), 2)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = {"bunyi": {}, "pilihan": {}}
    fitur = {}
    for sid, (kat, label, make) in SOUNDS.items():
        y = make()
        y = 0.9 * y / (np.abs(y).max() + 1e-9)
        st = np.stack([y, y], axis=1)
        with wave.open(str(OUT / f"{sid}.wav"), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((st * 32767).astype("<i2").tobytes())
        catalog["bunyi"][sid] = {"kategori": kat, "label": label, "bawaan": True}
        catalog["pilihan"].setdefault(kat, []).append(sid)
        fitur[sid] = {"dur": round(len(y) / SR, 3), "peak_at": peak_at(y)}
    json.dump(catalog, open(OUT / "catalog.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(fitur, open(OUT / "_fitur.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(SOUNDS)} bunyi -> {OUT}")


if __name__ == "__main__":
    main()
