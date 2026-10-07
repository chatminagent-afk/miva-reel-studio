"""faster_whisper palsu untuk tes sidecar (tanpa model). Perilaku diatur lewat file JSON di env FAKE_FW_SPEC:
  words: [{w,s,e,p}]           kata hasil (satu segmen, sama dengan fake di tests/parity/gen_golden.py)
  segments: [[{w,s,e,p}], ...] alternatif: beberapa segmen (progress per segmen)
  cuda: ok | load_error | warmup_error | crash   perilaku saat device="cuda"
  delay: detik per segmen (untuk tes batal)
  network: true -> mencoba koneksi ke internet saat transkripsi (tes penjaga offline)
  record: path file; setiap pemanggilan dicatat (JSON per baris)
"""
import json
import os
import socket
import time

__version__ = "1.2.1-fake"
SPEC = json.load(open(os.environ["FAKE_FW_SPEC"], encoding="utf-8"))


def _record(**ev):
    if SPEC.get("record"):
        with open(SPEC["record"], "a", encoding="utf-8") as f:
            f.write(json.dumps(ev) + "\n")


class _Word:
    def __init__(self, d):
        # faster-whisper asli selalu memberi float (spec dari JSON bisa berisi 6 untuk 6.0)
        self.word, self.start, self.end, self.probability = " " + d["w"], float(d["s"]), float(d["e"]), float(d.get("p", 0.9))


class _Seg:
    def __init__(self, ws):
        self.words = [_Word(d) for d in ws]
        self.start, self.end = float(ws[0]["s"]), float(ws[-1]["e"])
        self.text = " " + " ".join(d["w"] for d in ws)


class _Info:
    def __init__(self, duration):
        self.duration = duration
        self.language = "id"


class WhisperModel:
    def __init__(self, model_size_or_path, device="auto", device_index=0, compute_type="default", cpu_threads=0,
                 num_workers=1, download_root=None, local_files_only=False, files=None, revision=None, use_auth_token=None):
        _record(call="init", model=model_size_or_path, device=device, compute_type=compute_type, local_files_only=local_files_only)
        self.device = device
        if device == "cuda" and SPEC.get("cuda") == "load_error":
            raise RuntimeError("CUDA failed with error no CUDA-capable device is detected")

    def transcribe(self, audio, language=None, task="transcribe", beam_size=5, word_timestamps=False, vad_filter=False,
                   initial_prompt=None, hotwords=None, **kw):
        warmup = len(audio) == 16000 and not audio.any()
        _record(call="transcribe", device=self.device, warmup=bool(warmup), n=int(len(audio)), language=language,
                beam_size=beam_size, word_timestamps=word_timestamps, vad_filter=vad_filter,
                initial_prompt=initial_prompt, hotwords=hotwords, dtype=str(audio.dtype),
                head=[float(x) for x in audio[:4]], extra=sorted(kw))
        if self.device == "cuda" and warmup:
            if SPEC.get("cuda") == "warmup_error":
                raise RuntimeError("Library cudnn_ops64_9.dll is not found or cannot be loaded")
            if SPEC.get("cuda") == "crash":
                os._exit(3)  # DLL CUDA rusak: proses mati tanpa exception Python
        if warmup:
            return iter([]), _Info(1.0)
        if SPEC.get("network"):
            try:
                socket.create_connection(("203.0.113.7", 80), timeout=2)
            except OSError:
                pass
        segments = SPEC.get("segments") or [SPEC["words"]]

        def gen():
            for ws in segments:
                time.sleep(SPEC.get("delay", 0))
                yield _Seg(ws)

        return gen(), _Info(len(audio) / 16000)
