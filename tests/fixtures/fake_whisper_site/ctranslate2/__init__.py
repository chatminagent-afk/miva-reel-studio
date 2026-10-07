"""ctranslate2 palsu untuk tes sidecar: jumlah GPU dari spec faster_whisper palsu (FAKE_FW_SPEC)."""
import json
import os

__version__ = "4.8.2-fake"


def get_cuda_device_count():
    return json.load(open(os.environ["FAKE_FW_SPEC"], encoding="utf-8")).get("cuda_devices", 0)
