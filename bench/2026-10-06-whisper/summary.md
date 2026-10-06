# Benchmark Whisper 2026-10-06

Input: tes2.mp4, audio 37,04 dtk (WAV 16 kHz mono). Setelan: language=id, word timestamps, beam_size=5, vad_filter=False. GPU: RTX 4060 Laptop 8 GB.

| Engine | Model | Device | Load (dtk) | Transkripsi (dtk) | RTF | Kata | VRAM puncak (MB) | Error |
|---|---|---|---|---|---|---|---|---|
| whisper.cpp b5130 (cuBLAS 12.4) | large-v3-turbo | cpu | 1.18 | 29.99 | 0.81 | 71 | - | - |
| whisper.cpp b5130 (cuBLAS 12.4) | large-v3-turbo | cuda | 1.4 | 1.08 | 0.029 | 71 | 1983 | - |
| whisper.cpp b5130 (cuBLAS 12.4) | medium | cpu | 1.25 | 30.36 | 0.82 | 68 | - | - |
| whisper.cpp b5130 (cuBLAS 12.4) | medium | cuda | 1.36 | 1.98 | 0.053 | 68 | 2255 | - |
| faster-whisper | large-v3-turbo | cuda | 88.73 | 3.12 | 0.084 | 72 | 2230 | - |
| faster-whisper | medium | cpu | 6.31 | 25.34 | 0.684 | 72 | - | - |
| faster-whisper | medium | cuda | 5.52 | 6.66 | 0.18 | 74 | 2223 | - |

Catatan:
- Load fw large-v3-turbo 88,7 dtk = run pertama (model belum di cache, ikut diunduh); run berikutnya jauh lebih cepat.
- VRAM puncak = selisih nvidia-smi terhadap kondisi sebelum model dimuat, polling 0,2 dtk.
- CUDA faster-whisper butuh `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` (sekali) + DLL dir ditambahkan di skrip. Audio di-decode sendiri (wave+numpy) karena PyAV lokal tidak cocok dengan faster-whisper 1.2.1 (`metadata_errors`).
- whisper.cpp CUDA aktif (log: ggml_cuda_init); varian CPU dijalankan dengan `-ng`. Waktu cpp diambil dari timing internal whisper.cpp. Timestamp `-ml 1` whisper.cpp kasar: 'Halo' 0-2,0 dtk, 'guys' 2,0-5,6 dtk; cpp medium bahkan menghilangkan 'Hello guys' di awal.
- Nilai `p` whisper.cpp = rata-rata probabilitas token, bukan probabilitas kata faster-whisper; tidak setara langsung.

## Perbedaan teks (belum ada reference, penilaian sementara)

- fw medium cpu/cuda: salah 'Gepkart'/'Gap Card' (seharusnya CapCut), 'nggak berung'/'perlu' bervariasi.
- fw large-v3-turbo: 'CapCut' benar, 'gak perlu' benar, salah 'donton' (nonton).
- cpp turbo: 'CapCut' benar tapi 'gak baru ngedit' (salah), 'donton'.

## Kombinasi terbaik sementara: faster-whisper large-v3-turbo CUDA float16

Alasan: teks paling dekat ke ucapan (CapCut, perlu, Halo guys), RTF 0,084, VRAM ±2,2 GB. whisper.cpp turbo lebih cepat (RTF 0,029) tapi ada salah kata dan timestamp kasar. Akurasi pasti menunggu reference.txt hasil koreksi Steven.

Transkrip:

Halo guys Biasanya kita kalau ngedit pake apa tuh CapCut, ngedit video kan CapCut, pake Adobe Premiere Terus pake aplikasi -aplikasi editing yang lain Kali ini aku mau coba cloud buat Edit video yang kalian lagi donton ini Katanya sih bisa bagus ya Dia bisa kasih subtitle Terus bisa kasih motion motion Grafik kalau dibutuhin Kita lihat kayak apa hasilnya Keren gak menurut kalian? Atau kita udah gak perlu ngedit lagi sekarang?
