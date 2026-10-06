"""Footage mentah -> words-raw.json (Whisper, waktu per kata) + draf edit.json (potongan hening otomatis).

    python transcribe.py <video_mentah> <folder_proyek> [--model medium]

Kenapa tidak silencedetect: footage HP (mis. di mobil) punya noise rata ±-20 dB, jadi jeda bicara tidak pernah
"sunyi". Yang dipakai: energi pita suara 250–3500 Hz per 10 ms + celah antar-kata Whisper. Akhir kata Whisper
sering molor (mis. 1 dtk untuk "Premiere"), jadi akhir kata dipangkas ke frame terakhir yang masih bersuara.

edit.json yang SUDAH ada tidak ditimpa (hanya words-raw.json yang diperbarui) — kecuali --ulang-potong.
"""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")

GAP_CUT = 0.22     # jeda >= ini dibuang (fast paced 06/10; dulu 0,40)
PAD_IN, PAD_OUT = 0.06, 0.08


def load16k(src, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "16000", str(out)], check=True)
    w = wave.open(str(out))
    return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def band_db(src, tmp):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "16000",
                    "-af", "highpass=f=250,lowpass=f=3500", str(tmp)], check=True)
    w = wave.open(str(tmp))
    a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    hop = 160
    return np.array([20 * np.log10(np.sqrt(np.mean(a[i:i + hop] ** 2)) + 1e-9) for i in range(0, len(a), hop)])


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, proj = Path(sys.argv[1]), Path(sys.argv[2])
    model = sys.argv[sys.argv.index("--model") + 1] if "--model" in sys.argv else "medium"
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "renders").mkdir(exist_ok=True)
    tmp = proj / "renders"
    audio = load16k(src, tmp / "_a16k.wav")

    from faster_whisper import WhisperModel   # pip install faster-whisper; model medium ±1,5 GB (cache HF)
    m = WhisperModel(model, device="cpu", compute_type="int8")
    # numpy array, BUKAN path: faster-whisper 1.2.1 + PyAV baru error `metadata_errors` kalau diberi path
    segs, _ = m.transcribe(audio, language="id", word_timestamps=True, vad_filter=False, beam_size=5)
    words = []
    for s in segs:
        print(f"[{s.start:6.2f}-{s.end:6.2f}] {s.text}")
        words += [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 2)} for w in s.words]
    json.dump(words, open(proj / "words-raw.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)

    # pangkas akhir kata yang molor pakai energi pita suara
    edb = band_db(src, tmp / "_band.wav")
    floor = np.percentile(edb, 20)
    thr = floor + 5
    for w in words:
        a, b = int(w["s"] * 100), int(w["e"] * 100)
        on = np.where(edb[a:b] > thr)[0]
        w["e_ref"] = round(max(w["s"] + 0.08, (a + on[-1] + 1) / 100 if len(on) else w["e"]), 3)

    cut = []
    for w in words:
        if cut and w["s"] - cut[-1][1] < GAP_CUT:
            cut[-1][1] = w["e_ref"]
        else:
            cut.append([w["s"], w["e_ref"]])
    dur = len(audio) / 16000
    segs_out = []
    for i, (a, b) in enumerate(cut):
        a = max(0.0, a - PAD_IN, segs_out[-1][1] if segs_out else 0)
        b = min(dur, b + PAD_OUT, cut[i + 1][0] - 0.02 if i + 1 < len(cut) else dur)
        segs_out.append([round(float(a), 2), round(float(b), 2)])
    total = sum(b - a for a, b in segs_out)

    print("\nkata (celah > 0,25 dtk ditandai):")
    prev = None
    for w in words:
        gap = w["s"] - prev if prev is not None else 0
        print(f"  {w['s']:6.2f}-{w['e_ref']:6.2f}{'  ┆ jeda %.2f' % gap if gap > 0.25 else ''}\t{w['w']}\t(p {w['p']})")
        prev = w["e_ref"]
    print(f"\npotongan: {segs_out}\ndurasi {total:.2f} dtk dari {dur:.2f} (noise floor pita suara {floor:.1f} dB)")

    ep = proj / "edit.json"
    if ep.exists() and "--ulang-potong" not in sys.argv:
        print("edit.json sudah ada - tidak ditimpa (pakai --ulang-potong untuk menulis ulang 'segs').")
        return
    edit = json.load(open(ep, encoding="utf-8")) if ep.exists() else {
        "src": str(src), "fix": {}, "grade": "natural", "music": {"style": "none"}, "camera": "auto", "sfx": [], "inserts": []}
    edit["segs"] = segs_out
    json.dump(edit, open(ep, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"ditulis: {ep}")


main()
