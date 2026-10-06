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

## Lingkup fitur versi 1

Dasar (selalu masuk): timeline multi-track, drag & drop (dari panel dan dari Windows Explorer), split (Ctrl+B), trim tarik tepi klip,
ripple delete, magnet main track, snapping, copy/paste, undo/redo, thumbnail + waveform, auto captions (Whisper lokal),
hapus hening & salah ucap, subtitle dua lapis + SFX otomatis (aturan skill), checkpoint versi, export 1080p/2K/4K.

Pro yang dipilih Steven: **Transform + keyframe** (scale, posisi, rotate, crop, mirror, keyframe, transisi & filter dasar),
**Audio pro** (noise reduction, voice enhance, volume/fade per klip, ducking), **Remove BG + stabilize** (model lokal di GPU).

## Target hardware

AMD Ryzen 7 7735HS, NVIDIA RTX 4060 (laptop, 8 GB VRAM), RAM 32 GB, Windows 11.
Whisper dan model lokal lain jalan di GPU (CUDA); encode MP4 pakai NVENC. Whisper dan LLM lokal tidak dijalankan bersamaan (VRAM 8 GB).

## Pertanyaan terbuka

- "Fitur yang paling sering digunakan user" (jawaban Steven 06/10): interpretasi sementara = speed (0,5–2×), teks bebas/judul,
  freeze frame, reverse, adjust warna (exposure/contrast/saturation/temperature), aspect ratio. Menunggu konfirmasi.
- Footage sampel asli untuk tes Whisper & baseline UAT: belum diterima (Drive diblokir network policy sesi cloud; jalur: upload ke `samples/`).
- Engine Whisper: faster-whisper vs whisper.cpp — diputuskan lewat uji pembanding di langkah 2.
- Model LLM lokal untuk saran kata kunci: belum dipilih; kualitas bahasa Indonesia harus diuji dulu.

## Ditunda (risiko dikerjakan vs tidak)

| Item | Kalau dikerjakan sekarang | Kalau ditunda |
|---|---|---|
| Mobile (iOS/Android) | Biaya $99/tahun (iOS), render berat di HP, risiko crash | Edit hanya di PC |
| Code signing `.exe` | ±$200+/tahun | Peringatan SmartScreen saat install ("Run anyway") |
| Mode naskah/VO (`/miva-motion`) | TTS bagus (ElevenLabs/edge-tts) butuh internet, bentrok dengan offline | Mode motion tetap lewat Claude Code |
| Teks & stiker manual + preset gaya subtitle lain | Menambah tools, UI lebih ramai | Hanya gaya subtitle MIVA |

## Risiko teknis yang sudah diketahui

- Render 4K ±4× piksel dari 1080p, jadi lebih lama. Footage sumber 1080p yang diekspor 4K = upscale, bukan tambah detail.
- Electron bukan yang paling ringan (installer ±150 MB + model Whisper ±1,5 GB + LLM lokal opsional ±5 GB). "Ringan" dikejar di startup cepat dan UI mulus.
- Potong hening otomatis bisa memotong napas/jeda berpikir, jadi tiap potongan bisa disetujui atau ditolak.
- SFX harus disinkronkan ulang setiap trim berubah (dihitung ulang dari timing, bukan disimpan sebagai waktu absolut).
- Label SFX di pustaka masih dugaan sampai diaudisi Steven.
