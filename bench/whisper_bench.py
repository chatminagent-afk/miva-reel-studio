"""Benchmark transkripsi Whisper: faster-whisper (CPU/CUDA) dan whisper.cpp.
Pakai: python whisper_bench.py <fw|cpp> <model> <device>
Pengaturan sama dengan skill reel-edit: language=id, word timestamps, beam_size=5, vad_filter=False.
Output: 2026-10-06-whisper/<engine>-<model>-<device>.json (+ .notes.json)
"""
import json, os, subprocess, sys, threading, time, traceback
from pathlib import Path

HERE = Path(__file__).parent

try:  # DLL cuBLAS/cuDNN dari paket pip nvidia-*-cu12 (Windows)
    import nvidia
    for base in nvidia.__path__:
        for b in Path(base).glob("*/bin"):
            os.add_dll_directory(str(b))
            os.environ["PATH"] = str(b) + os.pathsep + os.environ["PATH"]
except ImportError:
    pass
WAV = HERE / "_work" / "tes2.wav"
OUT = HERE / "2026-10-06-whisper"
CPP_DIR = HERE / "whispercpp"


class VramPoller(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.peak = 0
        self.base = self.read()
        self.stop = False

    @staticmethod
    def read():
        try:
            o = subprocess.check_output(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], text=True)
            return int(o.strip().splitlines()[0])
        except Exception:
            return 0

    def run(self):
        while not self.stop:
            self.peak = max(self.peak, self.read())
            time.sleep(0.2)


def audio_dur():
    o = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(WAV)], text=True)
    return float(o.strip())


def run_fw(model, device):
    from faster_whisper import WhisperModel
    name = {"medium": "medium", "large-v3-turbo": "large-v3-turbo"}[model]
    compute = "int8" if device == "cpu" else "float16"
    t0 = time.time()
    m = WhisperModel(name, device=device, compute_type=compute)
    load = time.time() - t0
    import wave, numpy as np
    with wave.open(str(WAV)) as wf:  # decode sendiri: PyAV lokal tidak cocok dgn faster-whisper (metadata_errors)
        audio = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    t0 = time.time()
    segs, _ = m.transcribe(audio, language="id", word_timestamps=True, beam_size=5, vad_filter=False)
    words = []
    for s in segs:
        for w in s.words:
            words.append({"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)})
    return words, load, time.time() - t0


def run_cpp(model, device):
    exe = next(CPP_DIR.rglob("whisper-cli.exe"))
    mdl = CPP_DIR / f"ggml-{model}.bin"
    prefix = OUT / f"_cpp-{model}-{device}"
    cmd = [str(exe), "-m", str(mdl), "-f", str(WAV), "-l", "id", "-ml", "1", "-sow", "-ojf", "-bs", "5", "-of", str(prefix)]
    if device == "cpu":
        cmd.append("-ng")
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    total = time.time() - t0
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-1500:])
    (OUT / f"_cpp-{model}-{device}.log").write_text(r.stderr, encoding="utf-8")
    load = total_ms = None
    for line in r.stderr.splitlines():
        if "load time" in line:
            load = float(line.split("=")[1].split("ms")[0]) / 1000
        if "total time" in line:
            total_ms = float(line.split("=")[1].split("ms")[0]) / 1000
    data = json.loads(Path(str(prefix) + ".json").read_text(encoding="utf-8"))
    words = []
    for t in data["transcription"]:
        txt = t["text"].strip()
        if not txt or (txt.startswith("[_") and txt.endswith("]")):
            continue
        toks = t.get("tokens", [])
        p = round(sum(x["p"] for x in toks) / len(toks), 3) if toks else None
        words.append({"w": txt, "s": t["offsets"]["from"] / 1000, "e": t["offsets"]["to"] / 1000, "p": p})
    load = load or 0
    return words, load, (total_ms - load if total_ms else total - load)


def main():
    engine, model, device = sys.argv[1:4]
    tag = f"{'fw' if engine == 'fw' else 'cpp'}-{model}-{device}"
    OUT.mkdir(exist_ok=True)
    dur = audio_dur()
    notes = {"engine": engine, "model": model, "device": device, "audio_s": round(dur, 2), "error": None}
    poll = VramPoller()
    poll.start()
    try:
        words, load, tr = (run_fw if engine == "fw" else run_cpp)(model, device)
        notes.update(load_s=round(load, 2), transcribe_s=round(tr, 2), rtf=round(tr / dur, 3), words=len(words))
        (OUT / f"{tag}.json").write_text(json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")
    except Exception:
        notes["error"] = traceback.format_exc()[-1500:]
    poll.stop = True
    time.sleep(0.3)
    notes["vram_peak_mb"] = max(poll.peak - poll.base, 0) if device != "cpu" else None
    (OUT / f"{tag}.notes.json").write_text(json.dumps(notes, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(notes, ensure_ascii=False))


if __name__ == "__main__":
    main()
