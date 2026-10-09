// Ganti A jadi B (gaya #repA / #repB miva-2 M07): kartu A dengan teks lama dicoret garis merah + lingkaran X merah, lalu kartu B
// (teks baru) masuk bergaris mint dengan lingkaran centang hijau. Satu grafik besar dalam satu waktu: A keluar saat B masuk.
//
// Beat (beatTimes, berurutan): waktu coretan A, waktu B masuk. Bawaan: coretan ~30% durasi (min 0,8 dtk), B 0,75 dtk sesudahnya.
import type { MotionComponent, MotionSfx, ResolvedMotion, ToggleProps } from '../types';
import { cue, esc, exitAt, EXIT_DUR, js, r3, uid, withBeats } from '../runtime';
import { chipIcon } from '../icons';

const CSS = `/* toggle */
.mv-tg { position: absolute; left: 0; right: 0; top: 330px; display: flex; justify-content: center; opacity: 0; }
.mv-tg-i { position: relative; display: flex; align-items: center; gap: 22px; height: 120px; padding: 0 40px; font-size: 52px; font-weight: 900; letter-spacing: 1px; }
.mv-tg-i .tx { position: relative; white-space: nowrap; }
.mv-tg-i .bar { position: absolute; left: -10px; right: -10px; top: 54%; height: 6px; margin-top: -3px; border-radius: 3px; background: var(--mv-red);
                clip-path: inset(-12px 100% -12px -12px); box-shadow: 0 3px 12px rgba(255, 107, 94, 0.5); transform: rotate(-2deg); }
.mv-tg-i .x, .mv-tg-i .v { width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; flex: none; color: #fff; }
.mv-tg-i .x { background: var(--mv-red); opacity: 0; }
.mv-tg-i .v { background: var(--mv-green); }
.mv-tg-i .x .mv-i, .mv-tg-i .v .mv-i { width: 38px; height: 38px; stroke-width: 5; }
.mv-tg-i.a { border-color: rgba(255, 107, 94, 0.6); }
.mv-tg-i.b { border-color: rgba(187, 225, 212, 0.7); box-shadow: 0 0 50px rgba(187, 225, 212, 0.18), 0 24px 60px rgba(0, 0, 0, 0.45); }
`;

/** X sederhana di dalam lingkaran merah (tanpa lingkaran luar ikon stop). */
const X_ICON = '<svg class="mv-i" viewBox="0 0 40 40"><path d="M12 12l16 16M28 12L12 28"/></svg>';

/** Ukuran font supaya teks muat di kartu: perkiraan lebar = huruf * 0.62 * ukuran. */
function fs(text: string): number {
  const len = Math.max(1, Array.from(text).length);
  return Math.max(30, Math.min(52, Math.floor(760 / (len * 0.62))));
}

function build(item: ResolvedMotion<'toggle'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const L = Math.max(1, tOut - t0);
  const tS0 = Math.min(t0 + Math.max(0.8, L * 0.3), tOut - 1.2);
  const [tS, tB] = withBeats(item, [tS0, tS0 + 0.75]);
  const from = p.from ?? '';
  const to = p.to ?? '';

  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap>` +
    `<div class="mv-tg" id="${P}-a"><div class="mv-card mv-tg-i a"><span class="tx" id="${P}-ax" style="font-size:${fs(from)}px">${esc(from)}<i class="bar" id="${P}-bar"></i></span>` +
    `<span class="x" id="${P}-x">${X_ICON}</span></div></div>` +
    `<div class="mv-tg" id="${P}-b"><div class="mv-card mv-tg-i b"><span class="tx" style="font-size:${fs(to)}px">${esc(to)}</span>` +
    `<span class="v">${chipIcon('check')}</span></div></div></div>`;

  const J: string[] = [];
  const sfx: MotionSfx[] = [cue(t0, 'pop', -6)];
  J.push(`mv.pop("${P}-a", ${r3(t0)}, 0.3);`);
  J.push(`tl.fromTo("#${P}-x", { opacity: 0, scale: 2 }, { opacity: 1, scale: 1, duration: 0.22, ease: "power4.out", immediateRender: false }, ${tS});`);
  // coretan disapu lewat clip-path (bukan scaleX(0): matriks singular merusak parsing transform GSAP)
  J.push(
    `tl.fromTo("#${P}-bar", { clipPath: "inset(-12px 100% -12px -12px)" }, ` +
      `{ clipPath: "inset(-12px -12px -12px -12px)", duration: 0.25, ease: "power2.out", immediateRender: false }, ${r3(tS + 0.05)});`,
  );
  J.push(`tl.to("#${P}-ax", { color: "#8a929b", duration: 0.25 }, ${r3(tS + 0.1)});`);
  sfx.push(cue(tS, 'klik', -2));
  J.push(`tl.to("#${P}-a", { opacity: 0, y: -40, duration: 0.2, ease: "power2.in" }, ${r3(Math.max(tS + 0.3, tB - 0.1))});`);
  J.push(`tl.fromTo("#${P}-b", { opacity: 0, y: 40, scale: 0.85 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: "back.out(1.8)", immediateRender: false }, ${tB});`);
  sfx.push(cue(tB, 'swish', -6, { align: true }), cue(tB + 0.1, 'ding', -4));
  J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const toggle: MotionComponent<'toggle'> = {
  kind: 'toggle',
  title: 'Toggle (before/after)',
  description: 'Card A is struck through in red with an X, then card B enters with a checkmark (e.g. "Balas manual" becomes "Dibalas otomatis").',
  fields: [
    { key: 'from', label: 'Old text (struck through)', type: 'text' },
    { key: 'to', label: 'New text (checked)', type: 'text' },
  ],
  defaults: (): ToggleProps => ({ from: 'Balas manual', to: 'Dibalas otomatis' }),
  minDur: 2,
  maxDur: 6,
  zone: 'top',
  sceneDefault: false,
  build,
};
