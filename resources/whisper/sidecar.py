"""Sidecar transkripsi app: faster-whisper sebagai proses terpisah, protokol JSON per baris di stdout.

    python -I -u sidecar.py --site <site-packages> --model <folder model CT2> --audio <wav 16 kHz mono> --out <words-raw.json>
                            [--device auto|cuda|cpu] [--language id] [--beam-size 5] [--initial-prompt T] [--hotwords T]
    python -I -u sidecar.py --site <site-packages> --check

Setelan transkripsi sama dengan skill /reel-edit `transcribe.py` (language=id, word_timestamps, vad_filter=False, beam 5),
dan words-raw.json ditulis dengan format yang sama (w/s/e/p, pembulatan, indent=0), jadi proyek tetap kompatibel skill.
Bedanya: model large-v3-turbo, CUDA float16 (benchmark 06/10), fallback CPU int8.

Event (satu objek JSON per baris):
  {"type":"start", ...versi}         {"type":"trying","device"}  (sebelum mencoba memuat di device itu)
  {"type":"loaded","device","compute_type","load_s","fallback"}
  {"type":"progress","t","duration"} {"type":"done","words","out","transcribe_s","duration","seg_starts"}
  {"type":"check", ...}              {"type":"error","code","message"}   code: model_missing | audio | cuda | internal
Kalau DLL CUDA rusak, proses bisa mati tanpa exception; runner (src/core/whisper.ts) lalu mengulang dengan --device cpu.
"""
import argparse
import json
import os
import socket
import sys
import time
import traceback
import wave
from pathlib import Path

# offline: HF Hub tidak boleh dihubungi (model selalu dari folder lokal)
os.environ.update({"HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "TRANSFORMERS_OFFLINE": "1", "DO_NOT_TRACK": "1"})

WHISPER_KW = {"language": "id", "word_timestamps": True, "vad_filter": False, "beam_size": 5}
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


def emit(**ev):
    sys.stdout.write(json.dumps(ev, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def guard_network():
    """Penjaga offline: koneksi ke luar loopback ditolak dan dicatat di stderr (sama dengan offline-guard.mjs)."""
    original = socket.socket.connect

    def connect(self, address):
        host = address[0] if isinstance(address, tuple) else None
        if host is None or host in LOOPBACK or str(host).startswith("127."):
            return original(self, address)
        sys.stderr.write(f"[offline-guard] blocked {host}:{address[1]}\n")
        sys.stderr.flush()
        raise ConnectionRefusedError(f"offline: koneksi ke {host} diblokir")

    socket.socket.connect = connect


def add_cuda_dll_dirs(site):
    """DLL cuBLAS/cuDNN dari wheel nvidia-* (Windows) harus terlihat oleh ctranslate2.dll."""
    if os.name != "nt":
        return
    for bin_dir in sorted((Path(site) / "nvidia").glob("*/bin")):
        os.add_dll_directory(str(bin_dir))
        os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")


def load_audio(path):
    """Sama dengan load16k() skill: WAV int16 16 kHz mono -> float32 / 32768."""
    import numpy as np

    try:
        with wave.open(str(path)) as w:
            if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise Fail("audio", f"audio harus WAV 16 kHz mono 16-bit: {path}")
            return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    except (OSError, wave.Error, EOFError) as e:
        raise Fail("audio", f"audio tidak bisa dibaca: {e}") from e


def load_model(model_dir, device):
    """device auto: CUDA float16 kalau ada GPU dan DLL CUDA benar-benar jalan (dites dengan transkripsi 1 dtk hening),
    kalau gagal CPU int8. Kembalikan (model, device, compute_type, alasan_fallback)."""
    import ctranslate2
    import numpy as np
    from faster_whisper import WhisperModel

    if not (Path(model_dir) / "model.bin").exists():
        raise Fail("model_missing", f"model Whisper tidak ditemukan di {model_dir}")
    fallback = None
    if device in ("auto", "cuda"):
        emit(type="trying", device="cuda")
        try:
            if ctranslate2.get_cuda_device_count() < 1:
                raise RuntimeError("tidak ada GPU CUDA")
            m = WhisperModel(str(model_dir), device="cuda", compute_type="float16", local_files_only=True)
            segs, _ = m.transcribe(np.zeros(16000, dtype=np.float32), **WHISPER_KW)
            list(segs)  # paksa encoder jalan: DLL cuDNN/cuBLAS baru dimuat di sini
            return m, "cuda", "float16", None
        except Exception as e:  # noqa: BLE001 - semua kegagalan CUDA berujung fallback
            if device == "cuda":
                raise Fail("cuda", f"CUDA gagal: {e}") from e
            fallback = f"CUDA tidak dipakai: {e}"
    emit(type="trying", device="cpu")
    m = WhisperModel(str(model_dir), device="cpu", compute_type="int8", local_files_only=True)
    return m, "cpu", "int8", fallback


def check():
    import inspect

    import ctranslate2
    import faster_whisper
    from faster_whisper import WhisperModel

    used = {"init": ["device", "compute_type", "local_files_only"], "transcribe": [*WHISPER_KW, "initial_prompt", "hotwords"]}
    params = {
        "init": inspect.signature(WhisperModel.__init__).parameters,
        "transcribe": inspect.signature(WhisperModel.transcribe).parameters,
    }
    missing = [f"{fn}.{p}" for fn, ps in used.items() for p in ps if p not in params[fn]]
    emit(type="check", python=sys.version.split()[0], faster_whisper=faster_whisper.__version__,
         ctranslate2=ctranslate2.__version__, cuda_devices=ctranslate2.get_cuda_device_count(), missing_params=missing)
    return 0 if not missing else 1


def transcribe(a):
    import faster_whisper

    emit(type="start", python=sys.version.split()[0], faster_whisper=getattr(faster_whisper, "__version__", "?"))
    audio = load_audio(a.audio)
    t0 = time.time()
    model, device, compute_type, fallback = load_model(a.model, a.device)
    emit(type="loaded", device=device, compute_type=compute_type, load_s=round(time.time() - t0, 2), fallback=fallback)

    kw = dict(WHISPER_KW, language=a.language, beam_size=a.beam_size)
    if a.initial_prompt:
        kw["initial_prompt"] = a.initial_prompt
    if a.hotwords:
        kw["hotwords"] = a.hotwords
    t0 = time.time()
    segs, info = model.transcribe(audio, **kw)
    duration = len(audio) / 16000
    words = []
    seg_starts = []  # kata pertama tiap segmen Whisper = awal kalimat (Whisper memberi huruf besar walau tanpa titik)
    for s in segs:
        if s.words:
            seg_starts.append(len(words))
        words += [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 2)} for w in s.words]
        emit(type="progress", t=round(s.end, 3), duration=round(duration, 3))
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=0)  # format sama dengan transcribe.py skill
    os.replace(tmp, out)
    emit(type="done", words=len(words), out=str(out), transcribe_s=round(time.time() - t0, 2), duration=round(duration, 3),
         seg_starts=seg_starts)
    return 0


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--site", required=True)
    p.add_argument("--check", action="store_true")
    p.add_argument("--model")
    p.add_argument("--audio")
    p.add_argument("--out")
    p.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    p.add_argument("--language", default=WHISPER_KW["language"])
    p.add_argument("--beam-size", type=int, default=WHISPER_KW["beam_size"])
    p.add_argument("--initial-prompt")
    p.add_argument("--hotwords")
    a = p.parse_args()
    if not a.check and not (a.model and a.audio and a.out):
        p.error("--model, --audio, dan --out wajib (kecuali --check)")
    guard_network()
    sys.path.insert(0, a.site)
    add_cuda_dll_dirs(a.site)
    try:
        return check() if a.check else transcribe(a)
    except Fail as e:
        emit(type="error", code=e.code, message=str(e))
    except Exception as e:  # noqa: BLE001
        emit(type="error", code="internal", message=f"{type(e).__name__}: {e}")
        traceback.print_exc()
    return 1


if __name__ == "__main__":
    sys.exit(main())
