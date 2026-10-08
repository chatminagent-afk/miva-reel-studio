"""Golden `tail` dari build_base.py skill /reel-edit YANG HIDUP (reference/ belum punya `tail`).

    python3 tests/parity/gen_tail_golden.py [path\\ke\\build_base.py]

Memakai edit.json + words-raw.json kasus `basic`, tail 2.6 dtk, perintah ffmpeg direkam (tidak dijalankan), lalu menulis
tests/fixtures/cases/basic/golden-tail/{ffmpeg_cmds.json,timing.json,edit.json}. tests/core/tail.test.ts membandingkannya
dengan port TypeScript (buildBaseCommands, mapTiming).
"""
import json, runpy, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CASE = ROOT / "tests" / "fixtures" / "cases" / "basic" / "golden"
OUT = ROOT / "tests" / "fixtures" / "cases" / "basic" / "golden-tail"
SKILL = Path(sys.argv[1] if len(sys.argv) > 1 else r"D:\Documents\Claude Cowork\MIVA\skills\reel-edit\scripts\build_base.py")
TAIL = 2.6

with tempfile.TemporaryDirectory() as td:
    proj = Path(td) / "proj"
    proj.mkdir()
    E = json.load(open(CASE / "edit.json", encoding="utf-8"))
    E["tail"] = TAIL
    json.dump(E, open(proj / "edit.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    shutil.copy(CASE / "words-raw.json", proj / "words-raw.json")
    cmds = []

    def fake_run(args, *a, **k):
        cmds.append([str(x) for x in args])
        Path(args[-1]).parent.mkdir(parents=True, exist_ok=True)
        Path(args[-1]).touch()
        return subprocess.CompletedProcess(args, 0)

    real = subprocess.run
    subprocess.run = fake_run
    try:
        sys.argv = [str(SKILL), str(proj)]
        runpy.run_path(str(SKILL), run_name="__main__")
    finally:
        subprocess.run = real
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir()
    json.dump({**E, "src": "<SRC>"}, open(OUT / "edit.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    shutil.copy(proj / "timing.json", OUT / "timing.json")
    # path sementara diganti penanda supaya golden tidak bergantung mesin
    td_s = str(proj)
    src = E["src"]
    norm = [["<SRC>" if x == src else x.replace(td_s, "<PROJ>").replace("\\", "/") if x.startswith(td_s) else x for x in c] for c in cmds]
    json.dump(norm, open(OUT / "ffmpeg_cmds.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("golden-tail ditulis:", OUT, "| perintah:", len(cmds))
