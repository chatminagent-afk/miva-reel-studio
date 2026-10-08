// Port skill reel-edit `build_html.py`: timing.json + captions.json + edit.json + template -> index.html + cues.json.
//
// SFX otomatis (aturan Steven 03/10: bunyi mengikuti cara teks muncul):
//   subtitle "type"  -> ketik (dipangkas sepanjang durasi ketik)      subtitle "pop" -> klik
//   kunci "slam"     -> whoosh (puncaknya jatuh di kata) [+ hit]       kunci "blur"   -> swish     kunci "type" -> ketik
//   intro            -> riser yang puncaknya jatuh di kata kunci pertama (<= 5 dtk) atau di potongan pertama
//   whip/insert      -> whoosh
// Kepadatan: klik/ketik dilewati kalau < 0,30 dtk dari SFX sebelumnya; boom maks 1 per video.
import { CPS } from './captions';
import type { MotionSfx } from './motion/types';
import { pyFixed, pyLen, pyRound } from './py';
import type {
  CamStep,
  CaptionsJson,
  CuesJson,
  EditJson,
  SfxCatalog,
  SfxCue,
  SfxFeature,
  TimedWord,
  TimingJson,
} from './types';

export const MIN_GAP = 0.3;

const clean = (t: string) => t.replace(/[,.]+$/, '');

interface DispWord {
  t: string;
  s: number;
  ids: number[];
}

/** Kata tampil; '-xxx' digabung ke kata sebelumnya ("aplikasi-aplikasi"). */
export function dispWords(W: TimedWord[], idx: number[]): DispWord[] {
  const out: DispWord[] = [];
  for (const i of idx) {
    const w = W[i];
    if (w.w.startsWith('-') && out.length) {
      out[out.length - 1].t += clean(w.w);
      out[out.length - 1].ids.push(i);
    } else out.push({ t: clean(w.w), s: w.s, ids: [i] });
  }
  return out;
}

export interface CapLine {
  t: string;
  big: boolean;
  s?: number;
}

export interface PlainCap {
  s: number;
  e: number;
  anim: string;
  words: { t: string; s: number }[];
}

export interface KeyCap {
  s: number;
  e: number;
  hit: number;
  anim: string;
  pos: string;
  lines: CapLine[];
  sfx_hit: string | null | undefined;
}

export function layoutCaptions(T: TimingJson, C: CaptionsJson): { caps: PlainCap[]; keys: KeyCap[] } {
  const W = T.words;
  const chunks = C.chunks;
  const flat = chunks.flatMap((c) => c.w);
  if (flat.length !== W.length || flat.some((v, i) => v !== i))
    throw new Error(`captions.json harus mencakup semua kata berurutan 0..${W.length - 1}`);
  const caps: PlainCap[] = [];
  const keys: KeyCap[] = [];
  chunks.forEach((c, k) => {
    const s = W[c.w[0]].s - 0.04;
    const nxt = k + 1 < chunks.length ? W[chunks[k + 1].w[0]].s - 0.04 : T.duration;
    const e = pyRound(Math.min(nxt, W[c.w[c.w.length - 1]].e + 0.45), 3);
    const words = dispWords(W, c.w);
    if (c.big && c.big.length) {
      const big = new Set(c.big);
      const lines: CapLine[] = [];
      let curSmall: string[] = [];
      for (const w of words) {
        if (w.ids.some((i) => big.has(i))) {
          if (curSmall.length) {
            lines.push({ t: curSmall.join(' '), big: false });
            curSmall = [];
          }
          const last = lines[lines.length - 1];
          if (last && last.big) last.t += ' ' + w.t;
          else lines.push({ t: w.t, big: true, s: w.s });
        } else curSmall.push(w.t);
      }
      if (curSmall.length) lines.push({ t: curSmall.join(' '), big: false });
      const hitT = Math.min(...lines.filter((l) => l.big).map((l) => l.s!));
      keys.push({
        s: pyRound(s, 3),
        e,
        hit: pyRound(hitT, 3),
        anim: c.anim ?? 'slam',
        pos: c.pos ?? 'c',
        lines,
        sfx_hit: c.hit ?? null,
      });
    } else {
      caps.push({ s: pyRound(s, 3), e, anim: c.anim ?? 'pop', words: words.map((w) => ({ t: w.t, s: w.s })) });
    }
  });
  return { caps, keys };
}

// Kamera otomatis (05/10, Steven: "perbesar zoom in, out, panning — kalau tidak terlihat, tidak berguna").
// Tiap potongan dipecah jadi ketukan ±BEAT dtk; tiap ketukan bergerak ke keadaan berikutnya di siklus STATES.
// Di tiap jump cut siklus melompat satu langkah -> skala/posisi berganti, lompatan potongan tersamarkan.
// Batas aman tanpa tepi hitam: |x| <= 540*(s-1), y <= origin_y*(s-1).
export const BEAT = 1.8; // 06/10 fast paced
export const STATES: [number, number, number][] = [
  [1.0, 0, 0], // lebar
  [1.14, 0, -20], // zoom in
  [1.14, 50, -20], // pan ke kanan
  [1.04, 0, 0], // zoom out
  [1.13, -45, 10], // zoom in + pan ke kiri
  [1.13, 45, 10], // pan ke kanan
  [1.02, 0, 0], // zoom out
];

export function autoCamera(T: TimingJson, keys: KeyCap[], E: EditJson): CamStep[] {
  const cuts = [0.0, ...T.cuts, T.duration];
  const whip = new Set(E.whip ?? []);
  const kuat = Number(E.camera_kuat ?? 1.0);
  const oy = (1920 * parseFloat(String(E.origin ?? '50% 40%').split(/\s+/)[1].replace(/%+$/, ''))) / 100;

  const st = (i: number) => {
    const [sc0, x0, y0] = STATES[((i % STATES.length) + STATES.length) % STATES.length];
    const sc = 1 + (sc0 - 1) * kuat;
    const x = x0 * kuat;
    const y = y0 * kuat;
    if (!(Math.abs(x) <= 540 * (sc - 1) + 0.01 && -oy * (sc - 1) - 0.01 <= y && y <= (1920 - oy) * (sc - 1) + 0.01))
      throw new Error(`Kamera keluar batas aman: ${sc}, ${x}, ${y}`);
    return { scale: pyRound(sc, 4), x: pyRound(x, 1), y: pyRound(y, 1) };
  };

  const cam: CamStep[] = [];
  let k = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    let t0 = cuts[i];
    const t1 = cuts[i + 1];
    k += 1; // lompat satu keadaan di tiap potongan
    if (whip.has(i) && i > 0) {
      const w = st(k);
      cam.push({
        t: t0,
        from: { scale: w.scale + 0.3, x: w.x - 60, y: w.y, filter: 'blur(14px)' },
        to: { ...w, filter: 'blur(0px)' },
        dur: 0.6,
        ease: 'power2.out',
      });
      t0 += 0.6;
    }
    const d = t1 - t0;
    const n = Math.max(1, pyRound(d / BEAT));
    const bd = d / n;
    for (let j = 0; j < n; j++) {
      cam.push({ t: pyRound(t0 + j * bd, 3), from: st(k), to: st(k + 1), dur: pyRound(bd, 3), ease: 'sine.inOut' });
      k += 1;
    }
    // punch-in kata kunci "slam" di lapisan #aroll (terpisah dari gerak dasar), ditahan sampai potongan berikutnya
    const hit = keys.find((kk) => kk.anim === 'slam' && cuts[i] <= kk.s && kk.s < t1 - 0.3);
    if (hit) {
      cam.push({ el: '#aroll', t: hit.s, from: { scale: 1 }, to: { scale: 1 + 0.08 * kuat }, dur: 0.2, ease: 'power3.out' });
      cam.push({ el: '#aroll', t: pyRound(t1 - 0.01, 3), from: { scale: 1 + 0.08 * kuat }, to: { scale: 1 }, dur: 0.01, ease: 'none' });
    }
  }
  return cam;
}

export interface SfxLibrary {
  features: Record<string, SfxFeature>;
  catalog: SfxCatalog;
}

/**
 * SFX otomatis + manual, lalu aturan kepadatan. Sama dengan build_html.py.
 * `motion` = SFX bagian motion graphic (app): diperlakukan seperti SFX manual (prio 3, puncak disejajarkan kalau `align`, `dur`
 * dihormati) dan ditambahkan PALING AKHIR supaya pilihan bunyi SFX otomatis (rotasi per kategori) tidak bergeser. Cue-nya
 * ditandai `m: 1` sehingga tidak terkena `sfx_off` (lihat applySfxOff).
 */
export function buildCues(
  T: TimingJson,
  caps: PlainCap[],
  keys: KeyCap[],
  E: EditJson,
  lib: SfxLibrary,
  motion: MotionSfx[] = [],
): { cues: CuesJson; dropped: number } {
  const W = T.words;
  const rot: Record<string, number> = {};
  const pick = (kat: string): string | null => {
    const ids = (lib.catalog.pilihan[kat] ?? []).filter((i) => lib.catalog.bunyi[i]?.kategori !== 'buang');
    if (!ids.length) return null;
    const n = rot[kat] ?? 0;
    rot[kat] = n + 1;
    return ids[n % ids.length];
  };
  const cues: SfxCue[] = [];
  const add = (
    t: number,
    kat: string,
    o: { peakAlign?: boolean; dur?: number | null; prio?: number; gainDb?: number; sid?: string | null; motion?: boolean } = {},
  ) => {
    const sid = o.sid || pick(kat);
    if (!sid) return;
    let off = 0.0;
    if (o.peakAlign) {
      const f = lib.features[sid];
      if (f) off = f.peak_at * f.dur;
    }
    cues.push({ t: pyRound(t - off, 3), id: sid, kat, dur: o.dur ?? null, prio: o.prio ?? 1, gain_db: o.gainDb ?? 0.0, ...(o.motion ? { m: 1 as const } : {}) });
  };

  const firstKey = keys.find((k) => k.hit <= 5)?.hit;
  const riserHit = firstKey !== undefined ? firstKey : T.cuts.length ? T.cuts[0] : W.length ? W[0].s : 1.0;
  if (E.riser ?? true) add(riserHit, 'riser', { peakAlign: true, prio: 2 });
  for (const c of caps) {
    if (c.anim === 'type') {
      const n = pyLen(c.words.map((w) => w.t).join(' '));
      add(c.s + 0.02, 'ketik', { dur: pyRound(n / CPS + 0.05, 3) });
    } else add(c.s, 'klik');
  }
  let booms = 0;
  for (const k of keys) {
    if (k.anim === 'slam') add(k.hit, 'whoosh', { peakAlign: true, prio: 2, gainDb: -2 });
    else if (k.anim === 'blur') add(k.hit, 'swish', { peakAlign: true, prio: 2 });
    else {
      const n = pyLen(k.lines.map((l) => l.t).join(' '));
      add(k.s + 0.02, 'ketik', { dur: pyRound(n / CPS + 0.05, 3) });
    }
    if (k.sfx_hit === 'boom' && booms === 0) {
      add(k.hit, 'boom', { prio: 3 });
      booms += 1;
    } else if (k.sfx_hit) add(k.hit, 'impact', { prio: 3 });
  }
  for (const i of E.whip ?? []) if (0 < i && i <= T.cuts.length) add(T.cuts[i - 1] + 0.05, 'whoosh', { peakAlign: true, prio: 2 });
  for (const ins of E.inserts ?? []) add(ins.t, 'whoosh', { peakAlign: true, prio: 2 });
  for (const m of E.sfx ?? [])
    add(m.t, m.kat ?? '', { peakAlign: m.align ?? false, prio: 3, gainDb: m.gain_db ?? 0, sid: m.id, dur: m.dur ?? null });
  for (const m of motion) add(m.t, m.kat, { peakAlign: m.align ?? false, prio: 3, gainDb: m.gain_db ?? 0, dur: m.dur ?? null, motion: true });

  cues.sort((a, b) => a.t - b.t); // stabil, sama dengan sort Python
  const hi = cues.filter((c) => c.prio >= 2 && c.kat !== 'riser').map((c) => c.t);
  const kept: SfxCue[] = [];
  let last = -9;
  for (const c of cues) {
    // kepadatan: klik/ketik mengalah ke bunyi lain dalam ±MIN_GAP
    if (c.prio === 1 && (c.t - last < MIN_GAP || hi.some((h) => Math.abs(c.t - h) < MIN_GAP))) continue;
    kept.push(c);
    if (c.kat !== 'riser') last = c.t;
  }
  return { cues: { duration: T.duration, music: E.music ?? { style: 'none' }, sfx: kept }, dropped: cues.length - kept.length };
}

export interface CompositionData {
  duration: number;
  cuts: number[];
  caps: PlainCap[];
  keys: KeyCap[];
  camera: CamStep[];
  inserts: NonNullable<EditJson['inserts']>;
  origin: string;
  cps: number;
  lines: unknown;
  words: [number, number][];
  marks: unknown;
}

export function buildCompositionData(T: TimingJson, C: CaptionsJson, E: EditJson, marks: unknown = {}): CompositionData {
  const { caps, keys } = layoutCaptions(T, C);
  const motion = E.mode === 'motion'; // tanpa footage: latar motion, VO dari TTS, tanpa kamera otomatis
  const camMode = E.camera ?? 'auto';
  const cam = motion && camMode === 'auto' ? [] : camMode === 'auto' ? autoCamera(T, keys, E) : (camMode as CamStep[]);
  return {
    duration: T.duration,
    cuts: T.cuts,
    caps,
    keys,
    camera: cam,
    inserts: E.inserts ?? [],
    origin: E.origin ?? '50% 40%',
    cps: CPS,
    lines: T.lines ?? {},
    words: T.words.map((w) => [w.s, w.e]),
    marks,
  };
}

/** Isi template: data komposisi, insert b-roll, dan overlay per video (css/html/js). */
export function renderTemplate(
  tpl: string,
  data: CompositionData,
  overlay: { css?: string; html?: string; js?: string } = {},
): string {
  let ins = '';
  data.inserts.forEach((x, i) => {
    const isVideo = /\.(mp4|mov|webm)$/i.test(x.src);
    const tag = isVideo
      ? `<video id="ins${i}v" src="${x.src}" muted playsinline data-start="${x.t}" data-duration="${x.dur}" class="clip"></video>`
      : `<img id="ins${i}v" src="${x.src}" alt="" />`;
    const wrap = isVideo ? '' : ` class="clip" data-start="${x.t}" data-duration="${x.dur}"`;
    ins += `<div class="ins" id="ins${i}"${wrap}><div class="insIn" id="ins${i}in">${tag}</div></div>\n`;
  });
  // str.replace Python mengganti SEMUA kemunculan; split/join juga aman dari pola `$` di isi pengganti
  const rep = (s: string, pat: string, val: string) => s.split(pat).join(val);
  let html = rep(tpl, '__DUR__', pyFixed(data.duration, 2));
  html = rep(html, '__DATA__', JSON.stringify(data));
  html = rep(html, '<!--INSERTS-->', ins);
  html = rep(html, '      /*OVERLAY-CSS*/', overlay.css ?? '');
  html = rep(html, '<!--OVERLAY-HTML-->', (overlay.html ?? '').trim());
  html = rep(html, '/*OVERLAY-JS*/', (overlay.js ?? '').trim());
  return html;
}
