"""edit.json (src, segs, fix, grade) -> assets/base.mp4 (tanpa audio) + assets/voice.wav + timing.json.

    python build_base.py <folder_proyek>

- Potongan `segs` digabung (fade audio 20/30 ms tiap sambungan supaya tidak "klik"), lalu dipercepat `speed`
  (default 1,25x; video setpts, suara atempo). Semua waktu di timing.json sudah dalam waktu SESUDAH percepat.
- Grade preset (lihat GRADES) atau string filter ffmpeg sendiri di edit.json "grade".
- Suara: highpass 90 Hz, denoise ringan, kompresor, loudnorm -14 LUFS (standar Reels).
- timing.json: kata dipetakan ke waktu baru; `fix` = koreksi salah dengar Whisper (kata persis -> pengganti).
"""
import json, subprocess, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")

SPEED_DEFAULT = 1.25   # fast paced (06/10): footage mentah dipercepat; edit.json "speed" = 1 untuk menonaktifkan

GRADES = {
    # disetujui di tes-edit v1 (03/10): footage HP siang, interior terang, kulit sedikit hangat
    "natural": "eq=contrast=1.06:brightness=0.008:saturation=1.12:gamma=0.98,"
               "colorbalance=rs=0.02:bs=-0.025:rm=0.015:bm=-0.015,"
               "curves=master='0/0 0.25/0.23 0.75/0.77 1/0.98',unsharp=5:5:0.45,vignette=angle=PI/5:mode=forward",
    # lebih kontras & hangat ala referensi (kafe/indoor malam)
    "warm": "eq=contrast=1.10:saturation=1.10:gamma=0.97,colorbalance=rs=0.04:gs=0.01:bs=-0.04:rm=0.03:bm=-0.03:rh=0.02:bh=-0.02,"
            "curves=master='0/0.02 0.25/0.22 0.75/0.78 1/0.97',unsharp=5:5:0.4,vignette=angle=PI/4.5:mode=forward",
    # footage gelap/flat: angkat bayangan dulu
    "lift": "eq=contrast=1.04:brightness=0.03:saturation=1.10:gamma=0.92,curves=master='0/0.03 0.3/0.33 0.7/0.75 1/0.98',"
            "unsharp=5:5:0.45,vignette=angle=PI/5:mode=forward",
}


def run(*a):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)


def main():
    proj = Path(sys.argv[1])
    E = json.load(open(proj / "edit.json", encoding="utf-8"))
    segs, fix = E["segs"], E.get("fix", {})
    speed = float(E.get("speed", SPEED_DEFAULT))
    grade = GRADES.get(E.get("grade", "natural"), E.get("grade"))
    parts, labels = [], ""
    for i, (a, b) in enumerate(segs):
        d = b - a
        parts.append(f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS[v{i}];"
                     f"[0:a]atrim={a}:{b},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st={d - 0.03:.3f}:d=0.03[a{i}];")
        labels += f"[v{i}][a{i}]"
    sv = f"setpts=PTS/{speed}," if speed != 1 else ""
    sa = f"atempo={speed}," if speed != 1 else ""      # atempo menjaga pitch suara
    fc = "".join(parts) + f"{labels}concat=n={len(segs)}:v=1:a=1[vc][ac];" \
         f"[vc]{sv}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920," f"{grade},format=yuv420p[vo];" \
         f"[ac]{sa}highpass=f=90,afftdn=nr=12:nf=-30,acompressor=threshold=-20dB:ratio=3:attack=5:release=120," \
         "loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[ao]"
    (proj / "assets").mkdir(exist_ok=True)
    mov = proj / "assets" / "_base.mov"
    run("-i", E["src"], "-filter_complex", fc, "-map", "[vo]", "-map", "[ao]", "-r", "30",
        "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-g", "15", "-c:a", "pcm_s16le", str(mov))
    run("-i", str(mov), "-an", "-c:v", "copy", "-movflags", "+faststart", str(proj / "assets" / "base.mp4"))
    run("-i", str(mov), "-vn", "-c:a", "copy", str(proj / "assets" / "voice.wav"))
    mov.unlink()

    words = json.load(open(proj / "words-raw.json", encoding="utf-8"))
    offs, acc = [], 0.0
    for a, b in segs:
        offs.append(acc)
        acc += b - a
    res, lost = [], []
    for w in words:
        t = w["s"] + 0.05                       # awal kata; akhir kata Whisper sering molor
        for (a, b), o in zip(segs, offs):
            if a <= t <= b:
                e = min(w.get("e_ref", w["e"]), b)
                res.append({"w": fix.get(w["w"], w["w"]), "s": round((max(w["s"], a) - a + o) / speed, 3),
                            "e": round((e - a + o) / speed, 3), "seg": segs.index([a, b])})
                break
        else:
            lost.append(w["w"])
    json.dump({"duration": round(acc / speed, 3), "speed": speed, "cuts": [round(o / speed, 3) for o in offs[1:]], "words": res},
              open(proj / "timing.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"base.mp4 {acc / speed:.2f} dtk (speed {speed}x, {acc:.2f} dtk sebelum percepat), {len(segs)} potongan, {len(res)}/{len(words)} kata")
    if lost:
        print("KATA TERBUANG (cek segs):", lost)
    for i, w in enumerate(res):
        print(f"{i}:{w['w']}@{w['s']}", end="  ")
    print()


main()
