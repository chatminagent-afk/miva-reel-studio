// End card layar penuh terang (gaya #end miva-3/4/6): latar #eceff2 + cahaya radial, tanda logo 340 px masuk membal, wordmark
// navy, sub, tagline italic, pill navy bertitik hijau ("Chat nomor di BIO"). Biasanya di atas freeze `edit.tail`.
// Subtitle (#caps) dan kata kunci (#keys) disembunyikan sejak t0 karena DOM-nya di atas overlay.
// Kartu tidak keluar bila t1 = akhir video (DUR); kalau di tengah video, kartu keluar dan #caps/#keys dikembalikan.
//
// Beat (beatTimes, berurutan): wordmark (judul), tagline, pill CTA. Bawaan: t0+0.15, t0+0.35, t0+0.6 (sub menyusul wordmark +0,12).
import type { EndcardProps, MotionComponent, MotionSfx, ResolvedMotion } from '../types';
import { cue, esc, exitAt, r3, uid, withBeats } from '../runtime';
import { logoMark } from '../logo';

const CSS = `/* endcard */
.mv-end { position: absolute; inset: 0; background: #eceff2; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; }
.mv-end-glow { position: absolute; left: 90px; top: 460px; width: 900px; height: 900px; border-radius: 50%;
               background: radial-gradient(closest-side, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 70%); }
.mv-end-tile { position: relative; width: 340px; }
.mv-end-wm { position: relative; margin-top: 30px; font-family: var(--mv-wm); font-size: 150px; font-weight: 800; letter-spacing: 4px; line-height: 1; color: #0f1d33; opacity: 0; }
.mv-end-sub { position: relative; margin-top: 14px; font-family: var(--mv-wm); font-size: 44px; font-weight: 600; letter-spacing: 4px; color: #56637a; opacity: 0; }
.mv-end-tag { position: relative; margin-top: 70px; font-size: 44px; font-weight: 600; font-style: italic; color: #0f1d33; opacity: 0; }
.mv-end-cta { position: relative; margin-top: 30px; display: flex; align-items: center; gap: 14px; height: 80px; padding: 0 36px; border-radius: 40px;
              background: #0f1d33; font-size: 34px; font-weight: 700; color: #fff; opacity: 0; }
.mv-end-cta i { width: 14px; height: 14px; border-radius: 50%; background: #3ddc84; }
`;

function build(item: ResolvedMotion<'endcard'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const hasTag = !!p.tagline;
  const hasCta = !!p.cta;
  const def = [t0 + 0.15, ...(hasTag ? [t0 + 0.35] : []), ...(hasCta ? [t0 + 0.6] : [])];
  const at = withBeats(item, def);
  const tW = at[0];
  const tT = hasTag ? at[1] : -1;
  const tC = hasCta ? at[hasTag ? 2 : 1] : -1;

  const html =
    `<div class="mv-r" id="${P}"><div class="mv-end" id="${P}-e"><div class="mv-end-glow"></div>` +
    `<div class="mv-end-tile" id="${P}-t">${logoMark()}</div>` +
    `<div class="mv-end-wm" id="${P}-w">${esc(p.title ?? '')}</div>` +
    (p.sub ? `<div class="mv-end-sub" id="${P}-s">${esc(p.sub)}</div>` : '') +
    (hasTag ? `<div class="mv-end-tag" id="${P}-g">${esc(p.tagline!)}</div>` : '') +
    (hasCta ? `<div class="mv-end-cta" id="${P}-c"><i></i>${esc(p.cta!)}</div>` : '') +
    `</div></div>`;

  const J: string[] = [];
  const sfx: MotionSfx[] = [cue(t0, 'swish', 0, { align: true })];
  // subtitle & kata kunci di atas overlay: sembunyikan selama kartu
  J.push(`tl.set(["#keys", "#caps"], { opacity: 0 }, ${r3(t0)});`);
  J.push(`tl.fromTo("#${P}-e", { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power2.out", immediateRender: false }, ${r3(t0)});`);
  J.push(`tl.fromTo("#${P}-t", { scale: 0.6, x: -40, opacity: 0 }, { scale: 1, x: 0, opacity: 1, duration: 0.5, ease: "back.out(1.6)", immediateRender: false }, ${r3(t0 + 0.05)});`);
  J.push(`mv.show("${P}-w", ${tW}, 0.32);`);
  if (p.sub) J.push(`mv.show("${P}-s", ${r3(tW + 0.12)}, 0.3);`);
  if (hasTag) J.push(`mv.show("${P}-g", ${tT}, 0.3);`);
  if (hasCta) {
    J.push(`mv.show("${P}-c", ${tC}, 0.3);`);
    sfx.push(cue(tC, 'pop', -8));
  }
  // di akhir video kartu bertahan sampai habis; di tengah video kartu keluar dan #caps/#keys kembali
  const tOut = exitAt(item);
  J.push(`if (${item.t1} < DUR - 0.1) {`);
  J.push(`  tl.to("#${P}-e", { opacity: 0, duration: 0.25, ease: "power2.in" }, ${tOut});`);
  J.push(`  tl.set(["#keys", "#caps"], { opacity: 1 }, ${r3(item.t1)});`);
  J.push(`}`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const endcard: MotionComponent<'endcard'> = {
  kind: 'endcard',
  title: 'End card',
  description: 'Kartu penutup layar penuh terang: tanda logo, wordmark, sub, tagline italic, pill CTA. Menyembunyikan subtitle dan kata kunci.',
  fields: [
    { key: 'title', label: 'Wordmark', type: 'text', hint: 'Mis. MIVA' },
    { key: 'sub', label: 'Sub', type: 'text', hint: 'Mis. AI AUTOMATION' },
    { key: 'tagline', label: 'Tagline', type: 'text', hint: 'Italic, mis. AI Customer Service' },
    { key: 'cta', label: 'Pill CTA', type: 'text', hint: 'Mis. Chat nomor di BIO' },
  ],
  defaults: (): EndcardProps => ({ title: 'MIVA', sub: 'AI AUTOMATION', tagline: 'AI Customer Service', cta: 'Chat nomor di BIO' }),
  minDur: 1.8,
  maxDur: 8,
  zone: 'full',
  sceneDefault: false,
  build,
};
