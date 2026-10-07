# Keputusan & tracker — MIVA Reel Studio

Desktop app lokal (Windows) untuk mengedit Reels talking-head, menggantikan langganan CapCut dan upload footage ke Claude Code.
Pipeline diturunkan dari skill `/reel-edit` dan `/miva-motion` (sumber: repo `claude-cowork`, `projects/miva/skills/`).

## Keputusan terkunci

| Tanggal | Keputusan | Alasan |
|---|---|---|
| 2026-10-06 | Stack **Electron + HTML/GSAP** (render lewat HyperFrames + FFmpeg) | Hasil identik dengan gaya v2 yang sudah disetujui; preview di app = hasil render (engine Chromium sama); template skill dipakai ulang |
| 2026-10-06 | **PC Windows dulu**, mobile ditunda | Whisper + render 1080×1920 terlalu berat untuk HP; iOS butuh Apple Developer $99/tahun |
| 2026-10-06 | **Full offline** setelah install | Permintaan Steven. Semua model, font, FFmpeg, HyperFrames dibundel; tidak ada fetch saat runtime |
| 2026-10-06 | Saran kata kunci punya **3 mode** di Settings: `Rules` (offline, default), `Local LLM` (GPU, offline, komponen opsional), `Claude` (online, opsional) | Offline tetap jalan penuh; Claude hanya dipakai kalau online dan dipilih |
| 2026-10-06 | UI **English**, layout **3 panel ala CapCut** + preset layout (Default / Media / Timeline / Preview), panel bisa di-resize | Pilihan Steven |
| 2026-10-06 | Alur **otomatis dulu, lalu review** (tombol Auto Edit setelah import) | Instan editing |
| 2026-10-06 | Trim lewat **transkrip + timeline sinkron** | Hapus kata = potong video, geser batas di timeline untuk presisi |
| 2026-10-06 | Export **1080p / 2K (1440×2560) / 4K (2160×3840)** | Permintaan Steven |
| 2026-10-06 | Folder proyek tetap **kompatibel dengan skill** (`edit.json`, `captions.json`, `timing.json`) | `/reel-edit` di Claude Code tetap bisa melanjutkan proyek dari app |
| 2026-10-06 | UAT di PC Steven **lulus 100%** sebelum app disebut ready | Standar QA Steven |
| 2026-10-06 | **UI di-approve**: mockup v2 struktur CapCut (`docs/mockup/`, artifact "MIVA Reel Studio UI") | Approve Steven 06/10 |
| 2026-10-06 | Export punya **pilihan folder** (Browse), opsi jadikan default, dan buka folder setelah selesai | Feedback Steven 06/10 |
| 2026-10-06 | App dikirim hanya setelah **UAT otomatis end-to-end lulus 100%** (`docs/2026-10-06-uat-plan.md`), lalu UAT manual Steven | Permintaan Steven 06/10 |
| 2026-10-06 | Font dan GSAP dibundel lokal; telemetry HyperFrames dimatikan; Chrome headless dibundel | Syarat offline (spike 06/10) |
| 2026-10-06 | **Motion graphic masuk fase 1**: pustaka komponen (chip, kartu logo, angka/counter, poll, CTA, lower third) lewat drag & drop + saran penempatan otomatis (Rules / Local LLM / Claude, lalu approve) | Feedback render spike 06/10: end goal butuh motion; di skill grafik dibuat manual per video |
| 2026-10-06 | **Semua fitur `/reel-edit` masuk fase 1** (gap analysis 06/10): koreksi transkrip + kamus nama, editor cover JPG, detail kamera (titik zoom wajah, kekuatan, punch-in, whip, deteksi awal goyang), detail subtitle (posisi/warna kata kunci, safe zone), jeda untuk grafik + scrim, kelola pustaka SFX, laporan export, kirim WA via Kirimi (online, opsional), musik latar opsional + ducking (default mati) | Pilihan Steven 06/10: hasil app harus setara skill |
| 2026-10-06 | **`/miva-motion` (naskah → motion + VO) di fase 2**, setelah editor footage lolos UAT | Pilihan Steven 06/10 |
| 2026-10-06 | **Export 2K = overlay dirender 4K (Chrome DPR 2) lalu diturunkan ke 1440×2560**; video 1080p dinaikkan (lanczos). 4K = overlay 4K langsung | Pilihan Steven 06/10 (sesi 2). `--resolution` HyperFrames hanya kelipatan bulat 1080 |
| 2026-10-06 | Kode langkah 1 tetap di branch **`feat/foundation`** (sesi cloud baru juga) | Pilihan Steven 06/10 (sesi 2) |
| 2026-10-06 | Footage `tes2.mp4` **tidak di-upload ulang** ke sesi cloud ("anggap aman"); tes integrasi export memakai footage + SFX sintetis dengan data nyata acuan tes2; tes potong hening dari footage asli di-skip | Jawaban Steven 06/10 (sesi 2) |
| 2026-10-06 | Binary dibundel dan dipin: **Chrome headless shell 152.0.7977.30** (versi pin HyperFrames 0.8.84, sha256 di `resources/manifest.json`), **FFmpeg 8.0 essentials (gyan.dev)** untuk Windows, font `@fontsource` 5.3.0 (set face = yang dipakai render skill online), GSAP 3.14.2 | Syarat offline; versi Chrome sama dengan yang diuji HyperFrames |
| 2026-10-06 | Proses render dijaga **penjaga offline** (`resources/scripts/offline-guard.mjs`): semua koneksi TCP non-loopback dari proses HyperFrames ditolak dan dicatat; komposisi yang memuat URL internet ditolak sebelum render | Bukti offline di level kode, bukan hanya env var; HyperFrames diam-diam mengunduh font kalau ada internet |
| 2026-10-06 | Encoder: **NVENC dicoba sungguhan dulu** (encode 0,2 dtk), kalau gagal pakai libx264 (CRF 18, sama dengan skill) / libx265 | `ffmpeg -encoders` mencantumkan NVENC walau tidak ada GPU NVIDIA |
| 2026-10-07 | **Satu installer** berisi semuanya (app, Chrome headless, FFmpeg, Python, faster-whisper, DLL CUDA, model large-v3-turbo) | Pilihan Steven 07/10: "biar ga ribet". Lihat risiko batas 2 GB NSIS di tabel ditunda |
| 2026-10-07 | Sidecar transkripsi = **Python 3.13 (paket NuGet resmi) + `resources/whisper/sidecar.py`**, paket dari lock ber-hash (`resources/whisper/requirements-*.lock`, `--require-hashes`); setelan dan format `words-raw.json` sama dengan `transcribe.py` skill; CUDA float16 dites hangat (1 dtk hening) lalu fallback CPU int8; kalau proses mati saat memakai CUDA, diulang sekali di CPU; penjaga offline juga di Python | Offline, hasil instalasi selalu sama, tahan DLL CUDA rusak (bisa mematikan proses tanpa exception) |
| 2026-10-06 | Engine transkripsi **faster-whisper large-v3-turbo (CUDA fp16, fallback CPU int8)** | Benchmark di laptop Steven: WER 2,8%, satu-satunya yang akurat sekaligus memberi celah kata untuk potong hening; whisper.cpp gugur (`docs/2026-10-06-whisper-benchmark.md`) |

## Lingkup fitur versi 1

Dasar (selalu masuk): timeline multi-track, drag & drop (dari panel dan dari Windows Explorer), split (Ctrl+B), trim tarik tepi klip,
ripple delete, magnet main track, snapping, copy/paste, undo/redo, thumbnail + waveform, auto captions (Whisper lokal),
hapus hening & salah ucap, subtitle dua lapis + SFX otomatis (aturan skill), checkpoint versi, export 1080p/2K/4K.

Motion graphic: pustaka komponen + saran penempatan otomatis (lihat keputusan 06/10).

Dari skill `/reel-edit` (gap analysis 06/10): koreksi transkrip + kamus nama, editor cover JPG, detail kamera & subtitle,
jeda untuk grafik + scrim, kelola pustaka SFX (tambah/potong/audisi/label), laporan export, kirim WA (opsional, online), musik opsional.

Pro yang dipilih Steven: **Transform + keyframe** (scale, posisi, rotate, crop, mirror, keyframe, transisi & filter dasar),
**Audio pro** (noise reduction, voice enhance, volume/fade per klip, ducking), **Remove BG + stabilize** (model lokal di GPU).

## Target hardware

AMD Ryzen 7 7735HS, NVIDIA RTX 4060 (laptop, 8 GB VRAM), RAM 32 GB, Windows 11.
Whisper dan model lokal lain jalan di GPU (CUDA); encode MP4 pakai NVENC. Whisper dan LLM lokal tidak dijalankan bersamaan (VRAM 8 GB).

## Pertanyaan terbuka

- "Fitur yang paling sering digunakan user" (jawaban Steven 06/10): interpretasi sementara = speed (0,5–2×), teks bebas/judul,
  freeze frame, reverse, adjust warna (exposure/contrast/saturation/temperature), aspect ratio. Menunggu konfirmasi.
- Footage sampel: `tes2.mp4` diterima 06/10 (37 dtk, 1080×1920 HEVC 30 fps, AAC 44,1 kHz, rekaman di mobil). Belum di-commit
  ke repo (27 MB, wajah Steven); menunggu keputusan simpan lewat Git LFS atau tidak.
  Temuan awal: noise floor pita suara -34 dB vs median -29 dB (selisih kecil karena noise mobil), jadi deteksi hening berbasis
  energi saja lemah; potongan harus berbasis celah kata Whisper (sesuai gotcha skill). ±2 dtk awal = kamera dipasang/goyang.
  Plafon mobil di atas kepala kosong, aman untuk zona grafik.
- Tes Whisper di sesi cloud terblokir network policy (`huggingface.co`); benchmark dijalankan di laptop Steven 06/10.
- Model LLM lokal untuk saran kata kunci: belum dipilih; kualitas bahasa Indonesia harus diuji dulu.
- Build preview (alpha) lebih awal (import → Auto Edit → koreksi transkrip → export 1080p) dengan UAT subset 100%, atau tunggu
  fase 1 lengkap? Estimasi 06/10: alpha ±5–7 sesi, fase 1 lengkap ±15–20 sesi. Alpha melonggarkan aturan "dikirim setelah UAT
  lengkap 100%", jadi butuh keputusan Steven.
- Tes transkripsi dengan model asli di CI (GitHub Actions, sekali jalan manual `workflow_dispatch`): unduh model + pin hash,
  transkripsi suara uji. Biaya: menit Actions repo private (kuota Free 2.000 menit/bulan, Windows dihitung 2×), unduhan ±3 GB
  per run tanpa cache. Alternatif tanpa biaya: Steven menjalankan `npm run fetch-resources -- --pin` + tes di laptop.
- Footage untuk UAT otomatis di GitHub Actions: `tes2.mp4` lewat Git LFS, atau footage sintetis saja (potong hening dengan
  suara asli tidak teruji di CI).

## Ditunda (risiko dikerjakan vs tidak)

| Item | Kalau dikerjakan sekarang | Kalau ditunda |
|---|---|---|
| Mobile (iOS/Android) | Biaya $99/tahun (iOS), render berat di HP, risiko crash | Edit hanya di PC |
| Code signing `.exe` | ±$200+/tahun | Peringatan SmartScreen saat install ("Run anyway") |
| Mode naskah/VO (`/miva-motion`) → **fase 2** | TTS ElevenLabs/edge-tts butuh internet; kandidat offline: Kokoro (HyperFrames `tts`, Inggris) untuk VO default Ava, kualitas harus dibandingkan | Selama fase 1, mode motion tetap lewat Claude Code |
| Pin sha256 FFmpeg Windows (`resources/manifest.json` masih `null`) | — | GitHub diblokir network policy sesi cloud; hash diambil di CI Windows pertama (`fetch-resources --pin`) lalu di-commit. Sebelum dipin, build menolak FFmpeg (fail closed) |
| Batas ±2 GB installer NSIS (electron-builder) | — | Perkiraan installer ±3,2 GB terkompresi (cuBLAS 553 MB + cuDNN 743 MB + model ±1,6 GB + Chrome/FFmpeg/app). Opsi di langkah 9: pembuat installer yang mendukung > 2 GB, setup.exe + file data dalam satu folder/zip, atau pangkas DLL cuDNN yang tidak dipakai ctranslate2 (wajib uji GPU). Dipilih saat langkah 9 |
| Pin revisi + sha256 model Whisper (`whisper-model` di manifest masih `null`) | — | huggingface.co diblokir di sesi cloud; dipin di CI/laptop pertama (`fetch-resources --pin`). Sebelum dipin, unduhan model ditolak (fail closed) |
| Tes transkripsi dengan model asli | Butuh model (CI dengan akses HF atau laptop Steven) | Di cloud teruji: protokol + fallback (faster_whisper palsu), library asli ter-import + API cocok, error model. Akurasi/CUDA belum teruji di app |
| Whip di export cepat | Terjemahkan blur kamera ke FFmpeg (`gblur` per frame) + verifikasi PSNR | Proyek dengan whip ditolak export cepat (pesan jelas); butuh jalur render penuh sebelum fitur whip dibuka di UI (langkah 6d) |
| Teks & stiker manual + preset gaya subtitle lain | Menambah tools, UI lebih ramai | Hanya gaya subtitle MIVA |

## Risiko teknis yang sudah diketahui

- Render 4K ±4× piksel dari 1080p, jadi lebih lama. Footage sumber 1080p yang diekspor 4K = upscale, bukan tambah detail.
- Electron bukan yang paling ringan (installer ±150 MB + model Whisper ±1,5 GB + LLM lokal opsional ±5 GB). "Ringan" dikejar di startup cepat dan UI mulus.
- Potong hening otomatis bisa memotong napas/jeda berpikir, jadi tiap potongan bisa disetujui atau ditolak.
- SFX harus disinkronkan ulang setiap trim berubah (dihitung ulang dari timing, bukan disimpan sebagai waktu absolut).
- Label SFX di pustaka masih dugaan sampai diaudisi Steven.
