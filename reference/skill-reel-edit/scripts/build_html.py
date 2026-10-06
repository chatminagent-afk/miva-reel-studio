"""timing.json + captions.json + edit.json + template.tpl -> index.html + cues.json (SFX otomatis).

    python build_html.py <folder_proyek>

index.html dan cues.json SELALU dibangkitkan — yang diedit: captions.json, edit.json, overlay.css/.html/.js (grafik per video).

SFX otomatis (aturan Steven 03/10: bunyi mengikuti cara teks muncul):
  subtitle "type"  -> ketik (dipangkas sepanjang durasi ketik)      subtitle "pop" -> klik
  kunci "slam"     -> whoosh (puncaknya jatuh di kata) [+ hit]       kunci "blur"   -> swish     kunci "type" -> ketik
  intro            -> riser yang puncaknya jatuh di kata kunci pertama (<= 5 dtk) atau di potongan pertama
  whip/insert      -> whoosh
Kepadatan: klik/ketik dilewati kalau < 0,30 dtk dari SFX sebelumnya; boom maks 1 per video.
"""
import json, re, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
LIB = Path(r"D:\Documents\Claude Cowork\MIVA\reels\sfx\lib")
CPS = 28
MIN_GAP = 0.30
SKILL = Path(__file__).resolve().parent.parent


def clean(t):
    return re.sub(r"[,.]+$", "", t)


def disp_words(W, idx):
    """kata tampil; '-xxx' digabung ke kata sebelumnya ("aplikasi-aplikasi")."""
    out = []
    for i in idx:
        w = W[i]
        if w["w"].startswith("-") and out:
            out[-1]["t"] += clean(w["w"])
            out[-1]["ids"].append(i)
        else:
            out.append({"t": clean(w["w"]), "s": w["s"], "ids": [i]})
    return out


# Kamera otomatis (05/10, Steven: "perbesar zoom in, out, panning — kalau tidak terlihat, tidak berguna").
# Tiap potongan dipecah jadi ketukan ±BEAT dtk; tiap ketukan bergerak ke keadaan berikutnya di siklus STATES
# (zoom in, pan, zoom out, zoom-in+pan, ...). Di tiap jump cut siklus melompat satu langkah -> skala/posisi berganti,
# lompatan potongan tersamarkan. Batas aman tanpa tepi hitam: |x| <= 540*(s-1), y <= origin_y*(s-1) (dicek di bawah).
BEAT = 1.8   # 06/10 fast paced (dulu 2,6)
STATES = [  # (skala, x px, y px)
    (1.00, 0, 0),       # lebar
    (1.14, 0, -20),     # zoom in
    (1.14, 50, -20),    # pan ke kanan
    (1.04, 0, 0),       # zoom out
    (1.13, -45, 10),    # zoom in + pan ke kiri
    (1.13, 45, 10),     # pan ke kanan
    (1.02, 0, 0),       # zoom out
]


def auto_camera(T, keys, E):
    cuts = [0.0] + T["cuts"] + [T["duration"]]
    whip = set(E.get("whip", []))           # indeks potongan (0 = potongan pertama) yang masuk dengan whip
    kuat = float(E.get("camera_kuat", 1.0))  # 0,5 = lebih kalem, 1 = default
    oy = 1920 * float(str(E.get("origin", "50% 40%")).split()[1].rstrip("%")) / 100

    def st(i):
        sc, x, y = STATES[i % len(STATES)]
        sc = 1 + (sc - 1) * kuat
        x, y = x * kuat, y * kuat
        assert abs(x) <= 540 * (sc - 1) + 0.01 and -oy * (sc - 1) - 0.01 <= y <= (1920 - oy) * (sc - 1) + 0.01, (sc, x, y)
        return {"scale": round(sc, 4), "x": round(x, 1), "y": round(y, 1)}

    cam, k = [], 0
    for i in range(len(cuts) - 1):
        t0, t1 = cuts[i], cuts[i + 1]
        k += 1                                # lompat satu keadaan di tiap potongan
        if i in whip and i > 0:
            w = st(k)
            cam.append({"t": t0, "from": {"scale": w["scale"] + 0.3, "x": w["x"] - 60, "y": w["y"], "filter": "blur(14px)"},
                        "to": {**w, "filter": "blur(0px)"}, "dur": 0.6, "ease": "power2.out"})
            t0 += 0.6
        d = t1 - t0
        n = max(1, round(d / BEAT))
        bd = d / n
        for j in range(n):
            cam.append({"t": round(t0 + j * bd, 3), "from": st(k), "to": st(k + 1), "dur": round(bd, 3), "ease": "sine.inOut"})
            k += 1
        # punch-in kata kunci "slam" di lapisan #aroll (terpisah dari gerak dasar), ditahan sampai potongan berikutnya
        hit = next((kk for kk in keys if kk["anim"] == "slam" and cuts[i] <= kk["s"] < t1 - 0.3), None)
        if hit:
            cam.append({"el": "#aroll", "t": hit["s"], "from": {"scale": 1}, "to": {"scale": 1 + 0.08 * kuat}, "dur": 0.2, "ease": "power3.out"})
            cam.append({"el": "#aroll", "t": round(t1 - 0.01, 3), "from": {"scale": 1 + 0.08 * kuat}, "to": {"scale": 1}, "dur": 0.01, "ease": "none"})
    return cam


def main():
    proj = Path(sys.argv[1])
    T = json.load(open(proj / "timing.json", encoding="utf-8"))
    C = json.load(open(proj / "captions.json", encoding="utf-8"))["chunks"]
    E = json.load(open(proj / "edit.json", encoding="utf-8"))
    W, dur = T["words"], T["duration"]
    flat = [i for c in C for i in c["w"]]
    assert flat == list(range(len(W))), f"captions.json harus mencakup semua kata berurutan 0..{len(W) - 1}"

    caps, keys = [], []
    for k, c in enumerate(C):
        s = W[c["w"][0]]["s"] - 0.04
        nxt = W[C[k + 1]["w"][0]]["s"] - 0.04 if k + 1 < len(C) else dur
        e = round(min(nxt, W[c["w"][-1]]["e"] + 0.45), 3)
        words = disp_words(W, c["w"])
        if c.get("big"):
            big = set(c["big"])
            lines, cur_small = [], []
            for w in words:                     # kata besar = baris sendiri; penghubung kecil digabung per baris
                if big & set(w["ids"]):
                    if cur_small:
                        lines.append({"t": " ".join(cur_small), "big": False}); cur_small = []
                    if lines and lines[-1]["big"]:
                        lines[-1]["t"] += " " + w["t"]
                    else:
                        lines.append({"t": w["t"], "big": True, "s": w["s"]})
                else:
                    cur_small.append(w["t"])
            if cur_small:
                lines.append({"t": " ".join(cur_small), "big": False})
            hit_t = min(l["s"] for l in lines if l["big"])
            keys.append({"s": round(s, 3), "e": e, "hit": round(hit_t, 3), "anim": c.get("anim", "slam"),
                         "pos": c.get("pos", "c"), "lines": lines, "sfx_hit": c.get("hit")})
        else:
            caps.append({"s": round(s, 3), "e": e, "anim": c.get("anim", "pop"),
                         "words": [{"t": w["t"], "s": w["s"]} for w in words]})

    motion = E.get("mode") == "motion"         # tanpa footage: latar motion, VO dari tts_vo.py, tanpa kamera otomatis
    cam = [] if motion and E.get("camera", "auto") == "auto" else (
        auto_camera(T, keys, E) if E.get("camera", "auto") == "auto" else E["camera"])
    inserts = E.get("inserts", [])

    # ---------------- SFX otomatis
    fit = json.load(open(LIB / "_fitur.json", encoding="utf-8"))
    cat = json.load(open(LIB / "catalog.json", encoding="utf-8"))
    rot = {}

    def pick(kat):
        ids = [i for i in cat["pilihan"].get(kat, []) if cat["bunyi"].get(i, {}).get("kategori") != "buang"]
        if not ids:
            return None
        n = rot.get(kat, 0); rot[kat] = n + 1
        return ids[n % len(ids)]

    cues = []

    def add(t, kat, peak_align=False, dur=None, prio=1, gain_db=0.0, sid=None):
        sid = sid or pick(kat)
        if not sid:
            return
        off = 0.0
        if peak_align:                       # puncak bunyi jatuh tepat di t
            f = fit[sid]
            off = f["peak_at"] * f["dur"]
        cues.append({"t": round(t - off, 3), "id": sid, "kat": kat, "dur": dur, "prio": prio, "gain_db": gain_db})

    first_key = next((k["hit"] for k in keys if k["hit"] <= 5), None)
    riser_hit = first_key if first_key is not None else (T["cuts"][0] if T["cuts"] else W[0]["s"] if W else 1.0)
    if E.get("riser", True):
        add(riser_hit, "riser", peak_align=True, prio=2)
    for c in caps:
        if c["anim"] == "type":
            n = len(" ".join(w["t"] for w in c["words"]))
            add(c["s"] + 0.02, "ketik", dur=round(n / CPS + 0.05, 3))
        else:
            add(c["s"], "klik")
    booms = 0
    for k in keys:
        if k["anim"] == "slam":
            add(k["hit"], "whoosh", peak_align=True, prio=2, gain_db=-2)
        elif k["anim"] == "blur":
            add(k["hit"], "swish", peak_align=True, prio=2)
        else:
            n = len(" ".join(l["t"] for l in k["lines"]))
            add(k["s"] + 0.02, "ketik", dur=round(n / CPS + 0.05, 3))
        if k["sfx_hit"] == "boom" and booms == 0:
            add(k["hit"], "boom", prio=3); booms += 1
        elif k["sfx_hit"]:
            add(k["hit"], "impact", prio=3)
    for i in E.get("whip", []):
        if 0 < i <= len(T["cuts"]):
            add(T["cuts"][i - 1] + 0.05, "whoosh", peak_align=True, prio=2)
    for ins in inserts:
        add(ins["t"], "whoosh", peak_align=True, prio=2)
    for m in E.get("sfx", []):                 # manual: {"t", "kat"|"id", "gain_db"?, "align"?}
        add(m["t"], m.get("kat", ""), peak_align=m.get("align", False), prio=3, gain_db=m.get("gain_db", 0), sid=m.get("id"),
            dur=m.get("dur"))

    cues.sort(key=lambda c: c["t"])
    hi = [c["t"] for c in cues if c["prio"] >= 2 and c["kat"] != "riser"]
    kept, last = [], -9
    for c in cues:                             # kepadatan: klik/ketik mengalah ke bunyi lain dalam ±MIN_GAP
        if c["prio"] == 1 and (c["t"] - last < MIN_GAP or any(abs(c["t"] - h) < MIN_GAP for h in hi)):
            continue
        kept.append(c)
        if c["kat"] != "riser":
            last = c["t"]
    json.dump({"duration": dur, "music": E.get("music", {"style": "none"}), "sfx": kept},
              open(proj / "cues.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    data = {"duration": dur, "cuts": T["cuts"], "caps": caps, "keys": keys, "camera": cam, "inserts": inserts,
            "origin": E.get("origin", "50% 40%"), "cps": CPS,
            "lines": T.get("lines", {}), "words": [[w["s"], w["e"]] for w in W],
            # mode motion: waktu adegan dari marks.json (dibuat script proyek, mis. marks.py) -> D.marks di overlay.js
            "marks": json.load(open(proj / "marks.json", encoding="utf-8")) if (proj / "marks.json").exists() else {}}
    ins_html = ""
    for i, ins in enumerate(inserts):
        tag = (f'<video id="ins{i}v" src="{ins["src"]}" muted playsinline data-start="{ins["t"]}" data-duration="{ins["dur"]}" class="clip"></video>'
               if ins["src"].lower().endswith((".mp4", ".mov", ".webm")) else f'<img id="ins{i}v" src="{ins["src"]}" alt="" />')
        wrap_timing = "" if tag.startswith("<video") else f' class="clip" data-start="{ins["t"]}" data-duration="{ins["dur"]}"'
        ins_html += f'<div class="ins" id="ins{i}"{wrap_timing}><div class="insIn" id="ins{i}in">{tag}</div></div>\n'
    # template: milik proyek kalau ada (jarang perlu), selain itu template skill; overlay per video dari overlay.css/html/js
    tp = proj / "template.tpl" if (proj / "template.tpl").exists() else         SKILL / "template" / ("motion.tpl" if motion else "template.tpl")
    tpl = tp.read_text(encoding="utf-8")
    ov = {k: (proj / f"overlay.{k}").read_text(encoding="utf-8") if (proj / f"overlay.{k}").exists() else ""
          for k in ("css", "html", "js")}
    html = (tpl.replace("__DUR__", f"{dur:.2f}").replace("__DATA__", json.dumps(data, ensure_ascii=False))
               .replace("<!--INSERTS-->", ins_html).replace("      /*OVERLAY-CSS*/", ov["css"])
               .replace("<!--OVERLAY-HTML-->", ov["html"].strip()).replace("/*OVERLAY-JS*/", ov["js"].strip()))
    (proj / "index.html").write_text(html, encoding="utf-8")

    W2 = {c["s"]: "  " + " ".join(w["t"] for w in c["words"]) for c in caps}
    W2.update({k["s"]: "★ " + " / ".join(("[" + l["t"] + "]") if l["big"] else l["t"] for l in k["lines"]) for k in keys})
    for s in sorted(W2):
        print(f"{s:6.2f} {W2[s]}")
    print(f"SFX: {len(kept)} cue ({len(cues) - len(kept)} dilewati karena terlalu rapat): " +
          ", ".join(f"{c['t']:.2f} {c['kat']}" for c in kept))


main()
