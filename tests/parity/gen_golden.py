"""Buat golden output dari script ASLI skill reel-edit (reference/skill-reel-edit) untuk tes paritas port TypeScript.

    python3 tests/parity/gen_golden.py            # semua kasus di tests/fixtures/cases/*/input.json

Per kasus:
  1. audio sintetis deterministik (seed tetap) -> audio.wav   (dibuat sekali, lalu di-commit)
  2. transcribe.py dengan faster_whisper palsu (kata dari input.json) -> words-raw.json, edit.json
  3. edit.json ditimpa override kasus (fix, speed, grade, whip, ...) seperti edit manual
  4. build_base.py dengan subprocess.run palsu (perintah ffmpeg direkam, tidak dijalankan) -> timing.json + ffmpeg_cmds.json
  5. captions.py -> captions_draft.json, lalu kurasi kasus (kata kunci) -> captions.json
  6. build_html.py dengan pustaka SFX fixture -> cues.json + data.json (isi __DATA__ di index.html)
Hasil disalin ke tests/fixtures/cases/<kasus>/golden/. Tes TypeScript membandingkan port dengan file-file ini.
"""
import json, runpy, shutil, subprocess, sys, tempfile, types, wave
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "reference" / "skill-reel-edit" / "scripts"
CASES = ROOT / "tests" / "fixtures" / "cases"
SFXLIB = ROOT / "tests" / "fixtures" / "sfxlib"
SKILL_LIB_LINE = 'Path(r"D:\\Documents\\Claude Cowork\\MIVA\\reels\\sfx\\lib")'


def synth_audio(path, words, dur, seed):
    """Derau latar rendah + semburan 'suara' (derau pita 300-3000 Hz) di posisi tiap kata (pakai 'speech_end')."""
    sr = 16000
    rng = np.random.default_rng(seed)
    n = int(dur * sr)
    x = rng.normal(0, 0.004, n)
    for w in words:
        a, b = int(w["s"] * sr), int(w.get("speech_end", w["e"]) * sr)
        burst = rng.normal(0, 0.25, b - a)
        spec = np.fft.rfft(burst)
        f = np.fft.rfftfreq(len(burst), 1 / sr)
        spec[(f < 300) | (f > 3000)] = 0
        x[a:b] += np.fft.irfft(spec, len(burst))
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr); wf.writeframes(pcm.tobytes())


def fake_faster_whisper(words):
    mod = types.ModuleType("faster_whisper")

    class W:  # objek kata ala faster-whisper
        def __init__(self, d):
            self.word, self.start, self.end, self.probability = " " + d["w"], d["s"], d["e"], d.get("p", 0.9)

    class S:
        def __init__(self, ws):
            self.words = [W(d) for d in ws]
            self.start, self.end = ws[0]["s"], ws[-1]["e"]
            self.text = " " + " ".join(d["w"] for d in ws)

    class WhisperModel:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, audio, **kw):
            return iter([S(words)]), None

    mod.WhisperModel = WhisperModel
    return mod


def run_script(name, argv, patch_lib=False):
    script = SKILL / name
    old = sys.argv
    sys.argv = [str(script)] + argv
    try:
        if patch_lib:
            code = script.read_text(encoding="utf-8").replace(SKILL_LIB_LINE, f'Path(r"{SFXLIB}")')
            assert f'Path(r"{SFXLIB}")' in code, "baris LIB di build_html.py berubah, perbarui SKILL_LIB_LINE"
            exec(compile(code, str(script), "exec"), {"__file__": str(script), "__name__": "__main__"})
        else:
            runpy.run_path(str(script), run_name="__main__")
    finally:
        sys.argv = old


def run_case(case_dir):
    spec = json.load(open(case_dir / "input.json", encoding="utf-8"))
    audio = case_dir / "audio.wav"
    if not audio.exists():
        synth_audio(audio, spec["words"], spec["duration"], spec.get("seed", 7))
    golden = case_dir / "golden"
    shutil.rmtree(golden, ignore_errors=True)
    golden.mkdir()
    with tempfile.TemporaryDirectory() as td:
        proj = Path(td) / "proj"
        sys.modules["faster_whisper"] = fake_faster_whisper(spec["words"])
        run_script("transcribe.py", [str(audio), str(proj)])
        del sys.modules["faster_whisper"]
        shutil.copy(proj / "words-raw.json", golden / "words-raw.json")
        shutil.copy(proj / "edit.json", golden / "edit_auto.json")

        E = json.load(open(proj / "edit.json", encoding="utf-8"))
        E.update(spec.get("edit", {}))
        json.dump(E, open(proj / "edit.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        shutil.copy(proj / "edit.json", golden / "edit.json")

        cmds = []
        real_run = subprocess.run

        def fake_run(args, *a, **k):
            cmds.append([str(x) for x in args])
            Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
            Path(args[-1]).touch()
            return subprocess.CompletedProcess(args, 0)

        subprocess.run = fake_run
        try:
            run_script("build_base.py", [str(proj)])
        finally:
            subprocess.run = real_run
        # path absolut sementara -> token supaya bisa dibandingkan
        norm = [[x.replace(str(proj), "<PROJ>").replace(str(audio), "<SRC>") for x in c] for c in cmds]
        json.dump(norm, open(golden / "ffmpeg_cmds.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        shutil.copy(proj / "timing.json", golden / "timing.json")

        run_script("captions.py", [str(proj)])
        shutil.copy(proj / "captions.json", golden / "captions_draft.json")
        C = json.load(open(proj / "captions.json", encoding="utf-8"))
        for cur in spec.get("curate", []):
            ch = C["chunks"][cur["k"]]
            b = cur.get("big", "last")
            ch["big"] = ch["w"][-1:] if b == "last" else ch["w"][:1] if b == "first" else ch["w"] if b == "all" else b
            for key in ("anim", "hit", "pos"):
                if key in cur:
                    ch[key] = cur[key]
        json.dump(C, open(proj / "captions.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        shutil.copy(proj / "captions.json", golden / "captions.json")

        for f in ("overlay.css", "overlay.html", "overlay.js"):
            if (case_dir / f).exists():
                shutil.copy(case_dir / f, proj / f)
        run_script("build_html.py", [str(proj)], patch_lib=True)
        shutil.copy(proj / "cues.json", golden / "cues.json")
        html = (proj / "index.html").read_text(encoding="utf-8")
        a = html.index('<script type="application/json" id="data">') + len('<script type="application/json" id="data">')
        data = json.loads(html[a:html.index("</script>", a)])
        json.dump(data, open(golden / "data.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"golden: {case_dir.name}")


if __name__ == "__main__":
    for d in sorted(CASES.iterdir()):
        if (d / "input.json").exists():
            run_case(d)
