// Notifikasi bertubi-tubi di sekitar kepala (gaya .nm miva-3/6): pill putih + lingkaran hijau berikon, kiri/kanan bergantian.
// Posisi slot dari miva-3 (kiri/kanan luar wajah, y 330-960); lebih dari 6 item memakai slot tambahan di sisi yang sama.
import type { MotionComponent, ResolvedMotion, ToastsProps, MotionSfx } from '../types';
import { beatsOr, cue, esc, exitAt, r3, uid } from '../runtime';
import { icon } from '../icons';

// [sisi, jarak dari tepi, y]
const SLOTS: ['l' | 'r', number, number][] = [
  ['l', 70, 330], ['r', 70, 440], ['l', 30, 640], ['r', 30, 740], ['l', 30, 870], ['r', 30, 960],
  ['l', 50, 520], ['r', 50, 560], ['l', 40, 770], ['r', 40, 860],
];

const CSS = `/* toasts */
.mv-nm { position: absolute; display: flex; align-items: center; gap: 12px; height: 66px; padding: 0 22px 0 9px; border-radius: 33px; white-space: nowrap;
         background: rgba(255, 255, 255, 0.97); color: #111; font-size: 25px; font-weight: 900; letter-spacing: 1px; opacity: 0;
         box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4); }
.mv-nm.n { height: 70px; padding: 0 24px 0 10px; font-size: 26px; font-weight: 700; letter-spacing: 0; }
.mv-nm b { font-weight: 900; }
.mv-nm .wa { width: 48px; height: 48px; border-radius: 50%; background: #25a35a; display: grid; place-items: center; flex: none; color: #fff; }
.mv-nm.n .wa { width: 50px; height: 50px; }
.mv-nm .wa .mv-i { width: 28px; height: 28px; stroke-width: 3; }
.mv-nm .wa .mv-i.f { fill: #fff; stroke: none; }
.mv-nm .wa .mv-mk { width: 32px; }
`;

// bubble chat terisi (sama dengan ikon toast skill); ikon lain memakai garis putih
const BUBBLE_FILLED =
  '<svg class="mv-i f" viewBox="0 0 40 40"><path d="M9 11h22a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H18l-6 5v-5H9a3 3 0 0 1-3-3V14a3 3 0 0 1 3-3z"/></svg>';

function build(item: ResolvedMotion<'toasts'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const items = p.items?.length ? p.items : ['NEW MESSAGE'];
  const n = items.length;
  const tOut = exitAt(item);
  const t0 = item.t0;
  const ic = !p.icon || p.icon === 'bubble' ? BUBBLE_FILLED : icon(p.icon);

  // waktu: rapat di awal (maks 0,6 dtk antar toast), beatTimes menimpa
  const last = Math.max(t0, Math.min(tOut - 0.6, t0 + 0.6 * (n - 1)));
  const at = beatsOr(item, n, t0, last);

  const parts = items.map((raw, k) => {
    const [side, off, y] = SLOTS[k % SLOTS.length];
    const named = raw.includes('|');
    const label = named
      ? `<b>${esc(raw.split('|')[0].trim())}</b>${esc(raw.slice(raw.indexOf('|') + 1).trim())}`
      : esc(raw);
    return `<div class="mv-nm${named ? ' n' : ''}" id="${P}-k${k}" data-layout-allow-overlap style="${side === 'l' ? 'left' : 'right'}:${off}px;top:${y}px">` +
      `<span class="wa">${ic}</span>${label}</div>`;
  });
  const html = `<div class="mv-r" id="${P}" data-layout-allow-overlap>${parts.join('')}</div>`;

  const J: string[] = [];
  const sfx: MotionSfx[] = [];
  items.forEach((_, k) => {
    const [side] = SLOTS[k % SLOTS.length];
    const t = at[k];
    J.push(`mv.slide("${P}-k${k}", ${t}, ${side === 'l' ? -90 : 90}, 0.28);`);
    if (p.shake) J.push(`tl.fromTo("#${P}-k${k} .wa", { rotation: 0 }, { rotation: 14, duration: 0.04, yoyo: true, repeat: 5, ease: "none", immediateRender: false }, ${t});`);
    J.push(`tl.to("#${P}-k${k}", { y: -6, duration: 0.4, yoyo: true, repeat: 3, ease: "sine.inOut" }, ${r3(t + 0.3)});`);
    sfx.push(cue(t, 'pop', -8));
  });
  // keluar bersama, berurutan tipis (selesai di t1)
  const tx = r3(Math.max(t0 + 0.1, item.t1 - 0.22 - 0.02 * (n - 1)));
  J.push(
    `tl.to([${items.map((_, k) => `"#${P}-k${k}"`).join(', ')}], { opacity: 0, scale: 0.85, duration: 0.22, ease: "power2.in", stagger: 0.02 }, ${tx});`,
  );
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const toasts: MotionComponent<'toasts'> = {
  kind: 'toasts',
  title: 'Notifikasi bertubi',
  description: 'Pill notifikasi putih muncul bergantian kiri/kanan di sekitar kepala (mis. NEW MESSAGE x6).',
  fields: [
    { key: 'items', label: 'Isi notifikasi', type: 'lines', hint: 'Satu per baris. "Nama | pesan" = nama tebal + pesan' },
    { key: 'icon', label: 'Ikon', type: 'icon' },
    { key: 'shake', label: 'Ikon bergetar saat masuk', type: 'bool' },
  ],
  defaults: (): ToastsProps => ({ items: Array.from({ length: 6 }, () => 'NEW MESSAGE'), icon: 'bubble', shake: true }),
  minDur: 1.5,
  maxDur: 6,
  zone: 'top',
  sceneDefault: false,
  build,
};
