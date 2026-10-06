---
name: reel-edit
description: Edit footage mentah talking-head Steven (rekaman HP, ngomong ke kamera) jadi Reels 9:16 siap posting — potong jeda hening otomatis, color grade, bersihkan suara, subtitle dua lapis (kalimat biasa sans kecil + kata kunci serif italic besar emas), SFX yang mengikuti animasi subtitle (ketik/klik/whoosh/riser dari pustaka reels/sfx) tanpa musik latar, zoom/pan di tiap potongan, b-roll/screenshot, dan motion graphic secukupnya. Pakai setiap kali Steven mengirim video mentah dan bilang "edit video ini", "editin reels", "kasih subtitle", "potong yang diem", "bikin kayak referensi", atau minta revisi video hasil skill ini (v2, v3, …). Bukan untuk motion graphic dari naskah tanpa footage (itu /miva-motion) atau deck (/deck-request).
---

# Reel Edit — footage mentah → Reels siap posting

Steven cukup mengirim **video mentah** (+ opsional referensi, b-roll, screenshot). Claude langsung build sampai MP4
terverifikasi. Tanpa checkpoint storyboard; tanya hanya kalau isi video ambigu (mis. tidak jelas mana yang mau dibuang).

Implementasi rujukan: `reels/edit/2026-10-03-tes-edit/v2/` (gaya ini disetujui sebagai arah 03/10, dibangun dari
video referensi Steven). v1 di folder induknya = gaya lama (subtitle lime tebal), jangan ditiru.

## Alur kerja

Semua script di `scripts/`, dipanggil dengan folder proyek. Node portable: `reels/motion/_tools/node` (render.sh mengurus PATH).
Python selalu dengan `PYTHONIOENCODING=utf-8`.

1. **Proyek:** `MIVA/reels/edit/<YYYY-MM-DD-slug>/` (versi baru = subfolder `v2`, `v3`, … ; versi lama tidak ditimpa).
   Salin `template/{hyperframes.json,package.json}` + buat `meta.json`. Jangan taruh file `.html` lain berisi
   `data-composition-id` di root proyek (`multiple_root_compositions`).
2. **Bedah mentahan:** contact sheet `ffmpeg -i raw -vf "fps=1,scale=180:-1,tile=8x5" -frames:v 1 sheet.png` → lihat.
   Catat: detik pasang kamera/goyang, posisi wajah (untuk `origin`), area kosong untuk grafik (biasanya atas kepala).
3. **Transkrip + potong:** `python transcribe.py <raw> <proj>` → `words-raw.json` + `edit.json` (segs otomatis:
   jeda ≥ 0,22 dtk dibuang, akhir kata yang molor dipangkas pakai energi pita suara). Model Whisper medium ada di cache.
   Baca transkripnya: isi `edit.json.fix` untuk salah dengar (nama produk! mis. "Gepkart"→"CapCut", "cloud"→"Claude").
   Buang basa-basi/kalimat gagal kalau jelas salah ulang (Steven mengulang kalimat → ambil yang terakhir).
4. **Base:** `python build_base.py <proj>` → `assets/base.mp4` (potong + percepat 1,25x + grade), `assets/voice.wav` (-14 LUFS), `timing.json`.
   Grade: `natural` (default, footage siang/terang), `warm` (indoor/malam ala referensi), `lift` (footage gelap), atau string filter sendiri.
5. **Subtitle:** `python captions.py <proj>` → draf `captions.json`. Lalu **kurasi** (bagian terpenting, lihat
   `references/caption-style.md`): pilih 5–8 kata kunci per 30 dtk → `big`, `anim` (slam/blur/type), `hit` untuk 1–2 punchline.
6. **Grafik per video:** `overlay.css`, `overlay.html`, `overlay.js` di folder proyek (disuntik ke template oleh build_html).
   Pakai komponen di `references/motion-graphics.md`. Secukupnya: grafik muncul saat ada nama/angka/benda yang disebut,
   bukan di setiap kalimat. B-roll/screenshot dari Steven → `edit.json.inserts`.
7. **Cek:** `python build_html.py <proj>` (cetak daftar subtitle + SFX) lalu `npx.cmd --yes hyperframes@0.8.84 check`
   (error 0) + `snapshot --at <detik kunci> --describe false` → **lihat contact sheet**: wajah tidak tertutup,
   kata kunci tidak menabrak dagu saat zoom, grafik di zona aman.
8. **Render:** `bash scripts/render.sh <proj> <slug-vN> [--wa]` → check, PNG sequence, `mix.py` (suara + SFX), MP4, contact sheet `renders/_verify-*.png`. **Lihat contact sheet-nya.**
9. **Cover JPG (wajib, aturan Steven 05/10):** satu cover per video, judul di tengah atas (di atas kepala) talking-head.
   Pilih frame wajah (ekstrak 6–8 kandidat dari `assets/base.mp4`, lihat: mata terbuka, ekspresi enak, tidak di tengah kata),
   judul = inti hook, pendek (baris kecil Inter + 1 baris besar serif emas ≤ ±14 huruf):
   `python scripts/cover.py <proj> --t <detik> --judul "baris kecil|*BARIS BESAR*" --nama <slug-vN> [--salin <folder hasil>]`
   → `renders/<slug-vN>-cover.jpg` 1080×1920. Judul di zona y 300–680 = aman untuk potongan grid IG 3:4. **Lihat hasilnya.**
10. **Kirim:** `SendUserFile` (display `render`), video + cover. WA hanya kalau Steven minta:
   `python reels/motion/_tools/kirim_video_wa.py --ke <no> --file <proj>/renders/<slug>-wa.mp4 --caption "..." --kirim`.
11. **Laporan singkat:** durasi (sebelum → sesudah), apa yang terverifikasi (check, frame MP4, level LUFS suara/SFX),
    dan yang TIDAK: Claude tidak bisa mendengar → rasa SFX dinilai Steven; label SFX masih dugaan sampai
    dikoreksi lewat `reels/sfx/lib/audisi.html`; timing kata dari Whisper bisa meleset ±0,2 dtk; `/privacy-check` belum.

## Mode motion — naskah tanpa footage + voice over (05/10)

Dipakai kalau Steven minta video **full motion graphic** dari naskah (talking-head) lewat /reel-edit. Pipeline subtitle
dua lapis, SFX otomatis, mix, dan render tetap sama; yang berubah:

1. **VO, bukan footage:** `vo.json` (kalimat + `gap` jeda sesudah kalimat sebelumnya, `say` = ejaan TTS, mis. "MIVA"→"Miva")
   → `python scripts/tts_vo.py <proj>` → `assets/voice.wav` (-14 LUFS) + `timing.json` (kata dari alignment ElevenLabs,
   `lines` per kalimat). Langkah 2–4 (transcribe/build_base) dilewati. Suara: **ElevenLabs** (pilihan Steven 05/10; key di env
   User `ELEVENLABS_API_KEY`, di-set Steven sendiri). edge-tts DITOLAK (POC 29/09). Cache per kalimat di `assets/vo-cache/`
   → render ulang tidak memakan kredit. `--dummy` = timing perkiraan tanpa API untuk menyusun grafik dulu;
   `--sampel "teks"` = sampel tiap suara di `vo.json.kandidat`.
   **Suara default: edge-tts `en-US-AvaMultilingualNeural` (VO Inggris, rate +4%), subtitle & teks layar tetap Indonesia**
   (`vo.json`: `text` = Indonesia, `say` = Inggris, `"terjemahan": true`, `"lang": "en"`). Dipilih Steven 05/10: "Ava lebih natural,
   tanpa aksen". Ditolak: suara Indonesia edge-tts & ElevenLabs (pria Jonathan; wanita Velora/Zulsyifah/Azka/Lyly, aksen).
   **Suara: wanita, natural**. Selalu kirim 3–4 sampel hook dulu sebelum
   VO penuh. Tanpa API key yang valid: pakai connector ElevenLabs (creative_generate_speech, satu kali naskah utuh) →
   unduh MP3 → `tts_vo.py <proj> --audio file.mp3` (Whisper menyelaraskan kata ke naskah, dipotong per kalimat).
2. **edit.json `"mode": "motion"`** → build_html memakai `template/motion.tpl` (tanpa video, tanpa kamera otomatis),
   dan menyuntik `D.lines`, `D.words`, `D.marks`.
3. **Waktu adegan = `marks.py` proyek** (turunan dari kalimat VO) → `marks.json` + `edit.json.sfx` (bunyi grafik), dan
   memeriksa aturan baca (balasan yang diketik selesai sebelum VO berikutnya, end card ≥ 2,5 dtk). overlay.js hanya membaca
   `D.marks`. Ganti suara/kecepatan → jalankan ulang tts_vo → marks.py → build_html; sinkron ikut.
4. **Subtitle dikurasi lewat teks** (`caps_spec.py` proyek: kelompok kata, `*` = kata kunci, opsi anim/hit) — aman dijalankan
   ulang setelah VO berubah karena indeks kata dari teks, bukan waktu.
5. Visual mengikuti miva-motion (palet gelap MIVA, satu jendela chat = satu dunia, teks diketik lalu diam, sebelum = dingin
   abu-abu / sesudah = sapuan mint). Zona: jendela chat x 140–940, y 196–1196; subtitle `--cap-y: 1400px`.
   Stabilo kata di dalam bubble = `background-size` 0→100% pada span inline (aman untuk teks yang terbagi 2 baris;
   pseudo/`<i>` absolut di span yang patah baris rusak).
Rujukan: `reels/edit/2026-10-05-chatbot-bertele/`.

## Aturan dari Steven (jangan dilanggar tanpa alasan)

- **Fast paced (06/10):** footage mentah dipercepat **1,25x** (`edit.json.speed`, default di `build_base.py`; suara atempo,
  pitch tetap; `speed: 1` hanya kalau Steven minta). Jeda tanpa suara dibuang seminim mungkin: `GAP_CUT` 0,22 dtk, padding
  potongan 0,06/0,08 dtk, kamera 1 gerakan per 1,8 dtk. Jeda tanpa suara hanya dipertahankan kalau ada motion graphic yang
  butuh waktu tampil (beri `hold` manual di `edit.json.segs`/inserts, bukan jeda mentah). Mode motion: VO Ava rate +20%
  (bukan +4%), `gap` antar kalimat 0 - 0,1 dtk kecuali beat visual, `lead` 0,15; end card tetap ≥ 2,5 dtk.
  Laporan akhir sebut durasi mentah → sesudah potong+speed, dan cek subtitle masih terbaca (≥ 0,5 dtk per kelompok kata).
- Subtitle kata kunci **beda font, ukuran, dan warna** dari subtitle biasa (03/10).
- **SFX mengikuti cara subtitle muncul:** diketik → bunyi ketik, langsung muncul → klik, kata kunci slam → whoosh,
  blur-in → swish. Intro → riser yang puncaknya jatuh di kata kunci pertama (03/10). Otomatis di build_html.py.
- SFX dari pustaka `reels/sfx/lib` (potongan 3 file kiriman Steven), **secukupnya**: boom maks 1 per video.
- **Tanpa musik latar, cukup SFX** (04/10; menggantikan aturan 03/10 "musik kecil"). `edit.json.music` = `{"style": "none"}`;
  jangan isi musik kecuali Steven memintanya untuk video tertentu.
- Tidak menimpa versi lama; folder/file baru bernama `YYYY-MM-DD-...`.

## Feedback → perbaiki skill ini

Koreksi Steven atas hasil skill ini diperbaiki **di file skill pada turn yang sama** (`references/*.md`, `scripts/*`,
`template/`), bukan cuma di videonya, lalu dicatat di `references/changelog.md` dengan tanggal.
Koreksi label SFX dari audisi → perbarui `reels/sfx/lib/catalog.json` (set `"dikonfirmasi": true`).

## Referensi

| File | Isi |
|---|---|
| `references/caption-style.md` | gaya subtitle dua lapis dari video referensi, cara memilih kata kunci, format captions.json |
| `references/sfx-music.md` | pustaka SFX (kategori, level, cara menambah file baru), aturan SFX otomatis, (musik: tidak dipakai) |
| `references/motion-graphics.md` | zona layar & safe zone Reels, kamera (zoom/whip), komponen overlay siap pakai, b-roll |
| `references/gotchas.md` | jebakan yang sudah pernah kena (Whisper/PyAV, noise mobil, lint HyperFrames, render Windows) |
| `references/changelog.md` | riwayat feedback → aturan |
| `scripts/transcribe.py` | Whisper + potong hening otomatis → words-raw.json, edit.json |
| `scripts/build_base.py` | potong + grade + bersihkan suara → base.mp4, voice.wav, timing.json |
| `scripts/captions.py` | draf kelompok subtitle → captions.json |
| `scripts/build_html.py` | template + data + overlay → index.html; SFX otomatis → cues.json |
| `scripts/mix.py` | suara + SFX → _mix.wav, laporan LUFS (kode musik ada tapi default mati) |
| `scripts/render.sh` | pipeline render final + contact sheet (+ versi WA) |
| `scripts/cover.py` | cover JPG 1080×1920: frame talking-head + judul tengah atas (wajib tiap video) |
| `scripts/sfx_slice.py`, `scripts/sfx_audisi.py` | potong file SFX baru ke pustaka; halaman audisi label |
