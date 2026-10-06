# Proyek acuan kualitas: tes2.mp4 (06/10)

Dibuat dengan pipeline skill `/reel-edit` asli: transkrip faster-whisper large-v3-turbo dari benchmark laptop Steven,
potong hening `transcribe.py`, base `build_base.py`, kurasi kata kunci dan grafik (overlay.*) manual setara skill,
SFX otomatis `build_html.py`. Footage tidak di-commit (`samples/tes2.mp4`, lihat DECISIONS soal Git LFS).

Dipakai untuk UAT: hasil Auto Edit app dibandingkan dengan potongan, timing, dan kata kunci di sini.
Catatan: `cues.json` memakai id pustaka SFX sintetis (pustaka asli Steven belum ada di repo).
