// Tumpukan chip status (gaya .st miva-3/2): pill bernada dengan ikon centang/peringatan/stop + label tebal + keterangan.
// Tiap chip muncul membal di beat berikutnya, cincin menyebar sekali. Cocok untuk "LEAD Saved / FOLLOW-UP Scheduled".
import type { ChipItem, ChipsProps, MotionComponent, ResolvedMotion, MotionSfx } from '../types';
import { beatsOr, cue, esc, exitAt, EXIT_DUR, js, r3, toneClass, toneOf, uid } from '../runtime';
import { chipIcon } from '../icons';

const CSS = `/* chips */
.mv-chips { position: absolute; left: 0; right: 0; top: 235px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.mv-chips .mv-chip { background: linear-gradient(rgba(var(--rgb), 0.16), rgba(var(--rgb), 0.16)), rgba(10, 21, 19, 0.9); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4); }
.mv-chips.s .mv-chip { height: 64px; font-size: 25px; padding: 0 20px; }
.mv-chips.s .mv-chip small { font-size: 23px; }
`;

function build(item: ResolvedMotion<'chips'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const items: ChipItem[] = p.items?.length ? p.items : [];
  const n = items.length;
  const t0 = item.t0;
  const tOut = exitAt(item);

  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap><div class="mv-chips${n > 4 ? ' s' : ''}">` +
    items
      .map(
        (c, k) =>
          `<span class="mv-chip ${toneClass(c.tone, 'green')}" id="${P}-k${k}">${chipIcon(c.icon ?? 'check')}${esc(c.label ?? '')}` +
          `${c.sub ? ` <small>${esc(c.sub)}</small>` : ''}</span>`,
      )
      .join('') +
    `</div></div>`;

  // waktu: rapat dari t0 (0,55 dtk antar chip), beatTimes menimpa
  const first = t0 + 0.05;
  const lastAt = Math.max(first, Math.min(tOut - 0.7, first + 0.55 * (n - 1)));
  const at = n ? beatsOr(item, n, first, lastAt) : [];

  const J: string[] = [];
  const sfx: MotionSfx[] = [];
  items.forEach((c, k) => {
    const t = at[k];
    J.push(`mv.pop("${P}-k${k}", ${t}, 0.28);`);
    J.push(`mv.ring("${P}-k${k}", ${r3(t + 0.1)}, "${toneOf(c.tone, 'green').rgb}");`);
    const kat = c.icon === 'warn' ? 'pop' : c.icon === 'stop' ? 'klik' : 'ding';
    sfx.push(cue(t, kat, -6));
  });
  J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const chips: MotionComponent<'chips'> = {
  kind: 'chips',
  title: 'Status chips',
  description: 'Stack of toned status chips (check / warning / stop) that appear one by one, e.g. LEAD Saved, FOLLOW-UP Scheduled.',
  fields: [{ key: 'items', label: 'Chips', type: 'json', hint: '[{label, sub?, icon: check|warn|stop, tone}]' }],
  defaults: (): ChipsProps => ({
    items: [
      { label: 'LEAD', sub: 'Saved', icon: 'check', tone: 'green' },
      { label: 'FOLLOW-UP', sub: 'Scheduled', icon: 'check', tone: 'green' },
    ],
  }),
  minDur: 1.2,
  maxDur: 6,
  zone: 'top',
  sceneDefault: false,
  build,
};
