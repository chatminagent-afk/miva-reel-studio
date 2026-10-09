// Kartu logo MIVA gelap (gaya #lg miva-3/4/6): tanda gradien + wordmark + sub, lalu pill tagline bergaris cyan.
// `gather` = bubble ditarik ke tengah dulu (M07 miva-3), logo muncul saat bubble tiba, dengan kilat putih.
import type { LogoProps, MotionComponent, ResolvedMotion, MotionSfx } from '../types';
import { cue, esc, exitAt, r3, uid } from '../runtime';
import { icon } from '../icons';
import { logoMark } from '../logo';

const CSS = `/* logo */
.mv-lg { position: absolute; left: 0; right: 0; top: 260px; display: flex; justify-content: center; opacity: 0; }
.mv-lg-card { display: flex; align-items: center; gap: 26px; padding: 22px 46px 22px 22px; }
.mv-lg-card .mv-mk { width: 150px; flex: none; }
.mv-lg-card b { display: block; font-family: var(--mv-wm); font-size: 72px; font-weight: 800; letter-spacing: 2px; line-height: 1; color: #fff; }
.mv-lg-card small { display: block; font-family: var(--mv-wm); font-size: 22px; font-weight: 600; letter-spacing: 3px; color: #a9b8c9; margin-top: 8px; }
.mv-lg-tag { position: absolute; left: 0; right: 0; top: 470px; display: flex; justify-content: center; opacity: 0; }
.mv-lg-tag span { height: 70px; display: flex; align-items: center; padding: 0 34px; border-radius: 35px; background: rgba(10, 21, 19, 0.86);
                  border: 2.5px solid var(--mv-cyan); color: #fff; font-family: var(--mv-wm); font-size: 30px; font-weight: 700; letter-spacing: 4px; }
.mv-gb { position: absolute; width: 84px; height: 84px; border-radius: 42px; background: #fff; display: grid; place-items: center; opacity: 0;
         box-shadow: 0 10px 26px rgba(0, 0, 0, 0.4); color: #111; }
.mv-gb .mv-i { width: 46px; height: 46px; stroke-width: 2.8; }
`;

// posisi bubble yang ditarik (kiri-atas px), dari miva-3: tersebar di sisi dan atas, di luar kartu
const GB: [number, number][] = [[90, 250], [900, 230], [60, 520], [930, 480], [200, 760], [800, 760], [40, 960], [950, 930], [330, 200], [660, 190]];
const CX = 540;
const CY = 380;

function build(item: ResolvedMotion<'logo'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const gather = !!p.gather;

  // waktu: beat[0] = logo muncul, beat[1] = tagline. Tanpa beat: logo langsung (atau 0,78 dtk setelah bubble mulai ditarik)
  const given = (item.beatTimes ?? []).filter((x) => Number.isFinite(x));
  const tL = r3(Math.min(tOut - 0.6, given[0] ?? t0 + (gather ? 0.78 : 0.05)));
  const tG = r3(Math.max(t0, tL - 0.78));
  const tTag = r3(Math.min(tOut - 0.35, given[1] ?? tL + 0.34));

  const gb = gather
    ? GB.map(([x, y], k) => `<div class="mv-gb" id="${P}-g${k}" style="left:${x}px;top:${y}px">${icon('bubble')}</div>`).join('')
    : '';
  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap>${gb}` +
    `<div class="mv-lg" id="${P}-lg"><div class="mv-lg-card mv-card">${logoMark()}` +
    `<div><b>MIVA</b>${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</div></div></div>` +
    (p.tagline ? `<div class="mv-lg-tag" id="${P}-tg"><span>${esc(p.tagline)}</span></div>` : '') +
    `</div>`;

  const J: string[] = [];
  const sfx: MotionSfx[] = [];
  if (gather) {
    GB.forEach(([x, y], k) => {
      J.push(`mv.pop("${P}-g${k}", ${r3(tG + k * 0.025)}, 0.2);`);
      J.push(`tl.to("#${P}-g${k}", { x: ${CX - 42 - x}, y: ${CY - 42 - y}, scale: 0.3, duration: 0.5, ease: "power3.in" }, ${r3(tG + 0.25 + k * 0.02)});`);
      J.push(`tl.to("#${P}-g${k}", { opacity: 0, duration: 0.08, ease: "none" }, ${r3(tG + 0.72 + k * 0.02)});`);
    });
    sfx.push(cue(tG, 'whoosh', -6, { align: true }));
  }
  J.push(`tl.fromTo("#${P}-lg", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.42, ease: "back.out(1.8)", immediateRender: false }, ${tL});`);
  J.push(`tl.fromTo("#${P}-lg .mv-mk", { x: -30, scale: 0.7 }, { x: 0, scale: 1, duration: 0.6, ease: "power3.out", immediateRender: false }, ${tL});`);
  J.push(`mv.flash(${tL}, 0.25);`);
  sfx.push(cue(tL, 'ding', -6));
  if (p.tagline) J.push(`tl.fromTo("#${P}-tg", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, ${tTag});`);
  J.push(`tl.to([${['"#' + P + '-lg"', ...(p.tagline ? ['"#' + P + '-tg"'] : [])].join(', ')}], { opacity: 0, y: -30, duration: 0.22, ease: "power2.in" }, ${tOut});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const logo: MotionComponent<'logo'> = {
  kind: 'logo',
  title: 'Logo card',
  description: 'Dark MIVA logo card (gradient mark + wordmark + sub) with a tagline pill; optionally bubbles are pulled to the center first.',
  fields: [
    { key: 'sub', label: 'Wordmark sub', type: 'text', hint: 'E.g. AI AUTOMATION' },
    { key: 'tagline', label: 'Tagline', type: 'text', hint: 'Cyan-outlined pill below the card (optional)' },
    { key: 'gather', label: 'Bubbles pulled to the center first', type: 'bool' },
  ],
  defaults: (): LogoProps => ({ sub: 'AI AUTOMATION', tagline: 'AI CUSTOMER SERVICE', gather: false }),
  minDur: 1.2,
  maxDur: 4.5,
  zone: 'top',
  sceneDefault: false,
  build,
};
