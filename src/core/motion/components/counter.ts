// Pill angka berjalan (gaya #cnt miva-3/6): lingkaran ikon bernada + angka besar + label ("12 -> 27 -> 43 UNREAD MESSAGES").
// Angka tidak dihitung dari waktu: tiap nilai antara (hitung naik 0,3 dtk) adalah span sendiri yang di-set display lewat tl.set.
import type { CounterProps, MotionComponent, ResolvedMotion, MotionSfx } from '../types';
import { cue, esc, exitAt, EXIT_DUR, js, r3, toneClass, uid } from '../runtime';
import { icon } from '../icons';

const CSS = `/* counter */
.mv-cnt-w { position: absolute; left: 0; right: 0; top: 205px; display: flex; justify-content: center; opacity: 0; }
.mv-cnt-p { display: flex; align-items: center; gap: 16px; height: 84px; padding: 0 34px 0 16px; border-radius: 42px; background: var(--mv-card);
            border: 2px solid rgba(var(--rgb), 0.6); font-size: 30px; font-weight: 800; letter-spacing: 1.5px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45); }
.mv-cnt-ph { width: 58px; height: 58px; border-radius: 50%; background: var(--cb); display: grid; place-items: center; color: #fff; }
.mv-cnt-ph .mv-i { width: 34px; height: 34px; stroke-width: 3; }
.mv-cnt-ph .mv-mk { width: 40px; }
.mv-cnt-n { display: inline-block; text-align: right; font-size: 48px; font-weight: 900; color: var(--cn); font-variant-numeric: tabular-nums; }
.mv-cnt-s { display: none; }
`;

interface Step {
  v: number;
  t: number;
}

/** Urutan nilai tampil: nilai awal, lalu tiap perubahan dipecah jadi langkah hitung-naik singkat (maks 6 langkah, 0,3 dtk). */
function steps(values: number[], changeAt: number[]): Step[] {
  const out: Step[] = [{ v: values[0], t: -1 }];
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    const n = Math.max(1, Math.min(6, Math.abs(b - a)));
    for (let s = 1; s <= n; s++) out.push({ v: s === n ? b : Math.round(a + ((b - a) * s) / n), t: r3(changeAt[i - 1] + (0.3 * (s - 1)) / n) });
  }
  return out;
}

function build(item: ResolvedMotion<'counter'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const values = p.values?.length ? p.values : [0];
  const n = values.length - 1;

  // waktu tiap perubahan nilai: beatTimes sebanyak nilai (beat pertama = nilai awal) atau sebanyak perubahan; kalau tidak, dibagi rata
  const given = (item.beatTimes ?? []).filter((x) => Number.isFinite(x));
  const L = Math.max(0.5, tOut - t0);
  let at: number[];
  if (n === 0) at = [];
  else if (given.length >= values.length) at = given.slice(1, values.length);
  else if (given.length >= n) at = given.slice(0, n);
  else at = Array.from({ length: n }, (_, i) => t0 + (L * (i + 1)) / (n + 1));
  at = at.map((x) => r3(Math.max(t0 + 0.2, Math.min(tOut - 0.45, x))));

  const seq = steps(values, at);
  const digits = Math.max(...values.map((v) => String(Math.round(v)).length));
  const spans = seq
    .map((s, k) => `<span class="mv-cnt-s" id="${P}-v${k}"${k === 0 ? ' style="display:inline"' : ''}>${esc(String(s.v))}</span>`)
    .join('');

  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap><div class="mv-cnt-w ${toneClass(p.tone, 'red')}" id="${P}-w">` +
    `<div class="mv-cnt-p"><span class="mv-cnt-ph" id="${P}-ic">${icon(p.icon ?? 'phone')}</span>` +
    `<span class="mv-cnt-n" id="${P}-n" style="min-width:${digits * 29 + 6}px">${spans}</span>${esc(p.label ?? '')}</div></div></div>`;

  const J: string[] = [];
  J.push(`mv.pop("${P}-w", ${r3(t0)}, 0.3);`);
  for (let k = 1; k < seq.length; k++) {
    J.push(`tl.set("#${P}-v${k - 1}", { display: "none" }, ${seq[k].t});`);
    J.push(`tl.set("#${P}-v${k}", { display: "inline" }, ${seq[k].t});`);
  }
  const sfx: MotionSfx[] = [cue(t0, 'pop', -6)];
  at.forEach((t, i) => {
    J.push(`mv.bump("${P}-n", ${t}, 1.35);`);
    J.push(`tl.fromTo("#${P}-ic", { rotation: 0 }, { rotation: 14, duration: 0.04, yoyo: true, repeat: 5, ease: "none", immediateRender: false }, ${t});`);
    sfx.push(cue(t, 'tick', i === at.length - 1 ? -2 : -4));
  });
  J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const counter: MotionComponent<'counter'> = {
  kind: 'counter',
  title: 'Counter angka',
  description: 'Pill angka berjalan (mis. 12 -> 27 -> 43 UNREAD MESSAGES); tiap nilai berganti di beat berikutnya dengan hitung-naik singkat.',
  fields: [
    { key: 'label', label: 'Label', type: 'text', hint: 'Mis. UNREAD MESSAGES' },
    { key: 'icon', label: 'Ikon', type: 'icon' },
    { key: 'tone', label: 'Nada', type: 'tone' },
    { key: 'values', label: 'Nilai', type: 'numbers', hint: 'Urut; nilai pertama tampil saat masuk, sisanya di beat' },
  ],
  defaults: (): CounterProps => ({ label: 'UNREAD MESSAGES', icon: 'phone', tone: 'red', values: [12, 27, 43] }),
  minDur: 1.5,
  maxDur: 6,
  zone: 'top',
  sceneDefault: false,
  build,
};
