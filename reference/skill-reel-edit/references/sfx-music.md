# SFX (tanpa musik latar)

## Pustaka SFX — `MIVA/reels/sfx/lib/`

Dibuat 03/10 dari 3 file kiriman Steven di `reels/sfx/` (`sfx_slice.py`): 51 potongan "Best Sound Effects",
1 riser, 7 potongan "Viral Sound Effects". File asli tidak diubah.

- `<id>.wav` — satu bunyi per file (stereo 44,1 kHz, fade 4 ms di ujung).
- `_fitur.json` — durasi, puncak, centroid, rasio bass, flatness, posisi puncak (`peak_at`, dipakai untuk menyelaraskan
  puncak whoosh/riser ke kata), jumlah onset.
- `catalog.json` — label & kategori per bunyi + `pilihan` (urutan prioritas per kategori yang dipakai otomatis).
  **Label masih dugaan dari spektrogram** (Claude tidak bisa mendengar). Koreksi: Steven buka `audisi.html`, putar,
  ubah kategori/label atau pilih `buang`, klik "Salin koreksi", tempel ke Claude → Claude memperbarui catalog.json
  (`"dikonfirmasi": true`, perbarui `pilihan`). Bunyi berkategori `buang` tidak pernah dipakai.
- File SFX baru dari Steven: taruh di `reels/sfx/`, tambahkan nama pendeknya di `SHORT` (sfx_slice.py), jalankan ulang
  `sfx_slice.py` lalu `sfx_audisi.py`, beri label di catalog.json. **Hati-hati:** menjalankan ulang memberi nomor ulang
  potongan file yang sama — label lama tetap cocok selama file sumbernya tidak berubah.

| Kategori | Dipakai untuk | Puncak (dBFS, mix.py) |
|---|---|---|
| riser | intro: puncaknya jatuh di kata kunci pertama | -15 |
| ketik | subtitle/kata kunci `type`, dipangkas sepanjang animasi ketik | -25 |
| klik | subtitle `pop` | -22 |
| tick | hitungan/angka berganti | -24 |
| whoosh | kata kunci `slam` (puncak di kata), whip, b-roll masuk, grafik tersapu | -17 |
| swish | kata kunci `blur` | -20 |
| impact | `hit: impact` (punchline) | -13 |
| boom | `hit: boom` — maks 1 per video | -11 |
| ding | notifikasi / centang / reveal kecil (manual) | -19 |
| pop | chip/kartu/stiker muncul (manual) | -20 |
| kartun, glitch, lain | hanya kalau kontennya memang bercanda/glitch — manual | -18…-20 |

Level relatif ke suara -14 LUFS. Penyesuaian per cue: `gain_db` di edit.json.sfx.

## SFX otomatis (build_html.py → cues.json)

- Subtitle `type` → ketik; `pop` → klik. Kata kunci `slam` → whoosh (+hit), `blur` → swish, `type` → ketik.
- Riser intro: puncak di kata kunci pertama ≤ 5 dtk, kalau tidak ada → di potongan pertama. `"riser": false` untuk mematikan.
- Whip (`edit.json.whip`) dan setiap insert b-roll → whoosh.
- Manual: `edit.json.sfx = [{"t": 10.45, "kat": "whoosh", "gain_db": -6}, {"t": 12.2, "id": "best-47", "align": true}]`
  (`align` = puncak bunyi jatuh di t). Untuk grafik: chip/stiker → pop; daftar centang → ding/klik.
- Kepadatan: klik/ketik dilewati kalau < 0,30 dtk dari SFX lain. Hasil tes-edit v2: ±1 SFX/0,8 dtk — batas atas;
  kalau Steven bilang terlalu ramai, turunkan dulu klik (ubah sebagian subtitle jadi tanpa bunyi), bukan whoosh kata kunci.
- Pilihan bunyi dirotasi per kategori supaya bunyi berurutan tidak identik.

## Musik latar — TIDAK DIPAKAI (aturan Steven 04/10)

Cukup SFX. `edit.json.music = {"style": "none"}` (default di transcribe.py, build_html.py, mix.py).
Aturan lama 03/10 (felt piano -34 LUFS + ducking) dicabut; kodenya masih ada di mix.py (`piano`, `bright`, `file`,
`lufs`, `duck_db`) hanya untuk kalau Steven sendiri minta musik di video tertentu. Musik untuk posting dipilih Steven
di aplikasi Instagram kalau mau.
