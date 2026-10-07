# MIVA Reel Studio

Desktop app lokal (Windows) untuk mengubah footage talking-head mentah jadi Reels 9:16 siap posting:
potong hening dan salah ucap, subtitle dua lapis, SFX otomatis, kamera zoom/pan, lalu export 1080p/2K/4K. Jalan penuh offline.

Status: **fase 1, langkah 1 (fondasi)** — lihat [`docs/2026-10-06-plan-fase-1.md`](docs/2026-10-06-plan-fase-1.md).

## Menjalankan dari kode

```bash
npm ci                    # juga menyiapkan resources/render (font + GSAP lokal)
npm run fetch-resources   # Chrome headless, FFmpeg (Windows), Python + paket Whisper, model Whisper; semua dicek sha256
                          # (model butuh akses huggingface.co; di sesi cloud: npm run fetch-resources -- --skip whisper-model)
npm test                  # unit + paritas skill + integrasi export (render sungguhan)
npm run e2e               # app Electron: export, batal, tutup saat export (butuh xvfb di Linux)
npm run test:offline      # integrasi export + sidecar Whisper di network namespace tanpa internet (Linux, root)
npm run dev               # jalankan app
```

- Keputusan, lingkup, dan pertanyaan terbuka: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Sampel footage untuk tes: taruh di `samples/` (versi terkompresi, maks 25 MB per file lewat upload web GitHub)
