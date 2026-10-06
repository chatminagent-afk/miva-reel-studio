# Jebakan yang sudah pernah kena

| Gejala | Penyebab | Penanganan |
|---|---|---|
| `TypeError: open() got an unexpected keyword argument 'metadata_errors'` | faster-whisper 1.2.1 + PyAV versi baru | beri audio sebagai numpy array (transcribe.py sudah) |
| Download model Whisper "macet" | unduhan HF bertahap (medium ±1,5 GB, ±15 mnt di koneksi ini) | sudah di cache `~/.cache/huggingface`; tunggu, jangan restart |
| `silencedetect` tidak menemukan jeda | noise mobil/AC ±-20 dB rata | energi pita 250–3500 Hz + celah kata Whisper (transcribe.py) |
| Akhir kata Whisper molor 0,5–1,5 dtk ("Premiere", "dibutuhin") | Whisper menempel ke jeda | `e_ref` dipangkas ke frame terakhir di atas noise floor +5 dB; kata dipetakan pakai awal kata |
| Nama produk salah ("Gepkart", "cloud") | Whisper bahasa Indonesia | `edit.json.fix` — selalu baca transkrip untuk nama |
| Kamera goyang di awal (HP baru dipasang) | footage mentah | buang bagian itu; kalau ada suara di atasnya → `whip` di potongan itu |
| `multiple_root_compositions` | file `.html` lain di root berisi `data-composition-id` | template bernama `.tpl`, overlay `overlay.html` tanpa composition id |
| Kontras gagal di tag/chip | warna merek terang + teks putih | gelapkan latar (mis. #b8532f) |
| Teks putih tenggelam | baju putih di zona subtitle | subtitle biasa pakai pill gelap |
| Hidden `json.dump` error `float32 is not JSON serializable` | nilai numpy | `float(...)` sebelum disimpan |
| bash heredoc rusak saat isi berisi `'''` + emoji | quoting heredoc | tulis potongan panjang ke file (Write), jangan heredoc |
| Encoder MP4 HyperFrames hitamkan 8 kolom kanan (Windows) | bug 0.8.84 | render.sh merender PNG sequence + ffmpeg sendiri |
| Footage HEVC | — | aman: build_base menghasilkan H.264; HyperFrames mengekstrak frame via ffmpeg |
| ElevenLabs: "Unusual activity… Free Tier access has been disabled" (05/10, VO ke-6) | free tier ElevenLabs diblokir; pemicu umum VPN/proxy (Cloudflare WARP terpasang) | jangan coba ulang; Steven: matikan WARP / upgrade Starter, atau cadangan edge-tts suara Inggris |
| Dua render jalan bersamaan → MP4 tercampur (05/10) | menghentikan job bash di Windows tidak membunuh loop/anak prosesnya (render_all.sh, node hyperframes, chrome) | setelah menghentikan render, cek proses (`render_all|render.sh|hyperframes|tts_vo`) dan bunuh pohonnya sebelum render baru; satu proyek = satu render sekaligus |
| `Error opening input file ..\miva 1\...` di build_base (05/10) | transcribe.py menulis `src` relatif terhadap cwd, bukan folder proyek | isi `edit.json.src` dengan path absolut |
| Steven sengaja diam untuk pop-up/grafik (05/10, miva-1) | potong hening otomatis membuang waktu baca grafik | pertahankan jeda itu di `segs` (boleh dipangkas di tengah karena tertutup scrim); tutup wajah diam dengan scrim + footage blur |
