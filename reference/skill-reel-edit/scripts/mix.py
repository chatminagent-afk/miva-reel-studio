"""voice.wav + SFX dari cues.json -> renders/_mix.wav, plus laporan level.

ATURAN STEVEN 04/10: TANPA musik latar, cukup SFX. Default "none"; kode musik di bawah hanya dipakai kalau Steven
sendiri meminta musik lagi untuk video tertentu.

    python mix.py <folder_proyek>

Musik (cues.json "music", dari edit.json):
  {"style": "none"}             DEFAULT — tanpa musik
  {"style": "piano"}            felt piano pelan sintetis (bebas lisensi, generator skill miva-motion)
  {"style": "bright"}           groove ceria sintetis (miva-motion)
  {"file": "path.mp3", "start": 0}   file milik sendiri / berlisensi
  opsional: "lufs" (default -34 = jauh di bawah suara -14 LUFS), "duck_db" (default 8)
Aturan Steven 03/10: musik latar KECIL, suara tidak boleh tertutup -> setelah mix, selisih suara vs musik
harus >= 16 LU; kalau tidak, script gagal.
"""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
SR = 48000
LIB = Path(r"D:\Documents\Claude Cowork\MIVA\reels\sfx\lib")
MOTION = Path(r"D:\Documents\Claude Cowork\MIVA\skills\miva-motion\scripts")
# puncak tiap kategori (dBFS) setelah klip dinormalisasi; suara -14 LUFS (puncak ±-1,5)
PEAK = {"ketik": -25, "klik": -22, "tick": -24, "whoosh": -17, "swish": -20, "impact": -13, "boom": -11,
        "riser": -15, "ding": -19, "pop": -20, "kartun": -18, "glitch": -20, "lain": -20}


def rd(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def wr(p, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(p), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


def lufs(p):
    out = subprocess.run(["ffmpeg", "-i", str(p), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True, encoding="utf-8", errors="ignore").stderr
    tail = out[out.rfind("Summary:"):]
    i = float(tail.split("I:")[1].split("LUFS")[0])
    pk = float(tail.split("Peak:")[1].split("dBFS")[0]) if "Peak:" in tail else 0.0
    return i, pk


def db(x):
    return 10 ** (x / 20)


def music(spec, dur, proj):
    st = spec.get("style", "none")
    if spec.get("file"):
        m = rd(spec["file"])
        a = int(spec.get("start", 0) * SR)
        m = m[a:a + int(dur * SR)]
    elif st == "none":
        print("musik: tidak dipakai (aturan 04/10, cukup SFX)")
        return None
    else:
        sys.path.insert(0, str(MOTION))
        import make_sound as ms          # noqa: E402  (SR sama: 48000)
        rng = np.random.default_rng(spec.get("seed", 11))
        chords = spec.get("chords") or [{"t": t, "notes": n} for t, n in zip(
            np.arange(0, dur, 4 * 60 / spec.get("bpm", 84)),
            [["C3", "G3", "E4", "B4"], ["A2", "E3", "G3", "C4"], ["F2", "C3", "A3", "E4"], ["G2", "D3", "B3", "D4"]] * 40)]
        if st == "bright":
            m = ms.make_bright({"bpm": spec.get("bpm", 100), "chords": chords,
                                "sections": [{"t": 0, "end": dur, "parts": ["kick", "hat", "bass", "arp"]}]}, dur, rng)
        else:
            m = ms.make_music({"bpm": spec.get("bpm", 84), "subdiv": 2, "chords": chords, "reverb_wet": 0.3,
                               "pulse": {"t": 0, "rel_db": -9}, "fade_in": 0.6, "fade_out": [dur - 1.5, dur],
                               "rms_db": -20}, chords, dur, rng)
    n = int(dur * SR)
    m = np.vstack([m, np.zeros((max(0, n - len(m)), 2))])[:n]
    t = np.arange(n) / SR
    m *= (np.clip(t / 0.6, 0, 1) * np.clip((dur - t) / 1.5, 0, 1))[:, None]
    return m


def main():
    proj = Path(sys.argv[1])
    Q = json.load(open(proj / "cues.json", encoding="utf-8"))
    dur = Q["duration"]
    n = int(dur * SR)
    voice = rd(proj / "assets" / "voice.wav")
    voice = np.vstack([voice, np.zeros((max(0, n - len(voice)), 2))])[:n]
    fit = json.load(open(LIB / "_fitur.json", encoding="utf-8"))

    sfx = np.zeros((n, 2))
    for c in Q["sfx"]:
        y = rd(LIB / f"{c['id']}.wav")
        y = y / (np.abs(y).max() + 1e-9) * db(PEAK.get(c["kat"], -20) + c.get("gain_db", 0))
        a = int(round(c["t"] * SR))
        if a < 0:                       # riser yang mulai sebelum 0: pakai ekornya saja
            y, a = y[-a:], 0
        if c.get("dur"):                # ketik dipangkas sepanjang animasi ketik, fade 60 ms
            L = min(len(y), int(c["dur"] * SR))
            y = y[:L].copy()
            f = min(L, int(0.06 * SR))
            y[-f:] *= np.linspace(1, 0, f)[:, None]
        b = min(n, a + len(y))
        sfx[a:b] += y[:b - a]

    m = music(Q.get("music", {}), dur, proj)
    if m is not None:
        # ducking: envelope suara (RMS 50 ms, attack cepat, release 300 ms) -> musik turun duck_db saat ada suara
        hop = int(0.01 * SR)
        e = np.array([np.sqrt(np.mean(voice[i:i + hop] ** 2)) for i in range(0, n, hop)])
        act = np.clip((20 * np.log10(e + 1e-9) + 42) / 10, 0, 1)        # 0 = diam, 1 = bicara
        sm = np.zeros_like(act)
        for i in range(len(act)):
            prev = sm[i - 1] if i else 0
            sm[i] = prev + (act[i] - prev) * (0.5 if act[i] > prev else 0.033)
        g = db(-Q["music"].get("duck_db", 8) * np.repeat(sm, hop)[:n])
        m = m * g[:, None]
        wr(proj / "renders" / "_music.wav", m)
        mi, _ = lufs(proj / "renders" / "_music.wav")
        target = Q["music"].get("lufs", -34)
        m *= db(target - mi)
    else:
        m = np.zeros((n, 2))
    wr(proj / "renders" / "_music.wav", m)
    wr(proj / "renders" / "_sfx.wav", sfx)
    mix = voice + sfx + m
    pk = np.abs(mix).max()
    if pk > db(-1.0):
        mix *= db(-1.0) / pk
    wr(proj / "renders" / "_mix.wav", mix)

    vi, _ = lufs(proj / "assets" / "voice.wav")
    mi = lufs(proj / "renders" / "_music.wav")[0] if np.abs(m).max() > 0 else -99
    si = lufs(proj / "renders" / "_sfx.wav")[0]
    fi, fp = lufs(proj / "renders" / "_mix.wav")
    mus = f"musik {mi:.1f} LUFS (selisih {vi - mi:.1f} LU)" if mi > -99 else "tanpa musik"
    print(f"suara {vi:.1f} LUFS | {mus} | SFX {si:.1f} LUFS | "
          f"mix {fi:.1f} LUFS, puncak {fp:.1f} dBFS | {len(Q['sfx'])} SFX")
    if mi > -99 and vi - mi < 16:
        sys.exit("GAGAL: musik terlalu keras dibanding suara (< 16 LU). Turunkan music.lufs.")


main()
