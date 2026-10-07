"""Kunci paket sidecar Whisper: resources/whisper/requirements-<platform>.in -> requirements-<platform>.lock (versi + sha256).

    python3 scripts/lock-whisper.py [win64|linux64]

Resolusi memakai `pip install --dry-run --report` (metadata PyPI, tanpa memasang). Lock dipakai scripts/fetch-resources.mjs
dengan --require-hashes, jadi isi folder site-packages app selalu sama persis dengan yang dikunci di sini.
Python 3.13 = versi Python yang dibundel app (NuGet "python", lihat resources/manifest.json).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WHISPER = ROOT / "resources" / "whisper"
PY_VERSION = "3.13"
TARGETS = {
    "win64": ["--platform", "win_amd64", "--python-version", PY_VERSION, "--implementation", "cp"],
    # dev/tes Linux: platform mesin sendiri (Python 3.13 sistem)
    "linux64": [],
}


def lock(name):
    src = WHISPER / f"requirements-{name}.in"
    with tempfile.TemporaryDirectory() as td:
        report = Path(td) / "report.json"
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--dry-run", "--ignore-installed", "--quiet", "--report", str(report),
             "--only-binary=:all:", "--target", str(Path(td) / "t"), *TARGETS[name], "-r", str(src)],
            check=True,
        )
        items = json.loads(report.read_text(encoding="utf-8"))["install"]
    lines = [f"# Dibuat oleh scripts/lock-whisper.py dari {src.name}. Jangan diedit manual.", f"# Python {PY_VERSION}, {name}"]
    for it in sorted(items, key=lambda i: i["metadata"]["name"].lower()):
        h = it["download_info"]["archive_info"]["hashes"]["sha256"]
        lines.append(f'{it["metadata"]["name"]}=={it["metadata"]["version"]} --hash=sha256:{h}')
    out = WHISPER / f"requirements-{name}.lock"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{out.relative_to(ROOT)}: {len(items)} paket")


if __name__ == "__main__":
    for n in sys.argv[1:] or list(TARGETS):
        lock(n)
