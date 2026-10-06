import json, re, sys, wave, numpy as np, difflib
SP = sys.argv[1]
w = wave.open(f"{SP}/band.wav"); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
db = np.array([20*np.log10(np.sqrt(np.mean(a[i:i+160]**2))+1e-9) for i in range(0, len(a), 160)])
thr = np.percentile(db, 20) + 5
on = db > thr
norm = lambda t: re.sub(r"[^\w\-]", "", t.lower())
engines = ["fw-large-v3-turbo-cuda", "fw-medium-cuda", "fw-medium-cpu", "cpp-large-v3-turbo-cuda", "cpp-medium-cuda"]
data = {e: json.load(open(f"{SP}/{e}.json")) for e in engines}
print(f"{'engine':26s} kata  dur_kata_med  kata>1.2s  gap>=0.22: n  %hening  start_di_suara")
for e, W in data.items():
    durs = np.array([x["e"] - x["s"] for x in W])
    long = int((durs > 1.2).sum())
    gaps = [(W[i]["e"], W[i+1]["s"]) for i in range(len(W)-1) if W[i+1]["s"] - W[i]["e"] >= 0.22]
    sil = [1 - on[int(g0*100):int(g1*100)].mean() for g0, g1 in gaps if int(g1*100) > int(g0*100)]
    st = np.mean([on[max(0,int(x["s"]*100)):int(x["s"]*100)+15].any() for x in W])
    print(f"{e:26s} {len(W):4d}  {np.median(durs):6.2f}       {long:3d}        {len(gaps):3d}    {np.mean(sil)*100 if sil else 0:5.1f}   {st*100:5.1f}%")
base = [norm(x["w"]) for x in data["fw-large-v3-turbo-cuda"]]
for e in engines[1:]:
    other = [norm(x["w"]) for x in data[e]]
    sm = difflib.SequenceMatcher(a=base, b=other, autojunk=False)
    diffs = [(" ".join(base[i1:i2]), " ".join(other[j1:j2])) for op, i1, i2, j1, j2 in sm.get_opcodes() if op != "equal"]
    print(f"\n{e} vs fw-turbo: {diffs}")
