"""Cover JPG Reels (wajib tiap video, aturan Steven 05/10): frame talking-head + judul di tengah atas, di atas kepala.

    python cover.py <folder_proyek> --t <detik> --judul "kecil|*BESAR*|kecil" [--zoom 1.06] [--salin <folder>] [--nama x]

- --t      detik di assets/base.mp4 (video hasil potong + grade). Pilih frame wajah: mata terbuka, mulut tidak di tengah kata,
           tidak tertutup grafik (lihat contact sheet / kandidat frame dulu).
- --judul  baris dipisah '|'; baris diawali '*' = serif italic emas besar (gaya kata kunci subtitle), lainnya = Inter putih.
           Maks ±2 baris kecil + 1 baris besar; teks besar ≤ ±14 huruf (ukuran menyusut otomatis).
- Judul di tengah atas, zona y 300–680 — masuk potongan grid IG 3:4 (y 240–1680) dan di atas kepala.
Hasil: <proyek>/renders/<nama>-cover.jpg (1080×1920, q 92) [+ salinan ke --salin]. Render pakai Chrome headless.
"""
import argparse, html, shutil, subprocess, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
CHROME = [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
          r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"]

ap = argparse.ArgumentParser()
ap.add_argument("proj")
ap.add_argument("--t", type=float, required=True)
ap.add_argument("--judul", required=True)
ap.add_argument("--zoom", type=float, default=1.06)
ap.add_argument("--salin")
ap.add_argument("--nama")
a = ap.parse_args()
proj = Path(a.proj).resolve()
nama = a.nama or proj.name
out_dir = proj / "renders"
out_dir.mkdir(exist_ok=True)
frame = out_dir / "_cover-frame.png"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(a.t), "-i", str(proj / "assets" / "base.mp4"), "-frames:v", "1", str(frame)], check=True)

lines = []
for raw in a.judul.split("|"):
    big = raw.startswith("*")
    t = html.escape(raw.lstrip("*").strip())
    if big:
        size = 168 if len(t) <= 9 else max(104, int(168 * 9 / len(t) * 1.25))
        lines.append(f'<div class="big" style="font-size:{size}px">{t}</div>')
    else:
        lines.append(f'<div class="small">{t}</div>')
doc = f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@1,700;1,800&family=Playfair+Display:ital,wght@1,800&display=block" rel="stylesheet">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
html, body {{ width: 1080px; height: 1920px; overflow: hidden; background: #000; }}
#bg {{ position: absolute; inset: 0; background: url("{frame.name}") center 55% / cover no-repeat; transform: scale({a.zoom}); transform-origin: 50% 50%; }}
#shade {{ position: absolute; left: 0; right: 0; top: 0; height: 900px;
          background: linear-gradient(180deg, rgba(8,10,12,0.62) 0%, rgba(8,10,12,0.40) 45%, rgba(8,10,12,0) 100%); }}
#ttl {{ position: absolute; left: 70px; right: 70px; top: 300px; height: 380px; display: flex; flex-direction: column;
        justify-content: center; align-items: center; text-align: center; gap: 6px; }}
.small {{ font-family: Inter, sans-serif; font-style: italic; font-weight: 800; font-size: 58px; letter-spacing: -1px; color: #fff;
          text-shadow: 0 3px 16px rgba(0,0,0,0.65); line-height: 1.1; }}
.big {{ font-family: "Playfair Display", Georgia, serif; font-style: italic; font-weight: 800; line-height: 0.98; letter-spacing: -4px;
        color: #ffd65a; -webkit-text-stroke: 3px rgba(40,24,0,0.55); paint-order: stroke fill;
        text-shadow: 0 6px 28px rgba(20,12,0,0.6), 0 1px 2px rgba(0,0,0,0.5); max-width: 940px; }}
</style></head><body><div id="bg"></div><div id="shade"></div><div id="ttl">{''.join(lines)}</div></body></html>"""
page = out_dir / "_cover.html"
page.write_text(doc, encoding="utf-8")
png = out_dir / "_cover.png"
exe = next(c for c in CHROME if Path(c).exists())
subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                "--window-size=1080,1920", "--virtual-time-budget=8000", f"--screenshot={png}", page.as_uri()],
               check=True, capture_output=True)
jpg = out_dir / f"{nama}-cover.jpg"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(png), "-vf", "crop=1080:1920:0:0", "-q:v", "2", str(jpg)], check=True)
for f in (frame, page, png):
    f.unlink()
print("cover:", jpg)
if a.salin:
    dst = Path(a.salin) / jpg.name
    shutil.copy(jpg, dst)
    print("disalin:", dst)
