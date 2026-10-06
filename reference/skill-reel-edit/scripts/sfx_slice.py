"""Potong file SFX kompilasi jadi bunyi satuan + fitur akustik -> reels/sfx/lib/*.wav + _fitur.json.

    python sfx_slice.py            (memproses semua file di reels/sfx/, kecuali folder lib/)

Label jenis TIDAK dibuat di sini: label ditulis manual di reels/sfx/lib/catalog.json (dugaan dari spektrogram,
lalu dikoreksi Steven lewat audisi.html). Script ini hanya memotong & mengukur, jadi aman dijalankan ulang.
"""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
SFX = Path(r"D:\Documents\Claude Cowork\MIVA\reels\sfx")
LIB = SFX / "lib"
SR = 44100
SHORT = {"Best Sound Effects": "best", "Riser Sound Effect": "riser", "Viral Sound Effects": "viral"}

def load(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "2", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<i2").reshape(-1, 2).astype(np.float32) / 32768

def segments(x, floor_db=-45, min_gap=0.10, split_drop_db=14, min_len=0.06):
    """bunyi = daerah di atas floor; daerah panjang dipecah lagi di lembah energi yang dalam (bunyi berdempetan)."""
    m = np.abs(x).max(axis=1)
    hop = int(0.01 * SR)
    env = np.array([m[i:i + hop].max() for i in range(0, len(m), hop)])
    edb = 20 * np.log10(env + 1e-9)
    on = edb > floor_db
    segs, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and (on[j] or (j + int(min_gap / 0.01) < n and on[j:j + int(min_gap / 0.01)].any())):
                j += 1
            segs.append([i, j]); i = j
        else:
            i += 1
    out = []
    for a, b in segs:                                   # pecah di lembah
        cuts, k = [a], a + 10
        sm = np.convolve(edb, np.ones(5) / 5, mode="same")
        while k < b - 10:
            left, right = sm[max(a, k - 25):k].max(), sm[k:min(b, k + 25)].max()
            if sm[k] < min(left, right) - split_drop_db and sm[k] == sm[k - 3:k + 4].min():
                cuts.append(k); k += 15
            else:
                k += 1
        cuts.append(b)
        out += [(c0, c1) for c0, c1 in zip(cuts, cuts[1:]) if (c1 - c0) * 0.01 >= min_len]
    return [(a * 0.01, b * 0.01) for a, b in out]

def features(y):
    mono = y.mean(axis=1)
    spec = np.abs(np.fft.rfft(mono * np.hanning(len(mono)))) + 1e-12
    f = np.fft.rfftfreq(len(mono), 1 / SR)
    cen = float((spec * f).sum() / spec.sum())
    low = float(spec[f < 150].sum() / spec.sum())
    flat = float(np.exp(np.mean(np.log(spec))) / np.mean(spec))     # ~1 noise, ~0 nada
    hop = int(0.01 * SR)
    env = np.array([np.abs(mono[i:i + hop]).max() for i in range(0, len(mono), hop)]) + 1e-9
    pk = int(env.argmax())
    d = np.diff(20 * np.log10(env))
    onsets = int(((d[1:] > 9) & (d[:-1] <= 9)).sum()) + 1
    return {"dur": round(len(mono) / SR, 3), "peak_db": round(float(20 * np.log10(np.abs(y).max() + 1e-9)), 1),
            "rms_db": round(float(20 * np.log10(np.sqrt((mono ** 2).mean()) + 1e-9)), 1),
            "centroid_hz": round(cen), "low_ratio": round(low, 2), "flatness": round(flat, 3),
            "peak_at": round(pk / max(1, len(env)), 2), "onsets": onsets}

def save(path, y):
    pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def main():
    LIB.mkdir(exist_ok=True)
    feats = {}
    for src in sorted(p for p in SFX.iterdir() if p.is_file()):
        short = next((v for k, v in SHORT.items() if k in src.name), src.stem[:12])
        x = load(src)
        for n, (a, b) in enumerate(segments(x), 1):
            a0, b0 = max(0, a - 0.01), min(len(x) / SR, b + 0.03)
            y = x[int(a0 * SR):int(b0 * SR)].copy()
            fade = int(0.004 * SR)
            y[:fade] *= np.linspace(0, 1, fade)[:, None]; y[-fade:] *= np.linspace(1, 0, fade)[:, None]
            sid = f"{short}-{n:02d}"
            save(LIB / f"{sid}.wav", y)
            feats[sid] = {"src": src.name, "t": round(a0, 2), **features(y)}
    json.dump(feats, open(LIB / "_fitur.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for k, v in feats.items():
        print(f"{k:9s} t={v['t']:6.2f} dur={v['dur']:5.2f} pk={v['peak_db']:6.1f} cen={v['centroid_hz']:5d} "
              f"low={v['low_ratio']:.2f} flat={v['flatness']:.3f} pkAt={v['peak_at']:.2f} on={v['onsets']}")

main()
