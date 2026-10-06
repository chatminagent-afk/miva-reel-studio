# Kamera, zona layar, grafik, b-roll

## Zona (kanvas 1080×1920)

| Zona | y (px) | Isi |
|---|---|---|
| UI atas Reels | 0–180 | kosong |
| Grafik | 220–600 | chip, kartu logo, stiker poll, ajakan komen (biasanya plafon/atas kepala — cek footage) |
| Wajah | ±600–1050 (membesar saat zoom) | jangan ditutup |
| Kata kunci | 1010–1530 | serif emas bertumpuk |
| Subtitle biasa | 1210–1390 | pill |
| UI bawah Reels | > 1560, kanan > 950 di 1100–1700 | kosong |

## Kamera (otomatis, `edit.json.camera = "auto"`)

- **Gerak dasar harus terlihat** (Steven 05/10: "kalau tidak terlihat, tidak berguna"). Tiap potongan dipecah jadi ketukan
  ±2,6 dtk; tiap ketukan bergerak (sine.inOut) ke keadaan berikutnya di siklus `STATES` build_html.py:
  lebar 1,00 → zoom in 1,14 → pan kanan +50 px → zoom out 1,04 → zoom in + pan kiri 1,13/-45 → pan kanan +45 → zoom out 1,02.
  Di tiap jump cut siklus melompat satu langkah, jadi framing berganti dan lompatan potongan tersamarkan.
- Batas aman tanpa tepi hitam: |x| ≤ 540·(skala−1), y ≤ origin_y·(skala−1); build_html menolak keadaan yang melanggar.
- `edit.json.camera_kuat` (default 1,0) = pengali amplitudo; 0,5 untuk video yang butuh lebih kalem.
- Kata kunci `slam` → punch-in +0,08 dalam 0,2 dtk di lapisan `#aroll` (terpisah dari gerak dasar di `#cam`, tidak saling timpa),
  ditahan sampai potongan berikutnya; maks 1 punch per potongan.
- `edit.json.whip = [i]` → potongan ke-i masuk dengan whip (zoom 1,3 + blur 14px → normal 0,6 dtk) + whoosh.
  Pakai untuk menutupi kamera goyang (mis. HP baru dipasang) atau pergantian topik.
- `origin` = titik zoom, default `"50% 40%"` (wajah). Sesuaikan kalau wajah tidak di tengah.
- Gerakan manual: `edit.json.camera = [{"t", "from"?, "to": {scale,x,y}, "dur", "ease"}]` menggantikan auto seluruhnya.

## B-roll / screenshot (`edit.json.inserts`)

`[{"t": 4.2, "dur": 1.8, "src": "assets/broll-1.mp4", "zoom": 0.06}]` — layar penuh di atas footage (suara tetap jalan),
masuk zoom-blur 0,45 dtk + whoosh, Ken Burns pelan. Gambar (png/jpg) atau video (mp4/mov/webm, otomatis muted).
Referensi memakai cutaway tiap 3–6 dtk; untuk Steven: pakai kalau ada aset (screenshot dashboard/chat MIVA, rekaman layar),
jangan cari stok dari internet tanpa izin. Konten MIVA/klien di b-roll → `/privacy-check` wajib.

## Komponen overlay siap pakai (salin dari `reels/edit/2026-10-03-tes-edit/v2/overlay.*`)

| Komponen | Pakai saat | SFX manual |
|---|---|---|
| Chip aplikasi (`.chip`, ikon huruf + nama) | menyebut beberapa tool/merek berurutan; tersapu keluar saat topik berganti | pop (-4…-8 dB), whoosh saat tersapu |
| Kartu logo/produk (`#claudeCard`) | nama produk utama disebut (gaya referensi: logo di atas kepala) | ikut whoosh/boom kata kunci |
| Viewfinder REC (`#vf`) | "video yang kalian tonton ini" / meta | klik |
| Stiker poll (`#poll`) | pertanyaan ke penonton | pop/klik |
| Pill ajakan komen (`#cmtPill`) | penutup / CTA | pop |
| Flash putih 0,3 | reveal terbesar (bareng boom) | — |

Nama merek ditulis sebagai teks + ikon huruf generik, bukan logo resmi pihak lain.
Aturan gerak overlay: masuk `back.out` 0,26–0,42 dtk, keluar fade 0,2–0,3 dtk; satu grafik besar dalam satu waktu.
