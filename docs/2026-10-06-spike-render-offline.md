# Spike 06/10: render offline pipeline skill dengan `tes2.mp4`

Tujuan: membuktikan pipeline `/reel-edit` (HyperFrames + FFmpeg) bisa jalan tanpa internet, dan mengukur waktunya.
Dijalankan di sesi cloud (Linux, 4 core CPU, tanpa GPU), memakai script skill asli dari repo `claude-cowork`.

## Hasil

| Tahap | Hasil | Waktu (cloud 4 core) |
|---|---|---|
| Potong + speed 1,25× + grade + bersihkan suara (`build_base.py`) | `base.mp4` 22,74 dtk dari 37,04 dtk mentah (7 potongan) | 106 dtk |
| Draf subtitle + 3 kata kunci manual (`captions.py`) | 33 kelompok subtitle | < 1 dtk |
| Komposisi HTML + SFX otomatis (`build_html.py`) | 35 cue SFX, kamera otomatis | < 1 dtk |
| `hyperframes check` | lulus, 0 error | ±30 dtk |
| Render frame 1080×1920 (`hyperframes render`, PNG sequence) | 683 frame | **580 dtk** |
| Mix suara + SFX (`mix.py`) | suara −14,1 LUFS, mix −14,0 LUFS, puncak −1,4 dBFS | ±5 dtk |
| Encode MP4 (libx264 slow, CRF 18) | 1080×1920 H.264 + AAC, 22,74 dtk | 83 dtk |

Contact sheet hasil: subtitle pill, kata kunci serif emas, gerak kamera, dan grade terlihat benar.

**Batasan spike:** Whisper tidak bisa dijalankan (model diblokir network policy), jadi potongan memakai deteksi energi dan
kata-katanya placeholder. Pustaka SFX berupa bunyi sintetis, bukan pustaka asli. Kualitas potongan dan subtitle belum dinilai.

## Temuan yang mengubah rencana

1. **Template skill bergantung internet**: Google Fonts (Inter, Playfair Display) dan GSAP dari jsDelivr.
   Sudah dibuktikan bisa diganti file lokal (`@fontsource/*` + `gsap@3.14.2` dari npm), dan `check` tetap lulus. App wajib membundel keduanya.
2. **HyperFrames punya telemetry dan cek versi online.** Bisa dimatikan: `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`.
   Chrome bisa diarahkan ke binary lokal lewat `HYPERFRAMES_BROWSER_PATH` (app akan membundel Chrome headless shell).
3. **Render frame adalah bottleneck** (±1,2 frame/dtk di 4 core CPU). Penyebab: setiap frame video di-screenshot Chrome,
   dan dedup frame statis mati karena ada video di komposisi. Rencana optimasi untuk langkah 1:
   render **hanya lapisan overlay** (subtitle, grafik) dengan latar transparan sehingga frame yang tidak berubah bisa di-dedup,
   lalu gabungkan dengan video + kamera di FFmpeg (NVENC di RTX 4060). Preview di app tetap HTML yang sama.
   Target dan angka nyata harus diukur di laptop Steven.
4. **2K (1440×2560) tidak didukung langsung** oleh `--resolution` HyperFrames (skala harus kelipatan bulat dari 1080).
   Opsi: komposisi dibuat 1440 lebar dengan skala CSS, atau render 4K lalu turunkan. Diputuskan di langkah 1.
5. HyperFrames 0.8.84 sudah punya `transcribe` (whisper.cpp; model multibahasa hanya `large-v3`), `remove-background`
   (model lokal, bisa CUDA), dan `tts` (Kokoro). Kandidat untuk fitur Remove BG offline; transkripsi tetap dibandingkan di langkah 2.
6. ±2 dtk awal `tes2.mp4` = kamera dipasang. Perlu deteksi otomatis "awal goyang" (gerak frame), bukan hanya hening.

## Lanjutan spike (06/10, sore)

**Render hanya lapisan overlay** (subtitle/grafik di latar transparan, video tidak di dalam komposisi):
683 frame dalam **94 dtk** vs 580 dtk untuk render penuh di mesin yang sama (±6× lebih cepat).
Video, grade, dan gerak kamera nantinya digabung oleh FFmpeg (NVENC di laptop Steven). Ini dipakai untuk export app.

**Uji offline sungguhan**: render dijalankan di network namespace tanpa jaringan (`unshare -n`, hanya loopback),
dengan cache font HyperFrames dikosongkan. Hasil: **lulus**, 683 frame dalam 84 dtk, font memakai file lokal yang dibundel.
Frame dibandingkan dengan render online: identik, kecuali frame yang sedang animasi blur (selisih kecil di tepi blur; huruf sama).
Catatan: tanpa network namespace, compiler HyperFrames diam-diam mengunduh font dari Google Fonts kalau ada akses internet,
jadi app harus selalu menyetel `HYPERFRAMES_FONT_CACHE_DIR` ke folder font yang dibundel dan tidak bergantung pada unduhan itu.

Akibat untuk UAT: perbandingan snapshot preview vs export butuh ambang toleransi piksel (blur tidak bit-identik).

## Verifikasi export cepat vs render penuh (06/10, malam) — proyek acuan tes2

Render acuan (skill asli, render penuh): 626 frame dalam 396 dtk.
Export cepat: lapisan overlay saja 64 dtk + gabung video & kamera di FFmpeg (`perspective`, per frame) 45 dtk.
Perbandingan frame demi frame: **median PSNR 41,3 dB, terburuk 38,7 dB, 0 frame < 30 dB** (identik secara visual;
selisih dari kompresi JPEG ekstraksi frame HyperFrames dan interpolasi).

Dua bug yang ditemukan dan diperbaiki sebelum lulus: kurung pembagi hilang di ekspresi skala (selisih sampai 183 px),
dan variabel `in` filter `perspective` mulai dari 1 (frame di sebelah potongan memakai kamera frame berikutnya).
Keduanya sekarang dikunci tes `tests/core/camera.test.ts`.

Batas: whip (blur saat masuk potongan) belum bisa di FFmpeg; proyek dengan whip memakai render penuh.
Kriteria UAT yang diusulkan: export app vs render penuh acuan, PSNR per frame ≥ 35 dB.
