"""catalog.json -> reels/sfx/lib/audisi.html: halaman dengar-dan-koreksi label SFX (dibuka lokal di browser).

    python sfx_audisi.py

Steven memutar tiap bunyi, mengubah kategori/label atau menandai "buang", lalu klik "Salin koreksi" dan
menempelkan JSON-nya ke Claude. Claude memperbarui catalog.json (dikonfirmasi=true) — bukan halaman ini.
"""
import html, json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
LIB = Path(r"D:\Documents\Claude Cowork\MIVA\reels\sfx\lib")
cat = json.load(open(LIB / "catalog.json", encoding="utf-8"))
fit = json.load(open(LIB / "_fitur.json", encoding="utf-8"))
KAT = ["riser", "ketik", "klik", "tick", "whoosh", "swish", "impact", "boom", "ding", "pop", "kartun", "glitch", "lain", "buang"]

rows = []
for sid, b in cat["bunyi"].items():
    f = fit.get(sid, {})
    opts = "".join(f'<option{" selected" if k == b["kategori"] else ""}>{k}</option>' for k in KAT)
    ok = " ✓" if b.get("dikonfirmasi") else ""
    rows.append(f"""<tr data-id="{sid}" data-kat="{b['kategori']}" data-label="{html.escape(b['label'])}">
<td class="id">{sid}{ok}</td><td><audio controls preload="none" src="{sid}.wav"></audio></td>
<td>{f.get('dur', '?')} dtk</td><td><select>{opts}</select></td>
<td><input value="{html.escape(b['label'])}"></td><td class="y {b['yakin']}">{b['yakin']}</td></tr>""")

page = f"""<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Audisi SFX</title>
<style>
body {{ font: 14px/1.4 "Segoe UI", sans-serif; margin: 24px; background: #f6f6f2; color: #151515; }}
h1 {{ font-size: 20px; margin: 0 0 4px; }} p {{ margin: 0 0 16px; color: #555; }}
table {{ border-collapse: collapse; width: 100%; background: #fff; }}
td {{ padding: 6px 10px; border-bottom: 1px solid #e6e6e1; }} td.id {{ font-weight: 700; white-space: nowrap; }}
audio {{ height: 32px; }} input {{ width: 100%; padding: 4px; }} select {{ padding: 4px; }}
.y.rendah {{ color: #b8532f; }} .y.sedang {{ color: #8a6d00; }} .y.tinggi {{ color: #2e7d32; }}
tr.ubah {{ background: #fff8d6; }}
button {{ position: sticky; top: 8px; padding: 10px 18px; font-weight: 700; border: 0; border-radius: 8px; background: #151515; color: #fff; cursor: pointer; }}
pre {{ background: #fff; padding: 12px; white-space: pre-wrap; }}
</style></head><body>
<h1>Audisi SFX — reels/sfx/lib</h1>
<p>Label = dugaan dari spektrogram (belum didengar). Putar, ubah kategori/label kalau salah, pilih <b>buang</b> untuk yang jelek, lalu klik tombol dan tempel hasilnya ke Claude.</p>
<button id="b">Salin koreksi</button> <span id="s"></span>
<table>{''.join(rows)}</table><pre id="o"></pre>
<script>
document.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("input", () => {{
  const k = tr.querySelector("select").value, l = tr.querySelector("input").value;
  tr.classList.toggle("ubah", k !== tr.dataset.kat || l !== tr.dataset.label);
}}));
document.getElementById("b").onclick = () => {{
  const out = {{}};
  document.querySelectorAll("tr.ubah").forEach(tr => out[tr.dataset.id] = {{
    kategori: tr.querySelector("select").value, label: tr.querySelector("input").value }});
  const txt = "koreksi SFX: " + JSON.stringify(out);
  document.getElementById("o").textContent = txt;
  try {{ navigator.clipboard.writeText(txt); document.getElementById("s").textContent = "tersalin (" + Object.keys(out).length + " bunyi)"; }}
  catch (e) {{ document.getElementById("s").textContent = "salin manual dari kotak di bawah"; }}
}};
</script></body></html>"""
(LIB / "audisi.html").write_text(page, encoding="utf-8")
print(f"audisi.html: {len(rows)} bunyi")
