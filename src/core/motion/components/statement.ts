// Kalimat besar: baris kecil sans + baris besar serif italic emas (gaya #big5 miva-3), atau pill satu kalimat (#sys miva-3).
// Kata `strike` dicoret garis merah (gaya "Standby 24/7" miva-4), `accent` disorot, `flash` = kilat putih saat masuk.
import type { MotionComponent, ResolvedMotion, StatementProps, MotionSfx } from '../types';
import { beatsOr, cue, exitAt, EXIT_DUR, js, markup, r3, uid } from '../runtime';

const CSS = `/* statement */
.mv-st-wrap { position: absolute; left: 0; right: 0; top: 380px; display: flex; flex-direction: column; align-items: center;
              text-shadow: 0 6px 30px rgba(0, 0, 0, 0.7); }
.mv-st-l1 { display: block; font-size: 66px; font-weight: 800; color: #fff; letter-spacing: -0.5px; text-align: center; max-width: 980px; opacity: 0; }
.mv-st-l2 { display: block; font-family: "Playfair Display", serif; font-style: italic; font-weight: 800; font-size: 136px; line-height: 1.05;
            color: var(--mv-gold); text-align: center; max-width: 980px; opacity: 0; }
.mv-st-l2.dim { color: #fff; }
.mv-st-ac { color: var(--mv-gold); }
.mv-st-pill { top: 420px; }
.mv-sk { position: relative; display: inline-block; }
/* coretan: disapu lewat clip-path (BUKAN scaleX(0): matriks singular merusak parsing transform GSAP -> rotate/skew liar) */
.mv-sk i { position: absolute; left: -6px; right: -6px; top: 52%; height: 12px; margin-top: -6px; border-radius: 6px; background: var(--mv-red);
           transform: rotate(-3deg); clip-path: inset(-20px 100% -20px -20px); box-shadow: 0 4px 16px rgba(255, 107, 94, 0.5); }
`;

/** Lebar teks kira-kira (px) = jumlah huruf * 0.52 * ukuran (serif) / 0.6 (sans). Kecilkan ukuran sampai muat. */
function fit(text: string, max: number, min: number, width: number, k: number): number {
  const len = Math.max(1, Array.from(text).length);
  return Math.max(min, Math.min(max, Math.floor(width / (len * k))));
}

function build(item: ResolvedMotion<'statement'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const tOut = exitAt(item);
  const t0 = item.t0;
  const pill = p.style === 'pill';
  let strikeN = 0;
  let accentInL2 = 0;

  const wrapFor = (inL2: boolean) => (kind: 'accent' | 'strike', hit: string) => {
    if (kind === 'strike') {
      const n = strikeN++;
      return `<span class="mv-sk" id="${P}-s${n}">${hit}<i id="${P}-x${n}"></i></span>`;
    }
    if (inL2) accentInL2++;
    return pill ? `<em>${hit}</em>` : `<span class="mv-st-ac">${hit}</span>`;
  };

  const marks = { accent: p.accent, strike: p.strike };
  let html: string;
  if (pill) {
    const full = [p.line1, p.line2].filter(Boolean).join(' ');
    html =
      `<div class="mv-r" id="${P}" data-layout-allow-overlap>` +
      `<div class="mv-pill mv-st-pill" id="${P}-p"><span>${markup(full, marks, wrapFor(false))}</span></div></div>`;
  } else {
    const l1 = p.line1 ? markup(p.line1, marks, wrapFor(false)) : '';
    const l2 = markup(p.line2 ?? '', marks, wrapFor(true));
    const fs1 = fit(p.line1 ?? '', 66, 40, 980, 0.6);
    const fs2 = fit(p.line2 ?? '', 136, 84, 980, 0.52);
    html =
      `<div class="mv-r" id="${P}" data-layout-allow-overlap><div class="mv-st-wrap">` +
      (p.line1 ? `<span class="mv-st-l1" id="${P}-1" style="font-size:${fs1}px">${l1}</span>` : '') +
      `<span class="mv-st-l2${accentInL2 > 0 ? ' dim' : ''}" id="${P}-2" style="font-size:${fs2}px">${l2}</span>` +
      `</div></div>`;
  }

  // waktu: strike pertama setelah kalimat terbaca; beatTimes (bila ada) menentukan tiap coretan
  const strikes = beatsOr(item, strikeN, t0 + 0.9, Math.max(t0 + 0.9, tOut - 0.5));
  const L: string[] = [];
  const sfx: MotionSfx[] = [];
  if (pill) {
    L.push(`mv.show("${P}-p", ${r3(t0)}, 0.32);`);
    sfx.push(cue(t0, 'pop', -8));
  } else {
    const t2 = p.line1 ? t0 + 0.2 : t0;
    if (p.line1) L.push(`tl.fromTo("#${P}-1", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, ${r3(t0)});`);
    L.push(
      `tl.fromTo("#${P}-2", { opacity: 0, scale: 1.25, filter: "blur(16px)" }, ` +
        `{ opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.42, ease: "power4.out", immediateRender: false }, ${r3(t2)});`,
    );
    if (p.flash) sfx.push(cue(t0, 'klik', 0));
    sfx.push(cue(t2, 'swish', -6, { align: true }));
  }
  if (p.flash) L.push(`mv.flash(${r3(t0)}, 0.3);`);
  for (let n = 0; n < strikeN; n++) {
    const ts = strikes[n];
    L.push(
      `tl.fromTo("#${P}-x${n}", { clipPath: "inset(-20px 100% -20px -20px)" }, ` +
        `{ clipPath: "inset(-20px -20px -20px -20px)", duration: 0.28, ease: "power3.out", immediateRender: false }, ${ts});`,
    );
    L.push(`tl.to("#${P}-s${n}", { color: "#8a929b", duration: 0.25 }, ${r3(ts + 0.1)});`);
    sfx.push(cue(ts, 'swish', -10, { align: true }));
  }
  L.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: L.join('\n'), sfx };
}

export const statement: MotionComponent<'statement'> = {
  kind: 'statement',
  title: 'Statement',
  description: 'A small sans line + a large gold italic serif line (or a one-sentence pill). Words can be highlighted or struck through in red.',
  fields: [
    { key: 'style', label: 'Style', type: 'select', options: ['serif', 'pill'] },
    { key: 'line1', label: 'Small line', type: 'text', hint: 'White sans above the large line (optional)' },
    { key: 'line2', label: 'Large line', type: 'text', hint: 'Gold italic serif (serif style) or the pill content' },
    { key: 'accent', label: 'Highlighted words', type: 'lines', hint: 'One phrase per line' },
    { key: 'strike', label: 'Struck-through words', type: 'lines', hint: 'One phrase per line; struck through in red on a beat' },
    { key: 'flash', label: 'White flash on entry', type: 'bool' },
  ],
  defaults: (): StatementProps => ({ line1: 'Mungkin bukan', line2: 'customer-nya.', style: 'serif' }),
  minDur: 1.2,
  maxDur: 5,
  zone: 'top',
  sceneDefault: false,
  build,
};
