// Mockup HP lock-screen (gaya #phone miva-3 M04): jam besar berganti (siang -> malam), notifikasi WhatsApp menumpuk (maks 4
// terlihat, yang tertua memudar), HP bergetar tiap notifikasi, dan pill status ("Still replying" + tiga titik melompat) di bawah.
// Adegan: zone 'scene' (scrim + footage blur).
//
// Beat (beatTimes, berurutan): notifikasi 0..n-1, lalu pergantian jam ke clocks[1..m-1], lalu status. Yang tak diberikan dibagi
// otomatis. Jam pertama tampil sejak masuk.
import type { MotionComponent, MotionSfx, PhoneProps, ResolvedMotion } from '../types';
import { cue, esc, evenly, exitAt, EXIT_DUR, js, r3, uid, withBeats } from '../runtime';

const CSS = `/* phone */
.mv-ph { position: absolute; left: 300px; top: 205px; width: 480px; height: 860px; border-radius: 66px; overflow: hidden; opacity: 0;
         border: 14px solid #0b0f14; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.12), 0 40px 90px rgba(0, 0, 0, 0.6); }
.mv-ph-day { position: absolute; inset: 0; background: linear-gradient(180deg, #4f97de 0%, #8ec6f0 60%, #f3d3a0 100%); }
.mv-ph-night { position: absolute; inset: 0; opacity: 0; background: linear-gradient(180deg, #050b1d 0%, #13234a 70%, #2a2350 100%); }
.mv-ph-notch { position: absolute; left: 50%; top: 14px; width: 130px; height: 34px; margin-left: -65px; border-radius: 17px; background: #0b0f14; }
.mv-ph-clk { position: absolute; left: 0; right: 0; top: 90px; text-align: center; font-size: 132px; font-weight: 700; letter-spacing: -3px; color: #fff;
             font-variant-numeric: tabular-nums; text-shadow: 0 4px 20px rgba(0, 0, 0, 0.25); }
.mv-ph-c { display: none; }
.mv-ph-pns { position: absolute; left: 22px; right: 22px; top: 290px; }
.mv-ph-pn { position: absolute; left: 0; right: 0; height: 92px; display: flex; align-items: center; gap: 14px; padding: 0 18px; border-radius: 26px;
            background: rgba(255, 255, 255, 0.88); color: #111; font-size: 25px; font-weight: 600; opacity: 0; white-space: nowrap; overflow: hidden; }
.mv-ph-pn .ai { width: 52px; height: 52px; border-radius: 14px; flex: none; }
.mv-ph-pn b { display: block; font-size: 20px; font-weight: 800; color: #444; letter-spacing: 0.5px; }
.mv-ph-st { position: absolute; left: 40px; right: 40px; bottom: 34px; height: 86px; display: flex; align-items: center; justify-content: center; gap: 16px;
            border-radius: 43px; background: rgba(10, 14, 20, 0.88); color: #fff; font-size: 34px; font-weight: 800; opacity: 0; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4); }
.mv-ph-dt { display: flex; gap: 7px; }
.mv-ph-dt b { width: 11px; height: 11px; border-radius: 50%; background: var(--mv-amber); }
`;

/** Warna ikon aplikasi (kotak bulat di notifikasi). Merek lain ditulis sebagai teks + warna generik, bukan logo resmi. */
function appColor(app: string): string {
  const a = app.toLowerCase();
  if (a.includes('whatsapp') || a === 'wa') return '#25a35a';
  if (a.includes('instagram') || a === 'ig') return '#c13584';
  if (a.includes('telegram')) return '#2aabee';
  if (a.includes('mail') || a.includes('gmail')) return '#d44638';
  if (a.includes('tiktok')) return '#111';
  return '#5a86c8';
}

function build(item: ResolvedMotion<'phone'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const clocks = p.clocks?.length ? p.clocks : ['08:12'];
  const notifs = p.notifs ?? [];
  const n = notifs.length;
  const m = clocks.length;
  const hasSt = !!p.status;

  // ---- waktu: notifikasi rapat dari t0+0.3, jam berganti di sela notifikasi, status sesudah notifikasi terakhir ----
  const nStart = t0 + 0.3;
  const sp = Math.max(0.12, Math.min(0.38, (tOut - 0.8 - nStart) / Math.max(1, n - 1)));
  const nT = Array.from({ length: n }, (_, k) => nStart + k * sp);
  const nLast = n ? nT[n - 1] : nStart;
  const span = Math.max(0.3, nLast - nStart);
  const cT = m > 1 ? evenly(m - 1, nStart + span * 0.4, nStart + span * 0.85) : [];
  const stT = Math.min(tOut - 0.5, nLast + 0.2);
  const at = withBeats(item, [...nT, ...cT, ...(hasSt ? [stT] : [])]);
  const tN = at.slice(0, n);
  const tC = at.slice(n, n + m - 1);
  const tS = hasSt ? at[n + m - 1] : -1;

  const clk = clocks.map((c, k) => `<span class="mv-ph-c" id="${P}-c${k}"${k === 0 ? ' style="display:inline"' : ''}>${esc(c)}</span>`).join('');
  const pns = notifs
    .map(
      (nf, j) =>
        `<div class="mv-ph-pn" id="${P}-n${j}"><span class="ai" style="background:${appColor(nf.app ?? '')}"></span><div><b>${esc(nf.app ?? '')}</b>${esc(nf.text ?? '')}</div></div>`,
    )
    .join('');
  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap><div class="mv-ph" id="${P}-ph">` +
    `<div class="mv-ph-day"></div>${p.dayNight ? `<div class="mv-ph-night" id="${P}-nt"></div>` : ''}<div class="mv-ph-notch"></div>` +
    `<div class="mv-ph-clk" id="${P}-clk">${clk}</div><div class="mv-ph-pns">${pns}</div>` +
    (hasSt ? `<div class="mv-ph-st" id="${P}-st"><span>${esc(p.status!)}</span><span class="mv-ph-dt" id="${P}-dt"><b></b><b></b><b></b></span></div>` : '') +
    `</div></div>`;

  const J: string[] = [];
  const sfx: MotionSfx[] = [cue(t0, 'whoosh', -6, { align: true })];
  J.push(`tl.fromTo("#${P}-ph", { opacity: 0, y: 70, scale: 0.92 }, { ...IN, duration: 0.38 }, ${r3(t0 + 0.04)});`);
  // jam: span per teks, ganti lewat tl.set display; denyut skala tiap ganti
  tC.forEach((t, k) => {
    J.push(`tl.set("#${P}-c${k}", { display: "none" }, ${t});`);
    J.push(`tl.set("#${P}-c${k + 1}", { display: "inline" }, ${t});`);
    J.push(`mv.bump("${P}-clk", ${t}, 1.06);`);
    sfx.push(cue(t, 'tick', -6));
  });
  // latar siang -> malam: dari pergantian jam pertama sampai terakhir
  if (p.dayNight && tC.length) {
    const a = tC[0];
    const b = tC.length > 1 ? tC[tC.length - 1] : a + 0.6;
    J.push(`tl.fromTo("#${P}-nt", { opacity: 0 }, { opacity: 1, duration: ${r3(Math.max(0.2, b - a))}, ease: "none", immediateRender: false }, ${a});`);
  }
  // notifikasi: yang lama turun 102 px per langkah, yang ke-5 dari atas memudar (maks 4 terlihat), HP bergetar
  tN.forEach((t, j) => {
    for (let i = 0; i < j; i++) {
      J.push(`tl.to("#${P}-n${i}", { y: ${(j - i) * 102}, duration: 0.22, ease: "power3.out" }, ${t});`);
      if (j - i === 4) J.push(`tl.to("#${P}-n${i}", { opacity: 0, duration: 0.15, ease: "none" }, ${t});`);
    }
    J.push(`tl.fromTo("#${P}-n${j}", { opacity: 0, y: -30, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: "back.out(1.6)", immediateRender: false }, ${t});`);
    J.push(`mv.shake("${P}-ph", ${t}, 7, 5);`);
    sfx.push(cue(t, 'pop', -10));
  });
  if (hasSt) {
    J.push(`mv.show("${P}-st", ${tS}, 0.25);`);
    J.push(`mv.jump("${P}-dt", ${r3(tS + 0.15)}, ${r3(tOut - 0.1)});`);
  }
  J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const phone: MotionComponent<'phone'> = {
  kind: 'phone',
  title: 'HP lock-screen',
  description: 'Mockup HP: jam berganti (siang ke malam), notifikasi WhatsApp menumpuk dan HP bergetar, pill status di bawah. Cocok sebagai adegan.',
  fields: [
    { key: 'clocks', label: 'Jam', type: 'lines', hint: 'Satu per baris, mis. 08:12; berganti di beat' },
    { key: 'notifs', label: 'Notifikasi', type: 'json', hint: '[{app, text}]; masuk satu per beat, maks 4 terlihat' },
    { key: 'status', label: 'Status bawah', type: 'text', hint: 'Mis. Still replying (tiga titik melompat); kosong = tanpa pill' },
    { key: 'dayNight', label: 'Latar siang ke malam', type: 'bool' },
  ],
  defaults: (): PhoneProps => ({
    clocks: ['08:12', '12:47', '18:36', '22:51'],
    notifs: [
      { app: 'WhatsApp', text: 'Harga berapa kak?' },
      { app: 'WhatsApp', text: 'Masih buka?' },
      { app: 'WhatsApp', text: 'Bisa booking besok?' },
      { app: 'WhatsApp', text: 'Kak, ready?' },
      { app: 'WhatsApp', text: 'Halo kak?' },
    ],
    status: 'Still replying',
    dayNight: true,
  }),
  minDur: 2.5,
  maxDur: 10,
  zone: 'scene',
  sceneDefault: true,
  build,
};
