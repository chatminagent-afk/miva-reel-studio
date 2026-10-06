<!doctype html>
<html lang="id" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&family=Playfair+Display:ital,wght@1,600;1,700;1,800&display=block" rel="stylesheet" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      /* reel-edit template (skill /reel-edit, 2026-10-03). File ini disalin ke proyek sebagai template.tpl;
         build_html.py mengisi __DATA__ (subtitle, kata kunci, kamera, insert) -> index.html.
         Lapisan: #cam (footage + zoom/pan) < inserts (b-roll layar penuh) < overlay per video < subtitle.
         Subtitle dua lapis (gaya referensi 03/10): kalimat biasa = sans kecil putih di pill gelap;
         kata kunci = serif italic besar emas + kata penghubung kecil yang menumpuk. */
      :root {
        --key: #ffd65a; --key-shadow: rgba(20, 12, 0, 0.55); --pill: rgba(12, 12, 14, 0.58);
        --glass: rgba(14, 14, 18, 0.80); --line: rgba(255, 255, 255, 0.14); --mute: rgba(255, 255, 255, 0.62);
        --cap-y: 1300px;        /* pusat zona subtitle; hindari wajah & UI Reels bawah (>1560) */
      }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
      body { font-family: "Inter", "Segoe UI", sans-serif; color: #fff; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }
      #bgl { position: absolute; inset: 0; background: #000; }
      #cam { position: absolute; inset: 0; }
      #aroll { position: absolute; inset: 0; width: 1080px; height: 1920px; object-fit: cover; }
      #flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; }

      /* b-roll / screenshot layar penuh */
      .ins { position: absolute; inset: 0; overflow: hidden; background: #000; }
      .insIn { position: absolute; inset: 0; }
      .insIn img, .insIn video { position: absolute; inset: 0; width: 1080px; height: 1920px; object-fit: cover; }

      /* subtitle biasa */
      #caps { position: absolute; left: 110px; right: 110px; top: calc(var(--cap-y) - 90px); height: 180px; }
      .cap { position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; opacity: 0; }
      .capBox { display: block; max-width: 860px; padding: 12px 26px 14px; border-radius: 20px; background: var(--pill);
                font-weight: 600; font-size: 52px; line-height: 1.18; letter-spacing: -0.5px; text-align: center;
                text-shadow: 0 2px 10px rgba(0, 0, 0, 0.35); }
      .ch { opacity: 0; }

      /* kata kunci bertumpuk */
      #keys { position: absolute; left: 70px; right: 70px; top: calc(var(--cap-y) - 290px); height: 520px; }
      .key { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; opacity: 0; }
      .key.l { align-items: flex-start; padding-left: 30px; }
      .key.r { align-items: flex-end; padding-right: 30px; }
      .kl { display: block; }
      .kl.small { font-family: "Inter", sans-serif; font-weight: 700; font-style: italic; font-size: 46px; letter-spacing: -0.5px;
                  text-shadow: 0 3px 14px rgba(0, 0, 0, 0.6); margin: 4px 0; }
      .kl.small.pre { align-self: center; transform-origin: 50% 100%; margin-right: 260px; }
      .kl.small.post { align-self: center; margin-left: 260px; }
      .kl.big { font-family: "Playfair Display", Georgia, serif; font-style: italic; font-weight: 800; font-size: 168px;
                line-height: 0.98; letter-spacing: -4px; color: var(--key); text-align: center; max-width: 940px;
                -webkit-text-stroke: 3px rgba(40, 24, 0, 0.55); paint-order: stroke fill;
                text-shadow: 0 6px 28px var(--key-shadow), 0 1px 2px rgba(0, 0, 0, 0.5); }
      .kl.big.long { font-size: 128px; letter-spacing: -3px; }

      /* ===== OVERLAY CSS per video (kartu, chip, poll, dsb.) ===== */
      /*OVERLAY-CSS*/
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="__DUR__">
      <div id="bgl"></div>
      <div id="cam">
        <video id="aroll" class="clip" src="assets/base.mp4" data-start="0" data-duration="__DUR__" data-track-index="0" muted playsinline></video>
      </div>
<!--INSERTS-->
      <div id="flash"></div>

      <!-- ===== OVERLAY HTML per video ===== -->
      <!--OVERLAY-HTML-->

      <div id="keys"></div>
      <div id="caps"></div>
    </div>

    <script type="application/json" id="data">__DATA__</script>
    <script>
      const D = JSON.parse(document.getElementById("data").textContent);
      const tl = gsap.timeline({ paused: true });
      const DUR = D.duration;

      // ---------- kamera ----------
      // #cam = gerak dasar (zoom in/out + pan per ketukan), #aroll = punch-in kata kunci (lapisan terpisah, tidak saling timpa)
      document.getElementById("cam").style.transformOrigin = D.origin;
      document.getElementById("aroll").style.transformOrigin = D.origin;
      D.camera.forEach((m) => {
        const el = m.el || "#cam";
        if (m.from) tl.fromTo(el, m.from, { ...m.to, duration: m.dur, ease: m.ease, immediateRender: false }, m.t);
        else tl.to(el, { ...m.to, duration: m.dur, ease: m.ease }, m.t);
      });

      // ---------- b-roll / screenshot: masuk zoom-blur, Ken Burns pelan ----------
      D.inserts.forEach((ins, i) => {
        tl.fromTo(`#ins${i}in`, { scale: 1.18, filter: "blur(12px)" },
          { scale: 1.04, filter: "blur(0px)", duration: 0.45, ease: "power3.out", immediateRender: false }, ins.t);
        tl.to(`#ins${i}in`, { scale: 1.0 + (ins.zoom ?? 0.0), duration: Math.max(0.1, ins.dur - 0.45), ease: "none" }, ins.t + 0.45);
      });

      // ---------- subtitle biasa: "type" = per huruf, "pop" = langsung ----------
      const capsEl = document.getElementById("caps");
      D.caps.forEach((c, ci) => {
        const wrap = document.createElement("div"); wrap.className = "cap"; wrap.id = "cap" + ci;
        const box = document.createElement("div"); box.className = "capBox";
        const text = c.words.map((w) => w.t).join(" ");
        if (c.anim === "type") {
          [...text].forEach((ch, k) => {
            const s = document.createElement("span"); s.className = "ch"; s.id = `c${ci}_${k}`;
            s.textContent = ch; box.appendChild(s);
          });
        } else box.textContent = text;
        wrap.appendChild(box); capsEl.appendChild(wrap);
        if (c.anim === "type") {
          tl.fromTo(wrap, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: "none", immediateRender: false }, c.s);
          [...text].forEach((ch, k) =>
            tl.fromTo(`#c${ci}_${k}`, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none", immediateRender: false }, c.s + 0.02 + k / D.cps));
        } else {
          tl.fromTo(wrap, { opacity: 0, scale: 0.92, y: 14 }, { opacity: 1, scale: 1, y: 0, duration: 0.12, ease: "back.out(2)", immediateRender: false }, c.s);
        }
        tl.to(wrap, { opacity: 0, duration: 0.08, ease: "none" }, c.e - 0.08);
      });

      // ---------- kata kunci: slam / blur / type ----------
      const keysEl = document.getElementById("keys");
      D.keys.forEach((k, ki) => {
        const box = document.createElement("div"); box.className = "key " + k.pos; box.id = "key" + ki;
        const bigIdx = k.lines.findIndex((l) => l.big);
        k.lines.forEach((l, li) => {
          const s = document.createElement("div");
          s.className = "kl " + (l.big ? "big" + (l.t.length > 9 ? " long" : "") : "small " + (li < bigIdx ? "pre" : "post"));
          s.id = `k${ki}_${li}`; s.textContent = l.t; box.appendChild(s);
        });
        keysEl.appendChild(box);
        tl.fromTo(box, { opacity: 0 }, { opacity: 1, duration: 0.05, ease: "none", immediateRender: false }, k.s);
        k.lines.forEach((l, li) => {
          const el = `#k${ki}_${li}`;
          if (!l.big) {
            const t = li < bigIdx ? k.s : k.hit + 0.18;
            tl.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.2, ease: "power2.out", immediateRender: false }, t);
          } else if (k.anim === "slam") {
            tl.fromTo(el, { opacity: 0, scale: 1.45, filter: "blur(10px)" },
              { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.24, ease: "power4.out", immediateRender: false }, k.hit - 0.04);
          } else if (k.anim === "blur") {
            tl.fromTo(el, { opacity: 0, filter: "blur(18px)", y: 18 },
              { opacity: 1, filter: "blur(0px)", y: 0, duration: 0.42, ease: "power2.out", immediateRender: false }, k.hit - 0.1);
          } else {
            tl.fromTo(el, { opacity: 0, clipPath: "inset(0 100% 0 0)" },
              { opacity: 1, clipPath: "inset(0 0% 0 0)", duration: Math.max(0.2, l.t.length / D.cps), ease: "steps(" + l.t.length + ")", immediateRender: false }, k.s + 0.02);
          }
        });
        tl.to(box, { opacity: 0, filter: "blur(6px)", duration: 0.14, ease: "power2.in" }, k.e - 0.14);
      });

      // ===== OVERLAY JS per video (pakai tl, waktu = detik di video hasil potong) =====
      /*OVERLAY-JS*/

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
