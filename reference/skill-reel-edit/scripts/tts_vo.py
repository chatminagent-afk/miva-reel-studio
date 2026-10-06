"""Mode motion (tanpa footage): naskah VO -> ElevenLabs -> assets/voice.wav + timing.json (pengganti transcribe+build_base).

    python tts_vo.py <folder_proyek> [--sampel "teks"]      (--sampel: buat sampel tiap suara di vo.json "kandidat")
    python tts_vo.py <folder_proyek> --dummy                 (timing perkiraan + suara hening, untuk menyusun grafik dulu)
    python tts_vo.py <folder_proyek> --audio vo-full.mp3     (satu file VO utuh, mis. dari connector ElevenLabs tanpa API key:
                                                              Whisper menyelaraskan kata ke naskah, lalu dipotong per kalimat
                                                              dan dirakit ulang dengan gap vo.json)

vo.json:
  {"voice": "<voice_id>", "model": "eleven_multilingual_v2", "speed": 1.0,
   "settings": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": true},
   "lead": 0.3,  "tail": 3.0,  "lang": "id",               # lang = bahasa VO untuk Whisper (mode --audio)                              # jeda sebelum kalimat pertama / sesudah kalimat terakhir
   "lines": [{"id": "hook", "text": "...", "gap": 0.0}, ...]}   # gap = jeda (dtk) sesudah kalimat sebelumnya
  "say" opsional per kalimat = ejaan untuk TTS kalau beda dari subtitle (mis. "MIVA" -> "Miva"); jumlah kata harus sama.
  "terjemahan": true = "say" bahasa lain dari "text" (mis. VO Inggris, subtitle Indonesia, 05/10); kata subtitle
  disebar proporsional di rentang kalimat yang diucapkan, jumlah kata boleh beda.

- Kunci dari env ELEVENLABS_API_KEY (proses atau env User Windows). Tidak pernah dicetak.
- Cache per kalimat di assets/vo-cache/<hash>.json (teks+suara+model+setelan sama = tidak bayar ulang kredit).
- Timing kata dari alignment karakter ElevenLabs (lebih tepat dari Whisper) -> timing.json words[{w,s,e,seg}],
  lines{id:{s,e}} (dipakai overlay.js lewat D.lines), cuts [] (tidak ada potongan footage).
"""
import base64, hashlib, json, os, subprocess, sys, urllib.request, urllib.error, wave
from pathlib import Path
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
SR = 48000
API = "https://api.elevenlabs.io/v1"


def key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    if not k and os.name == "nt":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as h:
                k = winreg.QueryValueEx(h, "ELEVENLABS_API_KEY")[0]
        except OSError:
            pass
    if not k:
        sys.exit("ELEVENLABS_API_KEY belum di-set (setx ELEVENLABS_API_KEY \"...\").")
    return k.strip()


def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None,
                                 headers={"xi-api-key": key(), "Content-Type": "application/json"},
                                 method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs {e.code}: {e.read().decode(errors='ignore')[:400]}")


def dummy(text):
    """perkiraan 14 huruf/dtk tanpa memanggil API (audio hening)."""
    t, chars, st, en = 0.1, [], [], []
    for c in text:
        d = 0.09 if c.isspace() else 1 / 14
        chars.append(c); st.append(t); en.append(t + d); t += d
    return {"audio_base64": None, "alignment": {"characters": chars, "character_start_times_seconds": st,
                                                 "character_end_times_seconds": en}, "_dur": t + 0.1}


def tts(V, text, prev=None, nxt=None, voice=None, cache=None):
    if "--dummy" in sys.argv:
        return dummy(text)
    voice = voice or V["voice"]
    body = {"text": text, "model_id": V.get("model", "eleven_multilingual_v2"),
            "voice_settings": {**V.get("settings", {}), "speed": V.get("speed", 1.0)}}
    if prev: body["previous_text"] = prev
    if nxt: body["next_text"] = nxt
    h = hashlib.sha1(json.dumps([voice, body], sort_keys=True).encode()).hexdigest()[:16]
    cf = cache / f"{h}.json" if cache else None
    if cf and cf.exists():
        return json.loads(cf.read_text(encoding="utf-8"))
    r = call(f"/text-to-speech/{voice}/with-timestamps?output_format=mp3_44100_128", body)
    if cf:
        cf.write_text(json.dumps(r), encoding="utf-8")
    return r


def decode(b64):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         input=base64.b64decode(b64), capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def words_from(al, text):
    """alignment karakter -> [(kata, s, e)] untuk kata di `text` (dipisah spasi)."""
    ch, st, en = al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]
    out, cur, s0, e0 = [], "", None, None
    for c, s, e in zip(ch, st, en):
        if c.isspace():
            if cur: out.append([cur, s0, e0]); cur = ""
            continue
        if not cur: s0 = s
        cur += c; e0 = e
    if cur: out.append([cur, s0, e0])
    return out


def norm(w):
    return "".join(c for c in w.lower() if c.isalnum())


def from_audio(path, L, lang="id"):
    """VO utuh -> [(klip, [[kata, s, e], ...]) per kalimat]; waktu kata relatif ke awal klip."""
    import difflib
    from faster_whisper import WhisperModel
    a = decode_file(path)
    a16 = a[::3].astype(np.float32)                         # 48k -> 16k (cukup untuk Whisper)
    script = [(w, li) for li, l in enumerate(L) for w in l.get("say", l["text"]).split()]
    m = WhisperModel("medium", device="cpu", compute_type="int8")
    segs, _ = m.transcribe(a16, language=lang, word_timestamps=True, vad_filter=False, beam_size=5)   # TANPA initial_prompt naskah: bikin Whisper melompat/kacau (05/10)
    hw = [(norm(w.word), w.start, w.end) for sg in segs for w in sg.words]
    sm = difflib.SequenceMatcher(None, [norm(w) for w, _ in script], [h[0] for h in hw], autojunk=False)
    tm = [None] * len(script)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ("equal", "replace") and j2 > j1:
            for k in range(i1, i2):
                j = j1 + (k - i1) * (j2 - j1) // (i2 - i1)
                tm[k] = [hw[j][1], hw[j][2]]
    miss = sum(1 for x in tm if x is None)
    known = [k for k, x in enumerate(tm) if x]
    for k in range(len(tm)):                                # isi yang tak cocok: interpolasi tetangga
        if tm[k] is None:
            lo = max([q for q in known if q < k], default=None); hi = min([q for q in known if q > k], default=None)
            s0 = tm[lo][1] if lo is not None else 0.0
            s1 = tm[hi][0] if hi is not None else s0 + 0.4
            n = (hi if hi is not None else k + 1) - (lo if lo is not None else -1)
            f = (k - (lo if lo is not None else -1)) / n
            tm[k] = [s0 + (s1 - s0) * f, s0 + (s1 - s0) * f + 0.15]
    print(f"Whisper: {len(hw)} kata terdengar, {len(script) - miss}/{len(script)} kata naskah cocok")
    out, k = [], 0
    starts = []
    for li, l in enumerate(L):
        n = len(l.get("say", l["text"]).split())
        starts.append((tm[k][0], tm[k + n - 1][1])); k += n
    bad = [L[i]["id"] for i, (s0, e0) in enumerate(starts) if e0 <= s0 or (i and s0 < starts[i - 1][1] - 0.05)]
    if bad:
        sys.exit(f"alignment kacau di kalimat {bad} — cek transkrip Whisper sebelum dirakit")
    k = 0
    for li, l in enumerate(L):
        n = len(l.get("say", l["text"]).split())
        s0, e0 = starts[li]
        c0 = max(0.0, s0 - 0.12, starts[li - 1][1] + 0.03 if li else 0.0)
        c1 = min(e0 + 0.22, starts[li + 1][0] - 0.06) if li + 1 < len(L) else e0 + 0.35
        clip = a[int(c0 * SR):int(c1 * SR)].copy()
        f = min(len(clip) // 4, int(0.012 * SR))
        clip[:f] *= np.linspace(0, 1, f); clip[-f:] *= np.linspace(1, 0, f)
        out.append((clip, [[w, tm[k + j][0] - c0, tm[k + j][1] - c0] for j, w in enumerate(l.get("say", l["text"]).split())]))
        k += n
    return out


def decode_file(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def wr(p, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


def main():
    proj = Path(sys.argv[1])
    V = json.load(open(proj / "vo.json", encoding="utf-8"))
    cache = proj / "assets" / "vo-cache"; cache.mkdir(parents=True, exist_ok=True)

    if "--sampel" in sys.argv:                 # sampel suara: satu file per kandidat
        text = sys.argv[sys.argv.index("--sampel") + 1]
        out = proj / "_sampel-vo"; out.mkdir(exist_ok=True)
        for name, vid in V.get("kandidat", {}).items():
            r = tts(V, text, voice=vid, cache=cache)
            wr(out / f"{name}.wav", decode(r["audio_base64"]) * 0.9)
            print("sampel", name)
        return

    L = V["lines"]
    t = V.get("lead", 0.15)
    voice = np.zeros(0)
    words, lines = [], {}
    ext = from_audio(sys.argv[sys.argv.index("--audio") + 1], L, V.get("lang", "id")) if "--audio" in sys.argv else None
    for i, ln in enumerate(L):
        say = ln.get("say", ln["text"])
        if ext:
            a, ws = ext[i]
        else:
            r = tts(V, say, prev=L[i - 1].get("say", L[i - 1]["text"]) if i else None,
                    nxt=L[i + 1].get("say", L[i + 1]["text"]) if i + 1 < len(L) else None, cache=cache)
            a = decode(r["audio_base64"]) if r["audio_base64"] else np.zeros(int(r["_dur"] * SR))
            ws = words_from(r.get("alignment") or r["normalized_alignment"], say)
        shown = ln["text"].split()
        if V.get("terjemahan") and len(ws) != len(shown):
            # subtitle = terjemahan (mis. VO Inggris, subtitle Indonesia): kata tampil disebar proporsional
            # panjang huruf di rentang kalimat yang diucapkan
            s0, e0 = ws[0][1], ws[-1][2]
            wt = [len(w) + 1.5 for w in shown]; tot = sum(wt); acc = 0.0
            ws2 = []
            for w, k in zip(shown, wt):
                a0 = s0 + (e0 - s0) * acc / tot; acc += k
                ws2.append([w, a0, s0 + (e0 - s0) * acc / tot - 0.02])
            ws = ws2
        if len(ws) != len(shown):
            sys.exit(f"kalimat {ln['id']}: {len(ws)} kata dari TTS vs {len(shown)} kata tampil — samakan 'say' dan 'text'.")
        t += ln.get("gap", 0.0) if i else 0.0
        # buang hening di awal klip supaya gap terukur dari kata pertama
        lead_cut = max(0.0, ws[0][1] - 0.04)
        a = a[int(lead_cut * SR):]
        off = t - lead_cut
        n0 = int(round(t * SR))
        if len(voice) < n0 + len(a):
            voice = np.concatenate([voice, np.zeros(n0 + len(a) - len(voice))])
        voice[n0:n0 + len(a)] += a
        for (w, s, e), wt in zip(ws, shown):
            words.append({"w": wt, "s": round(s + off, 3), "e": round(e + off, 3), "seg": i})
        lines[ln["id"]] = {"s": round(ws[0][1] + off, 3), "e": round(ws[-1][2] + off, 3)}
        t = ws[-1][2] + off                    # kalimat berikut diukur dari akhir kata terakhir
        print(f"{ln['id']:>10s} {lines[ln['id']]['s']:6.2f}–{lines[ln['id']]['e']:6.2f}  {ln['text']}")
    dur = round(t + V.get("tail", 3.0), 2)
    voice = np.concatenate([voice, np.zeros(max(0, int(dur * SR) - len(voice)))])[:int(dur * SR)]
    tmp = proj / "assets" / "_vo-raw.wav"
    wr(tmp, voice)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-af",
                    "highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=120,"
                    "loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000", "-ac", "2", str(proj / "assets" / "voice.wav")], check=True)
    tmp.unlink()
    json.dump({"duration": dur, "cuts": [], "words": words, "lines": lines},
              open(proj / "timing.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"voice.wav {dur:.2f} dtk, {len(L)} kalimat, {len(words)} kata")


main()
