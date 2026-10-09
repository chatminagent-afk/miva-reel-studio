// Tumpukan pill ajakan (gaya #cta miva-2 M10): pill putih berikon bertingkat dengan panah turun. Dengan `tap` (gaya miva-4 M10)
// pill terakhir jadi tombol utama navy bergaris cyan bertitik hijau ("CHAT NOMOR DI BIO") dan kursor datang mengetuknya (cincin menyebar).
//
// Beat (beatTimes, berurutan): satu per pill, lalu (bila tap) waktu ketukan. Bawaan: pill tiap 0,45 dtk dari t0+0,1; ketukan 0,9 dtk
// sesudah pill terakhir; kursor tiba 0,45 dtk sebelum ketukan.
import type { CtaProps, MotionComponent, MotionSfx, ResolvedMotion } from '../types';
import { cue, esc, exitAt, EXIT_DUR, js, r3, uid, withBeats } from '../runtime';
import { icon } from '../icons';

const CSS = `/* cta */
.mv-cta { position: absolute; left: 0; right: 0; top: 205px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.mv-cta-p { position: relative; display: flex; align-items: center; gap: 16px; height: 84px; padding: 0 38px; border-radius: 42px; background: rgba(255, 255, 255, 0.96);
            color: #111; font-size: 38px; font-weight: 900; letter-spacing: 2px; white-space: nowrap; opacity: 0; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4); }
.mv-cta-p .mv-i { width: 40px; height: 40px; stroke-width: 3; }
.mv-cta-p.last { height: 96px; padding: 0 44px; border-radius: 48px; background: #0f1d33; border: 3px solid var(--mv-cyan); color: #fff;
                 font-family: var(--mv-wm); font-size: 40px; font-weight: 800; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5); }
.mv-cta-p.last i.dot { width: 16px; height: 16px; border-radius: 50%; background: #3ddc84; }
.mv-cta-p .rip { position: absolute; left: 50%; top: 50%; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%; border: 5px solid var(--mv-cyan); opacity: 0; }
.mv-cta-d { height: 40px; display: grid; place-items: center; font-size: 34px; font-weight: 900; color: var(--mv-mint); opacity: 0; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7); }
.mv-cta-cur { position: absolute; left: 0; top: 0; width: 84px; height: 84px; opacity: 0; filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.5)); }
.mv-cta-cur svg { width: 100%; height: 100%; }
`;

// ikon pill: dipilih dari kata kunci teks, kalau tidak ada bergilir komentar -> kirim -> tambah
const SEND = '<svg class="mv-i" viewBox="0 0 40 40"><path d="M5 19L35 6 27 35l-7-11z"/><path d="M20 24l15-18"/></svg>';
const PLUS = '<svg class="mv-i" viewBox="0 0 40 40"><circle cx="20" cy="20" r="14"/><path d="M14 20h12M20 14v12"/></svg>';
function pillIcon(text: string, k: number): string {
  if (/komen|comment/i.test(text)) return icon('bubble');
  if (/\bdm\b|kirim|pesan|message/i.test(text)) return SEND;
  if (/bio|chat|\bwa\b|whatsapp|link/i.test(text)) return PLUS;
  return [icon('bubble'), SEND, PLUS][k % 3];
}

const CURSOR = '<svg viewBox="0 0 40 40"><path d="M10 4l20 18-9 1 5 11-5 2-5-11-6 7z" fill="#fff" stroke="#111" stroke-width="2" stroke-linejoin="round"/></svg>';

function build(item: ResolvedMotion<'cta'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const pills = p.pills?.length ? p.pills : [];
  const n = pills.length;
  const tap = !!p.tap && n > 0;

  const parts: string[] = [];
  pills.forEach((tx, k) => {
    const last = tap && k === n - 1; // tombol utama hanya bila ada ketukan; tanpa tap semua pill putih seperti miva-2
    parts.push(
      `<div class="mv-cta-p${last ? ' last' : ''}" id="${P}-p${k}">${last ? '<i class="dot"></i>' : pillIcon(tx, k)}${esc(tx)}${last ? `<span class="rip" id="${P}-rip"></span>` : ''}</div>`,
    );
    if (k < n - 1) parts.push(`<div class="mv-cta-d" id="${P}-d${k}">↓</div>`);
  });
  // pusat pill terakhir: tumpukan mulai y 205, tiap tingkat = pill 84 + panah 40 + 2 celah 6 = 136; pill terakhir tinggi 96
  const cy = 205 + 136 * Math.max(0, n - 1) + 48; // pill biasa 84 / tombol 96: selisih pusat < 6 px, diabaikan
  const tipX = 540 + 60;
  const tipY = cy + 12;
  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap><div class="mv-cta">${parts.join('')}</div>` +
    (tap ? `<div class="mv-cta-cur" id="${P}-cur">${CURSOR}</div>` : '') +
    `</div>`;

  // ---- waktu ----
  const first = t0 + 0.1;
  const pT = Array.from({ length: n }, (_, k) => first + 0.45 * k);
  const tapT = Math.min(tOut - 0.6, (n ? pT[n - 1] : first) + 0.9);
  const at = withBeats(item, [...pT, ...(tap ? [tapT] : [])]);

  const J: string[] = [];
  const sfx: MotionSfx[] = [];
  pills.forEach((_, k) => {
    J.push(`mv.pop("${P}-p${k}", ${at[k]}, 0.28);`);
    if (k > 0) J.push(`tl.fromTo("#${P}-d${k - 1}", { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.2, immediateRender: false }, ${r3(Math.max(t0, at[k] - 0.12))});`);
    sfx.push(cue(at[k], 'pop', -8));
  });
  if (tap) {
    const tt = at[n];
    J.push(`tl.fromTo("#${P}-cur", { opacity: 0, x: 900, y: ${tipY + 220} }, { opacity: 1, x: ${tipX - 21}, y: ${tipY - 8}, duration: 0.35, ease: "power3.out", immediateRender: false }, ${r3(Math.max(t0, tt - 0.45))});`);
    J.push(`tl.to("#${P}-cur", { scale: 0.82, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.out" }, ${tt});`);
    J.push(`tl.fromTo("#${P}-p${n - 1}", { scale: 1 }, { scale: 0.95, duration: 0.08, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, ${tt});`);
    J.push(`tl.fromTo("#${P}-rip", { opacity: 0.9, scale: 0.3 }, { opacity: 0, scale: 2.4, duration: 0.5, ease: "power2.out", immediateRender: false }, ${tt});`);
    sfx.push(cue(tt, 'klik', -4));
  }
  J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const cta: MotionComponent<'cta'> = {
  kind: 'cta',
  title: 'CTA pills',
  description: 'Stepped stack of call-to-action pills with arrows (e.g. COMMENT, DM, CHAT NOMOR DI BIO); the last pill is navy, optionally with a cursor tapping it.',
  fields: [
    { key: 'pills', label: 'Pills', type: 'lines', hint: 'One per line, top to bottom; the last line = main pill (navy)' },
    { key: 'tap', label: 'Cursor taps the last pill', type: 'bool' },
  ],
  defaults: (): CtaProps => ({ pills: ['COMMENT', 'DM', 'CHAT NOMOR DI BIO'], tap: true }),
  minDur: 1.5,
  maxDur: 7,
  zone: 'top',
  sceneDefault: false,
  build,
};
