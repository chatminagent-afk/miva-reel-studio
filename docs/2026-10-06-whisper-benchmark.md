# Keputusan engine transkripsi (langkah 2) — 06/10

Data: `bench/2026-10-06-whisper/` (dijalankan Claude Code lokal di laptop Steven, RTX 4060 Laptop 8 GB, `tes2.mp4` 37,04 dtk).
Referensi teks dikoreksi Steven 06/10 (`reference.txt`). WER dihitung setelah normalisasi ejaan (pake=pakai, gak=nggak, tanda hubung).

| Engine | Model | Device | WER | Celah ≥ 0,22 dtk | Awal kata di suara | RTF | VRAM |
|---|---|---|---|---|---|---|---|
| **faster-whisper** | **large-v3-turbo** | **CUDA fp16** | **2,8%** | **7** | 92% | **0,084** | 2,2 GB |
| faster-whisper | medium | CUDA | 8,3% | 8 | 97% | 0,18 | 2,2 GB |
| faster-whisper | medium | CPU int8 | 9,7% | 7 | 97% | 0,68 | - |
| whisper.cpp | large-v3-turbo | CUDA | 4,2% | 1 | 85% | 0,029 | 2,0 GB |
| whisper.cpp | medium | CUDA | 8,3% | 0 | 81% | 0,053 | 2,3 GB |
| whisper.cpp | medium | CPU | 55,6% | - | - | 0,82 | - |

"Celah ≥ 0,22 dtk" = jumlah jeda antar-kata yang dilaporkan engine; potong hening otomatis bergantung pada ini.
"Awal kata di suara" = persentase kata yang awalnya jatuh di frame bersuara (energi pita 250–3500 Hz).

## Keputusan

**faster-whisper large-v3-turbo, CUDA float16** (fallback CPU int8 kalau GPU tidak ada).

- Teks paling akurat (2,8%; dua salah tersisa "cloud"→Claude dan "donton"→nonton, ditangani kamus koreksi).
- Satu-satunya kombinasi yang akurat DAN memberi celah antar-kata yang dipakai potong hening.
- whisper.cpp gugur: timestamp per kata menempel tanpa celah (`-ml 1`), jadi potong hening tidak bisa jalan; medium juga menghilangkan "Halo guys".
- Waktu nyata: 3,1 dtk untuk 37 dtk audio (setelah model dimuat).

## Akibat untuk packaging (offline)

App membundel runtime Python + faster-whisper + CTranslate2 + DLL CUDA (cuBLAS, cuDNN) sebagai proses terpisah, ditambah model
large-v3-turbo (±1,6 GB). Perkiraan total installer ±3 GB. Pilihan yang perlu diputuskan saat langkah 9: satu installer besar,
atau installer app + paket model terpisah (keduanya tetap offline setelah terpasang).

## Catatan lain

- CPU fallback large-v3-turbo belum diukur (yang diukur medium CPU, RTF 0,68). Ukur saat UAT.
- `p` whisper.cpp bukan probabilitas kata, tidak dibandingkan.
- PyAV lokal tidak cocok dengan faster-whisper 1.2.1 (`metadata_errors`), sama dengan gotcha skill: audio diberikan sebagai array.
