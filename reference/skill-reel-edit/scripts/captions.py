"""timing.json -> draf captions.json (kelompok kata + animasi default). Claude lalu menandai kata kunci.

    python captions.py <folder_proyek> [--timpa]

Format captions.json (satu entri = satu kemunculan subtitle):
  {"w": [i, ...], "anim": "type"|"pop"}                         subtitle biasa (sans kecil putih, pill gelap)
  {"w": [i, ...], "big": [i, ...], "anim": "slam"|"blur"|"type", "hit": "impact"|"boom"|null, "pos": "c"|"l"|"r"}
      kata kunci: kata di "big" = serif italic besar emas, kata lain di kelompok = penghubung kecil yang menumpuk
      (sebelum kata besar = di atas, sesudahnya = di bawah). "hit" = bunyi tambahan untuk punchline (boom maks 1x/video).
Waktu muncul = awal kata pertama; hilang = awal kelompok berikutnya (maks akhir kata terakhir + 0,45 dtk).
"""
import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")

MAX_WORDS, MAX_CHARS, GAP = 3, 18, 0.30
CPS = 28          # kecepatan ketik subtitle (huruf/dtk) — sama dengan template


def main():
    proj = Path(sys.argv[1])
    out = proj / "captions.json"
    if out.exists() and "--timpa" not in sys.argv:
        sys.exit("captions.json sudah ada (pakai --timpa untuk membuat ulang draf).")
    T = json.load(open(proj / "timing.json", encoding="utf-8"))
    W = T["words"]
    chunks, cur = [], []
    for i, w in enumerate(W):
        if w["w"].startswith("-") and cur:                      # "aplikasi -aplikasi" = satu kata tampil
            cur.append(i)
            continue
        text = " ".join(W[j]["w"] for j in cur)
        new_seg = cur and W[cur[-1]]["seg"] != w["seg"]
        gap = cur and w["s"] - W[cur[-1]]["e"] > GAP
        if cur and (len(cur) >= MAX_WORDS or len(text) + len(w["w"]) > MAX_CHARS or gap or new_seg
                    or re.search(r"[,.?!]$", W[cur[-1]]["w"])):
            chunks.append(cur)
            cur = []
        cur.append(i)
    if cur:
        chunks.append(cur)
    res = []
    for k, c in enumerate(chunks):
        text = " ".join(W[j]["w"] for j in c)
        nxt = W[chunks[k + 1][0]]["s"] if k + 1 < len(chunks) else T["duration"]
        room = nxt - W[c[0]]["s"]
        sent_start = k == 0 or re.search(r"[.?!]$", W[chunks[k - 1][-1]]["w"]) or W[c[0]]["seg"] != W[chunks[k - 1][-1]]["seg"]
        anim = "type" if sent_start and room >= len(text) / CPS + 0.3 else "pop"
        res.append({"w": c, "anim": anim, "_teks": text})
    json.dump({"chunks": res}, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for k, c in enumerate(res):
        print(f"{k:2d} {W[c['w'][0]]['s']:6.2f} {c['anim']:4s} {c['_teks']}")


main()
