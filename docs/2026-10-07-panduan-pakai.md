# Panduan pakai MIVA Reel Studio (versi awal, 07/10)

## Pasang

1. Buka halaman **Releases** repo `chatminagent-afk/miva-reel-studio`, pilih build terbaru.
2. Unduh **semua** file: `MIVA-Reel-Studio-Setup-<versi>.exe` dan `MIVA-Reel-Studio-Setup-<versi>-1.bin`, `-2.bin`, …
   Taruh di satu folder (total ±3 GB; model Whisper dan DLL CUDA ikut di dalamnya supaya bisa offline).
3. Jalankan `.exe`. Windows akan memperingatkan (SmartScreen) karena app belum ditandatangani:
   klik **More info → Run anyway**. Pemasangan per pengguna, tidak perlu admin.
4. Setelah terpasang, app jalan penuh **offline**. Tidak ada data yang dikirim ke internet.

## Alur kerja

1. **Import**: tarik file MP4/MOV ke kotak "Drop raw footage", atau klik **Choose file**.
   Pilihan: Auto Edit (default nyala), percepat 1,25×, grade (Natural / Warm / Lift).
2. **Auto Edit** (5 langkah, bisa dibatalkan): proxy preview, transkripsi Whisper (GPU RTX 4060 kalau terdeteksi;
   kalau gagal otomatis CPU), potong hening + retake, saran kata kunci (Rules, offline), subtitle/kamera/SFX.
   Hasilnya langsung tersimpan sebagai **v1**.
3. **Review di editor**
   - Tab **Captions**: transkrip. Klik kata untuk memilih. **Delete** = buang kata dari video (dicoret), klik lagi →
     **Restore word**. Chip merah = hening yang dibuang; klik → **Keep** untuk memberi jeda (mis. untuk grafik).
   - Panel kanan saat kata dipilih: jadikan **kata kunci** (emas), animasi Slam/Blur/Type, **Hit** (Impact/Boom,
     Boom sekali per video), posisi, **ejaan** (berlaku ke semua kata yang sama, mis. "cloud" → "Claude").
   - **Timeline**: sumbu = footage mentah; bagian berarsir = terbuang (klik → **Restore**). Klik klip → tarik tepi
     putih untuk trim. **Ctrl+B** = split di playhead, lalu **Delete** untuk membuang potongan itu.
   - Tab **Audio**: pustaka SFX; **+ Add** menaruh bunyi di playhead. Klik marker di track SFX: ganti bunyi,
     volume, hapus (manual) atau **Mute** (otomatis). Marker manual bisa digeser.
   - Tab **Motion** (motion graphic gaya MIVA, offline):
     - Tempel brief di **Motion brief**, formatnya sama dengan yang biasa dikirim ke `/reel-edit`: naskah diselingi blok
       `[MOTION 01 - HOOK | 2 detik]` + deskripsi visualnya (format `[0-3s]` + `Motion:` dan `### BAGIAN` juga terbaca).
     - **Generate from brief**: tiap blok jadi motion dari 13 komponen (notifikasi, counter, split, bubble chat, HP,
       teks besar, rantai alur, logo, jendela chat + chip, end card, toggle, CTA) dan otomatis ditaruh di kata yang
       kamu ucapkan. Ringkasan menyebut jumlah blok, motion, yang perlu dicek (**Review**, oranye) dan waktu yang ditebak.
       Generate ulang mengganti motion hasil brief; motion manual atau yang diberi **Keep when regenerating** tetap.
     - **+ Add motion** menaruh komponen di playhead. **End card hold** = detik freeze frame terakhir untuk end card.
     - Klik motion (daftar atau track **Motion** di timeline) untuk mengedit di panel kanan: teks/isi, **Start/End**,
       **Scene** (latar digelapkan + footage blur), **Silent** (tanpa SFX). Di timeline: geser blok, tarik tepinya.
       Motion menempel ke kata, jadi ikut bergeser kalau kamu memotong kalimat sebelumnya.
   - Panel kanan tanpa pilihan: kamera otomatis (on/off + kekuatan), kecepatan, grade, info audio.
   - **Spasi** = play/pause, **Ctrl+Z / Ctrl+Shift+Z** = undo/redo, **Ctrl+S** = simpan.
   - Semua tersimpan otomatis. **Save vN** menyimpan versi; pilihan versi di header membuka versi lama
     (keadaan sekarang disimpan dulu sebagai versi baru, jadi tidak ada yang hilang).
4. **Export**: nama file, folder (Browse, bisa jadi default), 1080p/2K/4K, 30/60 fps, H.264/HEVC, kualitas,
   **Cover JPG** (judul: `kecil|*BESAR*|kecil`), **salinan WhatsApp**, buka folder setelah selesai.
   Encode memakai NVENC (GPU) kalau tersedia; kalau GPU gagal di tengah export, otomatis diulang dengan CPU.

## Settings

Folder proyek, **kamus koreksi** (salah dengar Whisper, satu per baris `salah => benar`), nama/merek yang
diprioritaskan jadi kata kunci, transkripsi GPU/CPU, dan diagnostik (versi Whisper + GPU yang terdeteksi).

## Belum ada di versi ini

B-roll/gambar di track Overlay, teks bebas/judul, fitur Pro (transform +
keyframe, Remove BG, stabilize, audio pro), saran kata kunci Local LLM/Claude, kirim WA via Kirimi, editor cover
visual, deteksi awal kamera goyang. SFX masih pustaka **sintetis** sampai pustaka aslimu ditaruh di
`resources/sfx/` repo (lihat README di sana).

## Checklist UAT manual (laptop Steven)

Tandai Lulus/Gagal. Kalau gagal: kirim nomor + langkah + screenshot.

| # | Langkah | Lulus? |
|---|---|---|
| 1 | Pasang dari Release, buka app dengan Wi-Fi **mati** | |
| 2 | Settings → diagnostik menyebut **1 NVIDIA GPU** | |
| 3 | Import `tes2.mp4` lewat drag & drop | |
| 4 | Auto Edit selesai; banner menyebut transkripsi **tidak** di CPU (artinya GPU dipakai) | |
| 5 | Transkrip benar (bandingkan dengan `bench/2026-10-06-whisper/reference.txt`), "Claude" dan "nonton" terkoreksi kamus | |
| 6 | Potongan masuk akal (hening awal kamera dipasang terbuang, tidak ada kata terpotong) | |
| 7 | Coret kata, undo, redo; simpan jeda; jadikan kata kunci + Boom | |
| 8 | Preview: subtitle, kata kunci, kamera, SFX sinkron dengan suara | |
| 9 | Tambah whoosh manual, geser, hapus; mute satu SFX otomatis | |
| 10 | Save v2, buka v1, kembali ke versi terakhir: semua editan ada | |
| 11 | Tutup paksa app (Task Manager) saat mengedit, buka lagi dari Recent: editan pulih | |
| 12 | Export 1080p 30 fps H.264 + cover + salinan WA; catat waktu export | |
| 13 | Export 4K 60 fps HEVC; putar di HP | |
| 14 | Cancel export di tengah: tidak ada file setengah jadi | |
| 15 | Rasa: gaya subtitle, kata kunci, kamera, SFX dibanding render skill (`tes2-acuan.mp4`) | |
| 16 | Proyek `3.MP4`: tab Motion, tempel brief miva-3, Generate; bandingkan hasil export dengan `miva_3-v1.mp4` (skill) | |
| 17 | Edit satu motion (teks + geser di timeline), export ulang | |
