# Changelog — feedback Steven → aturan

| Tanggal | Feedback / keputusan | Aturan / perubahan |
|---|---|---|
| 2026-10-03 | v1 "tes edit" (subtitle lime tebal, SFX sintetis) dikirim; Steven minta dijadikan skill + perbaikan dari video referensi | skill dibuat |
| 2026-10-03 | Subtitle hal yang perlu di-highlight: font, ukuran, warna beda | subtitle dua lapis: biasa = Inter di pill; kunci = Playfair italic emas besar + penghubung kecil bertumpuk |
| 2026-10-03 | SFX di subtitle mengikuti animasinya (ketik → ketik, langsung → klik) | SFX otomatis di build_html.py |
| 2026-10-03 | Pakai 3 SFX kiriman; riser untuk intro; 2 kompilasi secukupnya | pustaka `reels/sfx/lib` + catalog + audisi; riser puncak di kata kunci pertama; boom maks 1 |
| 2026-10-03 | Musik latar boleh, tapi kecil, suara jangan sampai tidak kedengaran | default felt piano -34 LUFS + duck 8 dB; mix gagal bila selisih < 16 LU |
| 2026-10-03 | WA hanya dikirim kalau diminta (v2 akhirnya diminta dikirim sebelum PC dimatikan) | WA hanya kalau diminta |
| 2026-10-04 | Jangan pakai background music, cukup SFX | musik default `none` di semua script; aturan 03/10 "musik kecil" dicabut |
| 2026-10-05 | Naskah talking-head+motion minta dibuat full motion graphic lewat /reel-edit, "voice over yang bagus"; pilih ElevenLabs (edge-tts ditolak 29/09) | mode motion: `tts_vo.py`, `template/motion.tpl`, `marks.json`/`D.lines` di build_html, SFX manual boleh `dur` |
| 2026-10-05 | VO pria (ElevenLabs Jonathan Wiratama) tidak disukai: "pakai yang wanita dan natural, berikan opsi" | default VO wanita natural; sampel 3–4 suara dulu sebelum VO penuh; mode `--audio` untuk VO dari connector |
| 2026-10-05 | Semua VO ElevenLabs wanita (Indonesia & Inggris) "tetap jelek"/beraksen; pilih edge-tts Ava (Inggris), subtitle tetap Indonesia | default VO = Ava Inggris + mode `terjemahan` (subtitle Indonesia disebar per kalimat); Whisper tanpa initial_prompt |
| 2026-10-05 | miva-1 v1: zoom/pan kamera tidak terlihat; "perbesar zoom in, out, panning, kalau tidak terlihat tidak berguna" | kamera auto baru: ketukan 2,6 dtk, siklus zoom in/pan/zoom out (1,00–1,14, pan ±50 px), punch-in di `#aroll`, `camera_kuat`; v1 tidak dirender ulang |
| 2026-10-05 | Tiap video wajib 1 cover JPG, judul di tengah atas talking-head | `scripts/cover.py` + langkah 9 SKILL.md |
| 2026-10-06 | Reels harus fast paced: raw dipercepat 1,25x, jeda tanpa VO seminim mungkin kecuali butuh motion graphic | `build_base.py` speed 1,25 (timing.json sudah waktu pasca-speed); `GAP_CUT` 0,40→0,22, padding 0,10/0,14→0,06/0,08; `BEAT` kamera 2,6→1,8; `lead` VO 0,3→0,15; aturan VO +20% & gap ≤ 0,1 di SKILL.md. Belum diuji di video nyata |
