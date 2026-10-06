# Gaya subtitle dua lapis

Sumber: video referensi Steven (`D:\Download\refrensi.mp4`, 03/10, reel finansial ±60 dtk, talking-head + cutaway).

## Yang ditiru dari referensi

| Lapisan | Referensi | Implementasi (template.tpl) |
|---|---|---|
| Kalimat biasa | sans putih kecil, huruf kecil, sepertiga bawah, tanpa outline tebal | Inter 600 52px putih di **pill gelap** `rgba(12,12,14,.58)` (footage Steven sering berbaju putih → teks putih polos hilang) |
| Kata kunci | serif italic besar warna emas, dekat badan, bukan di bawah | Playfair Display italic 800, 168px (128px kalau > 9 huruf), `--key: #ffd65a`, stroke tipis gelap + bayangan |
| Penghubung | kata kecil menumpuk di atas/bawah kata kunci ("tapi / **15 Juta** / orang") | `.kl.small` Inter 700 italic 46px: kata sebelum kata besar = baris di atas (geser kiri), sesudahnya = di bawah (geser kanan) |
| Masuk | kata kunci blur-in / pop; teks biasa muncul cepat | `slam` (skala 1,45→1 + blur, 0,24 dtk), `blur` (blur 18px→0, 0,42 dtk), `type` (per huruf 28 cps) |
| Ritme | kata kunci tiap ±3–6 dtk; saat kata kunci tampil, subtitle biasa tidak tampil | 5–8 kata kunci per 30 dtk; satu entri captions.json = biasa ATAU kunci |

Hal lain dari referensi yang dipakai skill: hook langsung kata kunci besar di detik awal (riser + slam),
kartu logo di atas kepala saat nama produk disebut, cutaway b-roll/rekaman layar layar penuh, end card.

## Memilih kata kunci

- **Ya:** nama produk/merek, angka, kata yang jadi inti klaim, kata yang ditekankan nada bicara, punchline penutup.
- **Tidak:** kata sambung, kata yang sudah tampil sebagai grafik di detik yang sama tanpa nilai tambah, kata yang diulang
  (sebut sekali sebagai kunci, kemunculan kedua jadi subtitle biasa).
- Kata kunci pertama sebaiknya ≤ 5 dtk (riser jatuh di sana). Kalau pembuka cuma basa-basi, kata kunci pertama = kata
  pertama yang bermakna di kalimat hook.
- `hit`: `boom` untuk SATU momen terbesar (reveal), `impact` untuk punchline penutup. Sisanya tanpa hit.
- Variasikan `anim`: slam untuk kata pendek yang menghentak, blur untuk kata yang "terungkap"/lebih lembut, type jarang.

## Format captions.json

```json
{"chunks": [
  {"w": [0, 1], "anim": "type"},
  {"w": [5, 6, 7, 8], "big": [5], "anim": "slam"},
  {"w": [27, 28, 29], "big": [29], "anim": "slam", "hit": "boom"},
  {"w": [14, 15, 16], "big": [15, 16], "anim": "blur", "pos": "c"}
]}
```

- `w` = indeks kata di timing.json, harus berurutan dan mencakup semua kata (build_html menolak kalau tidak).
- Kata `-xxx` dari Whisper ("aplikasi -aplikasi") otomatis digabung jadi "aplikasi-aplikasi".
- Tanda koma/titik di akhir kata dibuang; `?` dipertahankan.
- Subtitle biasa: maks ±3 kata / 18 huruf per kemunculan (captions.py sudah memecah begitu).
- `type` hanya kalau ada waktu: panjang teks / 28 + 0,3 dtk ≤ jarak ke subtitle berikutnya.

## Posisi & keterbacaan

- `--cap-y: 1300px` = pusat zona subtitle; zona kata kunci 1010–1530. Cek snapshot saat zoom: wajah membesar ke bawah.
- Kalau latar di zona itu terang DAN kata kunci emas tenggelam, ganti `--key` di overlay.css (mis. `#ffcf3f` lebih pekat)
  — jangan menebalkan stroke (serif jadi kasar).
- Teks tidak boleh masuk zona UI Reels: bawah > 1560 px, kanan > 950 px di 1100–1700.
