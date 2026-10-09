// Rantai node ikon + label dengan penghubung (gaya #chA/#chB miva-3, juga #r9 dan #flow miva-6): CUSTOMER > YOU > YOU,
// node `alert` memerah dan bergetar, lalu morph jadi rantai kedua (CUSTOMER > MIVA > DONE) dan pill kalimat di bawahnya.
// Node ber-ikon 'bubble' tanpa label = bubble kecil putih pemisah (gaya skill); node 'logo' = tanda MIVA di tile terang bercincin cyan.
import type { ChainNode, ChainProps, MotionComponent, ResolvedMotion, MotionSfx } from '../types';
import { cue, esc, exitAt, EXIT_DUR, js, markup, r3, uid } from '../runtime';
import { icon } from '../icons';

const CSS = `/* chain */
.mv-chain-fit { position: absolute; left: 0; right: 0; top: 215px; display: flex; justify-content: center; transform-origin: 50% 0; }
.mv-chain { display: flex; justify-content: center; align-items: flex-start; gap: var(--g, 30px); }
.mv-cn { position: relative; width: 120px; display: flex; flex-direction: column; align-items: center; gap: 10px; font-size: 21px; font-weight: 900;
         letter-spacing: 1.2px; color: #fff; opacity: 0; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8); white-space: nowrap; }
.mv-cn .ic { position: relative; width: 104px; height: 104px; border-radius: 30px; background: var(--mv-card); border: 2.5px solid var(--mv-cline);
             display: grid; place-items: center; box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45); color: var(--mv-ink); }
.mv-cn .ic .mv-i { width: 58px; height: 58px; }
.mv-cn + .mv-cn::before { content: ""; position: absolute; left: calc(2px - var(--g, 30px)); top: 50px; width: calc(var(--g, 30px) - 4px); height: 4px;
                          border-radius: 2px; background: var(--mv-mint); }
.mv-cn.bb .ic { width: 80px; height: 80px; margin-top: 12px; border-radius: 40px; background: #fff; border-color: #fff; color: #111; }
.mv-cn.bb .ic .mv-i { width: 44px; height: 44px; }
.mv-cn.t-mint .ic { background: #f4f6f8; border-color: #fff; color: #111; }
.mv-cn.t-red .ic { background: #ffd9d5; border-color: var(--mv-red); color: #111; }
.mv-cn.t-amber .ic { background: #ffe9c7; border-color: var(--mv-amber); color: #111; }
.mv-cn.t-gold .ic { border-color: var(--mv-gold); }
.mv-cn.t-cyan .ic { background: #eef2f6; border-color: var(--mv-cyan); color: #111; box-shadow: 0 0 0 8px rgba(34, 214, 238, 0.18), 0 16px 36px rgba(0, 0, 0, 0.45); }
.mv-cn.t-cyan .ic .mv-mk { width: 80px; }
.mv-cn .ic .mv-mk { width: 80px; }
.mv-cn.t-green .ic { background: var(--mv-green); border-color: #7ef0b5; color: #fff; }
.mv-cn.t-green .ic .mv-i { stroke-width: 4.5; }
.mv-cap { top: 420px; }
`;

const GAP = (n: number) => (n <= 4 ? 46 : n === 5 ? 38 : 30);

interface Built {
  html: string;
  ids: string[];
  /** indeks node (di deret ini) yang berlabel/utama (bukan pemisah bubble) */
  main: boolean[];
  ok: boolean[];
}

function chainHtml(P: string, key: string, nodes: ChainNode[]): Built {
  const n = nodes.length;
  const g = GAP(n);
  const ids: string[] = [];
  const main: boolean[] = [];
  const ok: boolean[] = [];
  let total = (n - 1) * g;
  const cells = nodes.map((nd, k) => {
    const label = nd.label ?? '';
    const bb = nd.icon === 'bubble' && !label.trim();
    const est = label.length * 16.5;
    const w = est > 134 ? Math.ceil(est) + 8 : 120;
    total += w;
    const id = `${P}-${key}${k}`;
    ids.push(id);
    main.push(!bb);
    ok.push(!bb && (nd.tone === 'green' || nd.icon === 'check'));
    // 'bubble' berlabel = node biasa; tone mengikuti prop, 'logo' otomatis cyan
    const tone = nd.icon === 'logo' && !nd.tone ? 'cyan' : nd.tone;
    const cls = ['mv-cn', bb ? 'bb' : '', tone && tone !== 'dark' ? 't-' + tone : ''].filter(Boolean).join(' ');
    return (
      `<div class="${cls}" id="${id}" style="width:${w}px"><span class="ic">${icon(nd.icon)}</span>` +
      `${bb ? '' : `<span class="lbl">${esc(label)}</span>`}</div>`
    );
  });
  const k = Math.min(1, 1000 / Math.max(1, total));
  const fit = k < 1 ? ` style="transform:scale(${r3(k)})"` : '';
  const html = `<div class="mv-chain-fit"${fit}><div class="mv-chain" id="${P}-${key}" style="--g:${g}px">${cells.join('')}</div></div>`;
  return { html, ids, main, ok };
}

function build(item: ResolvedMotion<'chain'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const nodes = p.nodes ?? [];
  const morph = p.morph?.length ? p.morph : null;
  const alert = (p.alert ?? []).filter((i) => i >= 0 && i < nodes.length);
  const A = chainHtml(P, 'a', nodes);
  const B = morph ? chainHtml(P, 'b', morph) : null;

  const cap = p.caption
    ? `<div class="mv-pill mv-cap" id="${P}-cap"><span>${markup(p.caption, { accent: p.captionAccent }, (_k, hit) => `<em>${hit}</em>`)}</span></div>`
    : '';
  const html = `<div class="mv-r" id="${P}" data-layout-allow-overlap>${A.html}${B ? B.html : ''}${cap}</div>`;

  // ---- waktu: node rapat (0,13 dtk), lalu alert, morph, caption; beatTimes menimpa berurutan ----
  const nA = nodes.length;
  const nodeT = Array.from({ length: nA }, (_, k) => t0 + 0.05 + 0.13 * k);
  const nodesEnd = nA ? nodeT[nA - 1] + 0.3 : t0 + 0.3;
  const hasAlert = alert.length > 0 && !!morph;
  let tAlert = -1;
  let tMorph = -1;
  let tCap = -1;
  if (morph) {
    tAlert = nodesEnd + 0.35;
    tMorph = hasAlert ? tAlert + 0.65 : nodesEnd + 0.4;
    tCap = tMorph + 0.6;
  } else {
    tCap = nodesEnd - 0.1;
    if (alert.length) tAlert = nodesEnd + 0.25;
  }
  // padatkan bila melewati batas (sisakan 0,5 dtk sebelum keluar)
  const lastRaw = Math.max(tAlert, tMorph, p.caption ? tCap : -1);
  const room = tOut - 0.5;
  if (lastRaw > room) {
    const f = Math.max(0.3, (room - nodesEnd) / Math.max(0.01, lastRaw - nodesEnd));
    const sq = (x: number) => (x < 0 ? x : nodesEnd + (x - nodesEnd) * f);
    tAlert = sq(tAlert);
    tMorph = sq(tMorph);
    tCap = sq(tCap);
  }
  // beatTimes: simpul node A, lalu (bila ada) alert, morph, caption
  const given = (item.beatTimes ?? []).filter((x) => Number.isFinite(x));
  let gi = 0;
  const take = (def: number): number => {
    const v = gi < given.length ? given[gi] : def;
    gi++;
    return v;
  };
  const tNodes = nodeT.map((d) => r3(take(d)));
  if (hasAlert || (!morph && alert.length)) tAlert = take(tAlert);
  if (morph) tMorph = take(tMorph);
  if (p.caption) tCap = take(tCap);
  const clampT = (x: number) => r3(Math.max(t0, Math.min(tOut - 0.3, x)));

  const J: string[] = [];
  const sfx: MotionSfx[] = [];
  A.ids.forEach((id, k) => {
    J.push(`mv.pop("${id}", ${clampT(tNodes[k])}, 0.26);`);
    if (A.main[k]) sfx.push(cue(clampT(tNodes[k]), 'pop', -8));
  });
  if (alert.length && tAlert >= 0) {
    const ta = clampT(tAlert);
    for (const i of alert) {
      const sel = `#${A.ids[i]} .ic`;
      J.push(`tl.to("${sel}", { backgroundColor: "#ffd9d5", borderColor: "#ff6b5e", color: "#111", duration: 0.15 }, ${ta});`);
      J.push(`mv.shake("${sel}", ${ta}, 6, 7);`);
    }
    sfx.push(cue(ta, 'tick', -4));
  }
  if (B && morph) {
    const tm = clampT(tMorph);
    J.push(`tl.to("#${P}-a", { opacity: 0, scale: 0.85, filter: "blur(10px)", duration: 0.24, ease: "power2.in" }, ${tm});`);
    let extra = 0;
    let okAt = -1;
    B.ids.forEach((id, k) => {
      const base = tm + 0.12 + k * 0.1 + extra;
      if (B.ok[k]) {
        extra += 0.1;
        const at = clampT(base + 0.1);
        okAt = at;
        J.push(`tl.fromTo("#${id}", { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)", immediateRender: false }, ${at});`);
      } else {
        J.push(`mv.pop("${id}", ${clampT(base)}, 0.3);`);
      }
    });
    sfx.push(cue(tm, 'swish', -4, { align: true }));
    if (okAt >= 0) sfx.push(cue(okAt, 'ding', -4));
  }
  if (p.caption) J.push(`mv.show("${P}-cap", ${clampT(tCap)}, 0.32);`);
  J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const chain: MotionComponent<'chain'> = {
  kind: 'chain',
  title: 'Flow chain',
  description: 'Chain of icon + label nodes (CUSTOMER > YOU > YOU); nodes can turn red, then morph into a second chain (CUSTOMER > MIVA > DONE) + a sentence pill.',
  fields: [
    { key: 'nodes', label: 'Nodes', type: 'json', hint: "[{label, icon, tone?}]; icon 'bubble' with no label = divider bubble" },
    { key: 'alert', label: 'Red nodes (indexes)', type: 'numbers', hint: 'Indexes into nodes; they shake before the morph' },
    { key: 'morph', label: 'Second chain (morph)', type: 'json', hint: 'Same as nodes; empty = no morph' },
    { key: 'caption', label: 'Bottom sentence', type: 'text' },
    { key: 'captionAccent', label: 'Highlighted words in the sentence', type: 'lines' },
  ],
  defaults: (): ChainProps => ({
    nodes: [
      { label: 'CUSTOMER', icon: 'person' },
      { label: '', icon: 'bubble' },
      { label: 'YOU', icon: 'person', tone: 'mint' },
      { label: '', icon: 'bubble' },
      { label: 'YOU', icon: 'person', tone: 'mint' },
      { label: '', icon: 'bubble' },
    ],
    alert: [2, 4],
    morph: [
      { label: 'CUSTOMER', icon: 'person' },
      { label: '', icon: 'bubble' },
      { label: 'MIVA', icon: 'logo', tone: 'cyan' },
      { label: 'DONE', icon: 'check', tone: 'green' },
    ],
    caption: 'Your system should work too.',
    captionAccent: ['work too.'],
  }),
  minDur: 2,
  maxDur: 7,
  zone: 'top',
  sceneDefault: false,
  build,
};
