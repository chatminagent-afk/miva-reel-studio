// Kluster bubble chat, empat mode:
//   stack  : bubble berhuruf-avatar menumpuk satu per satu di kotak (gaya #qbox miva-3 M03)
//   loop   : tiga bubble pertama masuk satu-satu, lalu sisa daftar muncul dan bergulir ke atas + blur (pertanyaan itu-itu lagi)
//   gather : pill bubble di sekeliling kepala ditarik ke titik tengah lalu hilang (gaya #gath miva-3 M07; logo menyusul dari komponen logo)
//   flood  : pill bubble membanjir memenuhi area atas, makin rapat
//
// Beat (beatTimes): stack/flood = satu beat per item; loop = min(3,n) beat item + 1 beat awal gulir; gather = 1 beat awal ditarik
// (munculnya bubble dibagi rapat sebelum itu). Tanpa beat: dibagi otomatis di dalam [t0, t1].
import type { BubblesProps, MotionComponent, MotionSfx, ResolvedMotion } from '../types';
import { cue, esc, evenly, exitAt, EXIT_DUR, js, r3, rngFor, uid, withBeats } from '../runtime';

const CSS = `/* bubbles */
.mv-qbox { position: absolute; left: 160px; right: 160px; top: 215px; overflow: hidden; }
.mv-ql { position: absolute; left: 0; right: 0; top: 0; }
.mv-qb { position: absolute; left: 0; height: 100px; display: flex; align-items: center; gap: 18px; opacity: 0; }
.mv-qb .av { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; font-size: 30px; font-weight: 800; color: #fff; flex: none; }
.mv-qb .tx { padding: 18px 30px; border-radius: 34px 34px 34px 8px; background: #fff; color: #111; font-size: 44px; font-weight: 800; letter-spacing: -0.5px;
             box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4); white-space: nowrap; }
`;

// avatar bergilir (huruf + warna), dari miva-3
const AV: [string, string][] = [['R', '#7a5ac8'], ['D', '#c8805a'], ['A', '#3f9a7c'], ['S', '#5a86c8']];
const PITCH = 118;

// slot untuk gather: [sisi, jarak dari tepi, y]
const SLOTS: ['l' | 'r', number, number][] = [
  ['l', 60, 250], ['r', 60, 230], ['l', 30, 420], ['r', 30, 470], ['l', 90, 610], ['r', 70, 640], ['l', 20, 780], ['r', 20, 900], ['l', 330, 200], ['r', 320, 190],
];
const CX = 540;
const CY = 380;

function build(item: ResolvedMotion<'bubbles'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const mode = p.mode ?? 'stack';
  const items = p.items?.length ? p.items : [];
  const n = items.length;
  const J: string[] = [];
  const sfx: MotionSfx[] = [];
  let html = '';

  if (mode === 'stack' || mode === 'loop') {
    const loop = mode === 'loop';
    // loop: daftar dilengkapi (diputar ulang) sampai 12 supaya terasa tanpa akhir; 3 pertama masuk satu-satu
    const list = loop && n > 0 ? Array.from({ length: Math.max(12, n) }, (_, k) => items[k % n]) : items;
    const shown = loop ? Math.min(3, list.length) : list.length;
    const boxH = loop ? 352 : Math.max(100, shown * PITCH - 18);
    const row = list
      .map((tx, k) => {
        const [ch, col] = AV[k % AV.length];
        return `<div class="mv-qb" id="${P}-q${k}" data-layout-allow-overlap style="top:${k * PITCH}px;left:${k % 2 ? 90 : 0}px"><span class="av" style="background:${col}">${ch}</span><span class="tx">${esc(tx)}</span></div>`;
      })
      .join('');
    html = `<div class="mv-r" id="${P}" data-layout-allow-overlap><div class="mv-qbox" id="${P}-bx" style="height:${boxH}px"><div class="mv-ql" id="${P}-ql">${row}</div></div></div>`;

    const first = t0 + 0.1;
    const lastItem = Math.max(first, Math.min(tOut - (loop ? 1.2 : 0.7), first + 0.8 * (shown - 1)));
    const defaults = [...evenly(shown, first, lastItem), ...(loop ? [lastItem + 0.65] : [])];
    const at = withBeats(item, defaults);
    for (let k = 0; k < shown; k++) {
      J.push(`tl.fromTo("#${P}-q${k}", { opacity: 0, x: -40, scale: 0.85 }, { opacity: 1, x: 0, scale: 1, duration: 0.28, ease: "back.out(1.7)", immediateRender: false }, ${at[k]});`);
      sfx.push(cue(at[k], 'pop', -4));
    }
    if (loop && list.length > shown) {
      const tl0 = Math.max(at[shown], at[shown - 1] + 0.2);
      const rest = list.slice(shown).map((_, k) => `"#${P}-q${k + shown}"`);
      J.push(`tl.set([${rest.join(', ')}], { opacity: 1 }, ${r3(tl0)});`);
      J.push(
        `tl.fromTo("#${P}-ql", { y: 0, filter: "blur(0px)" }, { y: ${-PITCH * (list.length - shown)}, filter: "blur(3px)", ` +
          `duration: ${r3(Math.max(0.4, tOut - tl0 + 0.05))}, ease: "power2.in", immediateRender: false }, ${r3(tl0)});`,
      );
      sfx.push(cue(tl0, 'swish', -6, { align: true }));
    }
    J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  } else {
    // gather / flood: pill bubble putih bertitik hijau
    const rnd = rngFor(item.id);
    // flood: sel 3 kolom x 6 baris (y 215-590) diacak berbenih, jadi pill rapat tapi tidak saling menutupi sebelum sel habis
    const cells = Array.from({ length: 18 }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const slots: { side: 'l' | 'r'; off: number; y: number }[] = items.map((tx, k) => {
      if (mode === 'gather') {
        const [side, off, y] = SLOTS[k % SLOTS.length];
        return k < SLOTS.length ? { side, off, y } : { side, off: off + Math.round(rnd() * 120), y: y + Math.round((rnd() - 0.5) * 120) };
      }
      const cell = cells[k % cells.length];
      const w = 64 + 17 * Array.from(tx).length;
      const col = cell % 3;
      const row = Math.floor(cell / 3);
      return { side: 'l', off: 20 + col * 340 + Math.round(rnd() * Math.max(0, 320 - w)), y: 215 + row * 75 + Math.round((rnd() - 0.5) * 14) };
    });
    const pills = items
      .map((tx, k) => {
        const s = slots[k];
        return `<div class="mv-fb" id="${P}-b${k}" data-layout-allow-overlap style="${s.side === 'l' ? 'left' : 'right'}:${s.off}px;top:${s.y}px"><i></i>${esc(tx)}</div>`;
      })
      .join('');
    html = `<div class="mv-r" id="${P}" data-layout-allow-overlap>${pills}</div>`;

    if (mode === 'gather') {
      // beat[0] = awal ditarik; muncul rapat sebelum itu
      const pull = withBeats(item, [t0 + n * 0.06 + 0.45])[0];
      const stag = Math.max(0.02, Math.min(0.12, (pull - t0 - 0.2) / Math.max(1, n)));
      items.forEach((tx, k) => {
        const s = slots[k];
        const w = 64 + 17 * Array.from(tx).length;
        const cxk = s.side === 'l' ? s.off + w / 2 : 1080 - s.off - w / 2;
        J.push(`mv.pop("${P}-b${k}", ${r3(t0 + k * stag)}, 0.2);`);
        J.push(`tl.to("#${P}-b${k}", { x: ${Math.round(CX - cxk)}, y: ${Math.round(CY - (s.y + 31))}, scale: 0.3, duration: 0.5, ease: "power3.in" }, ${r3(pull + k * 0.03)});`);
        J.push(`tl.to("#${P}-b${k}", { opacity: 0, duration: 0.08, ease: "none" }, ${r3(pull + 0.47 + k * 0.03)});`);
      });
      sfx.push(cue(pull, 'whoosh', -6, { align: true }));
    } else {
      // flood: makin rapat (selang menyusut), semua keluar bersama di akhir
      const a = t0 + 0.05;
      const b = Math.max(a, tOut - 0.6);
      const at = withBeats(item, Array.from({ length: n }, (_, k) => (n > 1 ? a + (b - a) * Math.pow(k / (n - 1), 0.85) : a)));
      items.forEach((_, k) => {
        J.push(`mv.pop("${P}-b${k}", ${at[k]}, 0.24);`);
        if (n <= 8 || k % 2 === 0) sfx.push(cue(at[k], 'pop', -10));
      });
      sfx.push(cue(at[0], 'whoosh', -8, { align: true }));
    }
    J.push(`tl.to([${items.map((_, k) => `"#${P}-b${k}"`).join(', ')}], { opacity: 0, y: -30, duration: 0.24, ease: "power2.in" }, ${tOut});`);
  }
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const bubbles: MotionComponent<'bubbles'> = {
  kind: 'bubbles',
  title: 'Kluster bubble',
  description: 'Bubble chat: tumpuk satu-satu, loop bergulir tanpa akhir, ditarik ke tengah, atau membanjir.',
  fields: [
    { key: 'mode', label: 'Mode', type: 'select', options: ['stack', 'loop', 'gather', 'flood'] },
    { key: 'items', label: 'Isi bubble', type: 'lines', hint: 'Satu per baris. Loop: daftar diulang sampai 12 supaya terasa tanpa akhir' },
  ],
  defaults: (): BubblesProps => ({ items: ['Harga berapa?', 'Buka jam berapa?', 'Bisa booking?'], mode: 'loop' }),
  minDur: 1.5,
  maxDur: 8,
  zone: 'top',
  sceneDefault: false,
  build,
};
