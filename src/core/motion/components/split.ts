// Dua kartu berdampingan (gaya #bizC / #chatC miva-3 M02): kiri daftar baris berikon (BUSINESS), kanan kartu bernada (CHAT, titik
// merah hidup) yang diisi bubble; `flood` membuat bubble sisi kanan membanjiri sisi kiri (kiri memudar abu-abu, kanan bergaris merah).
//
// Beat (beatTimes, berurutan): kartu kiri, baris kiri 0..L-1, kartu kanan, bubble kanan 0..R-1, awal banjir. Yang tak diberikan
// dibagi otomatis; bubble banjir menyebar rata dari awal banjir sampai ~0,5 dtk sebelum keluar.
import type { IconName, MotionComponent, MotionSfx, ResolvedMotion, SplitProps, SplitSide } from '../types';
import { cue, esc, exitAt, r3, rngFor, toneClass, uid, withBeats } from '../runtime';
import { icon } from '../icons';

const CSS = `/* split */
.mv-sp { position: absolute; top: 205px; height: 400px; width: 450px; padding: 26px 30px; opacity: 0; }
.mv-sp.l { left: 60px; } .mv-sp.r { right: 60px; border-color: rgba(var(--rgb), 0.45); }
.mv-sp-hd { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.10); }
.mv-sp-hd .lb { font-size: 34px; font-weight: 900; letter-spacing: 4px; color: var(--cn); }
.mv-sp-hd .live { width: 18px; height: 18px; border-radius: 50%; background: var(--c); box-shadow: 0 0 14px var(--c); }
.mv-sp-row { display: flex; align-items: center; gap: 20px; height: 92px; font-size: 38px; font-weight: 700; opacity: 0; }
.mv-sp-row .ic { width: 70px; height: 70px; border-radius: 20px; background: var(--mv-s2); display: grid; place-items: center; color: var(--mv-ink); }
.mv-sp-row .ic .mv-i { width: 42px; height: 42px; }
`;

// ikon baris kiri bergilir (Sales, Marketing, Team di miva-3)
const ROW_ICONS: IconName[] = ['box', 'chart', 'team', 'briefcase', 'calendar', 'inbox'];

// posisi bubble (kiri-atas px), dari miva-3: 4 pertama di dalam kartu kanan, sisanya menyebar menutupi kartu kiri
const IN_CARD: [number, number][] = [[600, 300], [690, 390], [610, 480], [760, 530], [560, 340], [740, 450]];
const FLOOD: [number, number][] = [
  [470, 330], [360, 430], [230, 300], [120, 520], [80, 400], [330, 250], [520, 560], [300, 540],
  [130, 250], [820, 260], [470, 440], [210, 470], [420, 230], [640, 225],
];

function side(s: SplitSide | undefined, fallbackTone: 'mint' | 'red'): SplitSide {
  return { title: s?.title ?? '', items: s?.items ?? [], tone: s?.tone ?? fallbackTone };
}

function build(item: ResolvedMotion<'split'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const L = side(p.left, 'mint');
  const R = side(p.right, 'red');
  const nl = L.items.length;
  const nr = R.items.length;
  const flood = p.flood && (p.bubbles?.length ?? 0) > 0 ? p.bubbles! : [];
  const nf = flood.length;

  // ---- waktu ----
  const tLeft = t0 + 0.05;
  const rowT = Array.from({ length: nl }, (_, k) => tLeft + 0.2 + 0.2 * k);
  const tRight = (nl ? rowT[nl - 1] : tLeft) + 0.55;
  const inT = Array.from({ length: nr }, (_, k) => tRight + 0.15 + 0.14 * k);
  const tFlood = (nr ? inT[nr - 1] : tRight) + 0.35;
  const def = [tLeft, ...rowT, tRight, ...inT, ...(nf ? [tFlood] : [])];
  const at = withBeats(item, def);
  const tl0 = at[0];
  const rows = at.slice(1, 1 + nl);
  const tr0 = at[1 + nl];
  const ins = at.slice(2 + nl, 2 + nl + nr);
  const tF = nf ? at[2 + nl + nr] : -1;
  const fEnd = Math.max(tF + 0.3, tOut - 0.5);
  const fT = (k: number) => r3(nf > 1 ? tF + ((fEnd - tF) * k) / (nf - 1) : tF);

  // ---- HTML ----
  const rowsHtml = L.items
    .map((tx, k) => `<div class="mv-sp-row" id="${P}-r${k}"><span class="ic">${icon(ROW_ICONS[k % ROW_ICONS.length])}</span>${esc(tx)}</div>`)
    .join('');
  const rnd = rngFor(item.id);
  const slot = (arr: [number, number][], k: number): [number, number] => {
    const [x, y] = arr[k % arr.length];
    return k < arr.length ? [x, y] : [Math.round(x + (rnd() - 0.5) * 80), Math.round(y + (rnd() - 0.5) * 60)];
  };
  const bub = (tx: string, id: string, [x, y]: [number, number]) =>
    `<div class="mv-fb" id="${id}" data-layout-allow-overlap style="left:${x}px;top:${y}px"><i></i>${esc(tx)}</div>`;
  const inHtml = R.items.map((tx, k) => bub(tx, `${P}-i${k}`, slot(IN_CARD, k))).join('');
  const floodHtml = flood.map((tx, k) => bub(tx, `${P}-f${k}`, slot(FLOOD, k))).join('');
  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap>` +
    `<div class="mv-card mv-sp l ${toneClass(L.tone, 'mint')}" id="${P}-l" data-layout-allow-overlap><div class="mv-sp-hd"><span class="lb">${esc(L.title)}</span></div>${rowsHtml}</div>` +
    `<div class="mv-card mv-sp r ${toneClass(R.tone, 'red')}" id="${P}-r" data-layout-allow-overlap><div class="mv-sp-hd"><span class="lb">${esc(R.title)}</span><i class="live"></i></div></div>` +
    `${inHtml}${floodHtml}</div>`;

  // ---- JS + SFX ----
  const J: string[] = [];
  const sfx: MotionSfx[] = [];
  J.push(`tl.fromTo("#${P}-l", { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.34, ease: "power3.out", immediateRender: false }, ${tl0});`);
  rows.forEach((t, k) => {
    J.push(`tl.fromTo("#${P}-r${k}", { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.25, ease: "power3.out", immediateRender: false }, ${t});`);
    if (k < rows.length - 1) sfx.push(cue(t, 'tick', -8));
  });
  sfx.unshift(cue(tl0, 'swish', -6, { align: true }));
  J.push(`tl.fromTo("#${P}-r", { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.3, ease: "power3.out", immediateRender: false }, ${tr0});`);
  sfx.push(cue(tr0, 'pop', -6));
  ins.forEach((t, k) => {
    J.push(`mv.pop("${P}-i${k}", ${t}, 0.24);`);
    sfx.push(cue(t, 'pop', -10));
  });
  if (nf) {
    flood.forEach((_, k) => J.push(`mv.pop("${P}-f${k}", ${fT(k)}, 0.24);`));
    // kiri memudar abu-abu selama banjir, kanan jadi bergaris merah penuh
    J.push(`tl.to("#${P}-l", { opacity: 0.35, filter: "grayscale(1)", duration: ${r3(fEnd - tF)}, ease: "none" }, ${tF});`);
    J.push(`tl.to("#${P}-r", { borderColor: "rgba(255,107,94,0.9)", duration: 0.3 }, ${tF});`);
    sfx.push(cue(tF, 'whoosh', -6, { align: true }));
  }
  J.push(`tl.to([${['"#' + P + '-l"', '"#' + P + '-r"', ...R.items.map((_, k) => `"#${P}-i${k}"`), ...flood.map((_, k) => `"#${P}-f${k}"`)].join(', ')}], { opacity: 0, y: -30, duration: 0.24, ease: "power2.in" }, ${tOut});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const split: MotionComponent<'split'> = {
  kind: 'split',
  title: 'Dua kartu (split)',
  description: 'Dua kartu berdampingan: kiri daftar baris berikon, kanan kartu bernada berisi bubble; opsional bubble kanan membanjiri kiri.',
  fields: [
    { key: 'left.title', label: 'Judul kiri', type: 'text' },
    { key: 'left.items', label: 'Baris kiri', type: 'lines', hint: 'Satu per baris; ikon bergilir otomatis' },
    { key: 'left.tone', label: 'Nada kiri', type: 'tone' },
    { key: 'right.title', label: 'Judul kanan', type: 'text' },
    { key: 'right.items', label: 'Bubble di kartu kanan', type: 'lines' },
    { key: 'right.tone', label: 'Nada kanan', type: 'tone' },
    { key: 'flood', label: 'Banjir ke kartu kiri', type: 'bool' },
    { key: 'bubbles', label: 'Bubble banjir', type: 'lines', hint: 'Menyebar menutupi kartu kiri' },
  ],
  defaults: (): SplitProps => ({
    left: { title: 'BUSINESS', items: ['Sales', 'Marketing', 'Team'], tone: 'mint' },
    right: { title: 'CHAT', items: ['Harga?', 'Ready kak?', 'Ongkir?', 'Promo?'], tone: 'red' },
    flood: true,
    bubbles: ['Kak?', 'Bisa COD?', 'Halo?', 'Masih buka?', 'Stok ada?', 'P', 'Kak??', 'Bisa kirim?', 'Harga?', 'Booking?', 'Halo kak', 'Diskon?', '??', 'Jam buka?'],
  }),
  minDur: 3,
  maxDur: 10,
  zone: 'top',
  sceneDefault: false,
  build,
};
