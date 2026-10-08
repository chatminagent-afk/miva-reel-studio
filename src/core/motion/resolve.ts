// Resolusi waktu motion + penerjemah brief lengkap (parse -> align -> rules -> penjadwalan). Tahap 4 dari 4.
//
// - resolveMotion(): jangkar kata mentah -> detik hasil edit (srcToEdited-setara; kata terpotong menempel ke kata terpakai
//   terdekat, item tidak pernah dibuang).
// - briefToMotion(): teks brief + kata mentah + potongan -> MotionItem[] + laporan untuk UI.
//
// Konvensi waktu yang diverifikasi terhadap 6 proyek nyata (lihat tests/core/motion-brief.test.ts): motion mengilustrasikan
// naskah yang diucapkan tepat SEBELUM header blok (format `[MOTION NN]`) atau VO di dalam blok (format `[0-3s]` / `###`).
// Mulai = kata pertama rentang itu (-0,05 dtk); berakhir = awal motion berikutnya.
import type { RawWord, Seg } from '../types';
import { alignLines, alignPhrase, type LineAlign } from './align';
import { blockLabel, deDash, parseBrief, type BriefLine } from './brief';
import { interpretBlock, type Draft, type Phase } from './rules';
import type { MotionAnchor, MotionItem, MotionKind, ResolvedMotion } from './types';

// ---------- durasi per jenis ----------

export const MIN_DUR: Record<MotionKind, number> = {
  statement: 1.5,
  chat: 4,
  chain: 2.5,
  chips: 2,
  counter: 2,
  toasts: 2,
  phone: 2.5,
  split: 2.5,
  bubbles: 2.5,
  logo: 1.8,
  endcard: 2,
  toggle: 2,
  cta: 2,
};
export const MAX_DUR: Record<MotionKind, number> = {
  statement: 4,
  chat: 14,
  chain: 7,
  chips: 12,
  counter: 6,
  toasts: 6,
  phone: 6,
  split: 7,
  bubbles: 7,
  logo: 4,
  endcard: 6,
  toggle: 4,
  cta: 6,
};
/** Dipakai resolveMotion kalau item tidak punya `end` maupun `dur`. */
export const DEFAULT_DUR: Record<MotionKind, number> = {
  statement: 2.5,
  chat: 6,
  chain: 4,
  chips: 4,
  counter: 3,
  toasts: 3,
  phone: 4,
  split: 4,
  bubbles: 4,
  logo: 2.5,
  endcard: 2.5,
  toggle: 2.5,
  cta: 3,
};
const MIN_LEN = 0.5;
/** end card butuh ±2,5 dtk di atas freeze `edit.tail` */
export const ENDCARD_TAIL = 2.5;

// ---------- waktu kata ----------

export interface WordTimes {
  n: number;
  /** awal / akhir kata di waktu hasil edit; null kalau kata dipotong */
  s: (number | null)[];
  e: (number | null)[];
  next: number[];
  prev: number[];
}

/** Sama dengan mapTiming (src/core/timing.ts): kata terpakai kalau awal + 0,05 dtk jatuh di dalam seg. */
export function buildWordTimes(words: RawWord[], segs: Seg[], speed: number): WordTimes {
  const offs: number[] = [];
  let acc = 0;
  for (const [a, b] of segs) {
    offs.push(acc);
    acc += b - a;
  }
  const n = words.length;
  const s: (number | null)[] = new Array(n).fill(null);
  const e: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const w = words[i];
    const t = w.s + 0.05;
    for (let k = 0; k < segs.length; k++) {
      const [a, b] = segs[k];
      if (a <= t && t <= b) {
        const end = Math.min(w.e_ref ?? w.e, b);
        s[i] = (Math.max(w.s, a) - a + offs[k]) / speed;
        e[i] = Math.max(s[i]!, (end - a + offs[k]) / speed);
        break;
      }
    }
  }
  const next: number[] = new Array(n).fill(-1);
  const prev: number[] = new Array(n).fill(-1);
  let nx = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (s[i] !== null) nx = i;
    next[i] = nx;
  }
  let pv = -1;
  for (let i = 0; i < n; i++) {
    if (s[i] !== null) pv = i;
    prev[i] = pv;
  }
  return { n, s, e, next, prev };
}

/**
 * Jangkar -> detik hasil edit. Edge bawaan: 's' (awal kata). Kata terpotong: menempel ke awal kata terpakai berikutnya,
 * kalau tidak ada ke akhir kata terpakai sebelumnya, kalau tidak ada sama sekali ke 0.
 */
export function anchorTime(a: MotionAnchor, wt: WordTimes, defaultEdge: 's' | 'e' = 's'): number {
  if (!wt.n) return a.off ?? 0;
  const i = Math.min(Math.max(Math.round(a.word), 0), wt.n - 1);
  const edge = a.edge ?? defaultEdge;
  let base = 0;
  if (wt.s[i] !== null) base = (edge === 'e' ? wt.e[i] : wt.s[i]) as number;
  else if (wt.next[i] >= 0) base = wt.s[wt.next[i]] as number;
  else if (wt.prev[i] >= 0) base = wt.e[wt.prev[i]] as number;
  return base + (a.off ?? 0);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/**
 * Hitung t0/t1/beatTimes tiap item (detik hasil edit).
 * - t1 > t0 minimal 0,5 dtk; dijepit ke [0, duration + tail].
 * - end tanpa edge dianggap 'e' (akhir kata); start dan beats tanpa edge dianggap 's'.
 */
export function resolveMotion(
  items: MotionItem[],
  words: RawWord[],
  segs: Seg[],
  speed: number,
  duration: number,
  tail = 0,
): ResolvedMotion[] {
  const wt = buildWordTimes(words, segs, speed);
  const maxT = Math.max(duration + Math.max(0, tail), MIN_LEN);
  return items.map((it) => {
    let t0 = clamp(anchorTime(it.start, wt, 's'), 0, maxT);
    let t1 = it.end ? anchorTime(it.end, wt, 'e') : t0 + (it.dur ?? DEFAULT_DUR[it.kind]);
    if (!(t1 > t0 + MIN_LEN)) t1 = t0 + MIN_LEN;
    if (t1 > maxT) {
      t1 = maxT;
      if (t1 - t0 < MIN_LEN) t0 = Math.max(0, t1 - MIN_LEN);
    }
    const beatTimes = (it.beats ?? [])
      .map((b) => clamp(anchorTime(b, wt, 's'), t0, t1))
      .sort((x, y) => x - y);
    return { ...it, t0, t1, beatTimes } as ResolvedMotion;
  });
}

// ---------- laporan ----------

export interface BlockReport {
  index: number;
  label: string;
  title: string;
  /** naskah yang diilustrasikan blok ini (teks + rentang kata mentah), null kalau tak ada yang terjajar */
  span: { text: string; from: number; to: number } | null;
  kinds: MotionKind[];
  itemIds: string[];
  /** 0..1: keyakinan penjajaran naskah x keyakinan aturan */
  confidence: number;
  /** ada item yang komponennya tidak yakin (item.review) */
  review: boolean;
  /** waktu mulai ditebak dari blok sekitar karena naskah blok ini tidak ketemu di transkrip */
  timingGuessed: boolean;
  warnings: string[];
}

export interface BriefReport {
  format: string;
  blocks: BlockReport[];
  /** baris naskah yang tidak ketemu di transkrip (diabaikan) */
  unalignedScript: string[];
  alignedLines: number;
  scriptLines: number;
  /** detik `edit.tail` yang dibutuhkan end card (0 kalau tidak ada end card) */
  needsTail: number;
  warnings: string[];
}

export interface BriefOptions {
  /** `edit.tail` proyek saat ini; dipakai untuk memutuskan perlu peringatan atau tidak */
  tail?: number;
}

// ---------- penerjemah brief ----------

interface ScriptCand {
  text: string;
  /** blok pemilik (rentang naskah ini dipakai blok tersebut); -1 = di luar blok */
  owner: number;
  tailOf: number; // indeks blok yang ekornya memuat baris ini (-1 kalau bukan ekor)
  tailIdx: number;
  desc: boolean;
}

const nn = (n: number) => String(n).padStart(2, '0');

export function briefToMotion(
  brief: string,
  words: RawWord[],
  segs: Seg[],
  speed: number,
  duration: number,
  opts: BriefOptions = {},
): { items: MotionItem[]; report: BriefReport } {
  const parsed = parseBrief(brief);
  const blocks = parsed.blocks;
  const W = words.length;
  const wt = buildWordTimes(words, segs, speed);
  const report: BriefReport = {
    format: parsed.format,
    blocks: [],
    unalignedScript: [],
    alignedLines: 0,
    scriptLines: 0,
    needsTail: 0,
    warnings: [],
  };
  if (!blocks.length) {
    report.warnings.push('brief tidak berisi blok motion (header `[MOTION NN - JUDUL]`, `[0-3s]` atau `### JUDUL`)');
    return { items: [], report };
  }
  if (!W) report.warnings.push('transkrip kosong: waktu motion dibagi rata');

  // 1) kandidat naskah
  const cands: ScriptCand[] = [];
  if (parsed.format === 'motion') {
    for (const l of parsed.preamble) if (l.text.trim()) cands.push({ text: l.text, owner: 0, tailOf: -1, tailIdx: -1, desc: false });
    blocks.forEach((b, k) => {
      b.tail.forEach((l, ti) => {
        if (l.text.trim()) cands.push({ text: l.text, owner: k + 1, tailOf: k, tailIdx: ti, desc: l.descLike });
      });
    });
  } else {
    blocks.forEach((b, k) => {
      for (const s of b.script) cands.push({ text: s, owner: k, tailOf: -1, tailIdx: -1, desc: false });
    });
  }
  report.scriptLines = cands.filter((c) => c.tailOf >= 0 || parsed.format !== 'motion' || c.owner === 0).length;

  // 2) penjajaran monoton ke transkrip
  const al: (LineAlign | null)[] = W ? alignLines(cands.map((c) => c.text), words) : cands.map(() => null);

  // 3) tentukan peran baris ekor: naskah (terjajar / tak terjajar) atau deskripsi motion milik blok itu sendiri
  const extra: BriefLine[][] = blocks.map(() => []);
  const spanLines: number[][] = blocks.map(() => []);
  const unalignedOwner: string[][] = blocks.map(() => []);
  cands.forEach((c, i) => {
    const a = al[i];
    if (a) {
      report.alignedLines++;
      if (c.owner >= 0 && c.owner < blocks.length) spanLines[c.owner].push(i);
      return;
    }
    if (c.tailOf >= 0 && c.desc) {
      extra[c.tailOf].push(blocks[c.tailOf].tail[c.tailIdx]);
      return;
    }
    // preamble yang tak terjajar dianggap catatan Steven (bukan naskah)
    if (c.tailOf >= 0 || parsed.format !== 'motion') {
      report.unalignedScript.push(c.text);
      if (c.owner >= 0 && c.owner < blocks.length) unalignedOwner[c.owner].push(c.text);
    }
  });

  // 4) rentang naskah per blok
  const A: (number | null)[] = blocks.map(() => null);
  const B: (number | null)[] = blocks.map(() => null);
  const conf: number[] = blocks.map(() => 0);
  let mismatch = false;
  const alignedFrac = cands.length ? report.alignedLines / cands.length : 0;
  if (!W || (cands.length >= 3 && alignedFrac < 0.3)) mismatch = true;
  blocks.forEach((_b, k) => {
    const ls = spanLines[k].map((i) => al[i]!).filter(Boolean);
    if (!ls.length) return;
    A[k] = Math.min(...ls.map((x) => x.from));
    B[k] = Math.max(...ls.map((x) => x.to));
    conf[k] = ls.reduce((s, x) => s + x.conf, 0) / ls.length;
  });
  if (mismatch && W) {
    report.warnings.push('naskah di brief hampir tidak cocok dengan transkrip: waktu motion dibagi rata, cek manual');
    blocks.forEach((_b, k) => {
      A[k] = Math.floor((k * W) / blocks.length);
      B[k] = Math.max(A[k]!, Math.floor(((k + 1) * W) / blocks.length) - 1);
      conf[k] = 0.1;
    });
  }

  // 5) draf item per blok
  const drafts: Draft[][] = blocks.map((b, k) => interpretBlock(b, { isLast: k === blocks.length - 1, extra: extra[k] }));

  // 6) kata awal tiap blok (+ ikatan kutipan ke kata yang diucapkan)
  const start: number[] = [];
  let cursor = -1;
  blocks.forEach((_b, k) => {
    if (A[k] !== null) {
      start[k] = A[k]!;
      cursor = Math.max(cursor, B[k]!);
    } else start[k] = Math.min(Math.max(cursor + 1, 0), Math.max(W - 1, 0));
  });
  // blok tanpa naskah terjajar yang diapit blok bernaskah: tidak boleh mulai sesudah awal blok berikutnya
  for (let k = blocks.length - 2; k >= 0; k--) {
    if (A[k] === null && A[k + 1] !== null && start[k] >= A[k + 1]!) start[k] = Math.max(0, A[k + 1]! - 1);
  }
  const startOff: number[] = blocks.map(() => -0.05);
  const hitsBy: Map<Draft, { from: number; to: number }[]> = new Map();
  blocks.forEach((_b, k) => {
    if (!W) return;
    const lo = (B[k] !== null ? B[k]! + 1 : start[k]);
    const hi = (() => {
      for (let j = k + 1; j < blocks.length; j++) if (A[j] !== null) return A[j]! - 1;
      return W - 1;
    })();
    const spanLo = A[k] !== null ? A[k]! : start[k];
    for (const d of drafts[k]) {
      if (d.kind !== 'bubbles' || !d.beatQuotes?.length) continue;
      const hits: { from: number; to: number }[] = [];
      let from = spanLo;
      for (const q of d.beatQuotes) {
        const p = alignPhrase(q, words, from, hi);
        if (p) {
          hits.push({ from: p.from, to: p.to });
          from = p.to + 1;
        } else hits.push({ from: -1, to: -1 });
      }
      hitsBy.set(d, hits);
      // kutipan terucap SESUDAH naskah blok -> blok baru mulai di sana (aturan konten)
      const firstHit = hits.find((h) => h.from >= 0);
      if (firstHit && firstHit.from > (B[k] ?? -1) && firstHit.from >= lo - 1) {
        start[k] = firstHit.from;
        startOff[k] = -0.03;
      }
    }
  });
  if (mismatch) startOff.fill(-0.05);

  // 7) item dengan jangkar kata
  const lastWord = Math.max(W - 1, 0);
  const items: MotionItem[] = [];
  const itemBlock: number[] = [];
  const holds: (number | undefined)[] = [];
  const idSeen = new Map<string, number>();
  blocks.forEach((b, k) => {
    const spanEnd = B[k] !== null ? B[k]! : (() => {
      for (let j = k + 1; j < blocks.length; j++) if (A[j] !== null) return Math.max(start[k], A[j]! - 1);
      return lastWord;
    })();
    for (const d of drafts[k]) {
      const anchor = phaseAnchor(d.phase, start[k], startOff[k], spanEnd, lastWord);
      let id = `mt-${nn(k + 1)}-${d.kind}`;
      const seen = idSeen.get(id) ?? 0;
      idSeen.set(id, seen + 1);
      if (seen) id += `-${seen + 1}`;
      const note = deDash([...b.lines, ...extra[k]].map((l) => l.raw.trim()).filter(Boolean).join('\n')).slice(0, 600);
      // `review` = pilihan KOMPONEN tidak yakin (kontrak). Waktu mulai yang ditebak (naskah tak terjajar) dilaporkan lewat
      // BlockReport.timingGuessed + warnings, bukan lewat tanda review pada item.
      const review = d.review === true || mismatch;
      const it = {
        id,
        kind: d.kind,
        start: anchor,
        props: deepDeDash(d.props),
        label: blockLabel(b),
        note,
        origin: 'rules',
      } as unknown as MotionItem;
      if (d.scene) it.scene = true;
      if (review) it.review = true;
      if (d.kind === 'bubbles') {
        const hits = hitsBy.get(d);
        if (hits && hits.some((h) => h.from >= 0)) {
          it.beats = hits.filter((h) => h.from >= 0).map((h) => ({ word: h.from, edge: 's', off: -0.03 }));
        }
      }
      items.push(it);
      itemBlock.push(k);
      holds.push(d.hold);
    }
  });

  // 8) akhir tiap item + penjadwalan tanpa tumpang tindih
  schedule(items, itemBlock, holds, blocks.length, words, wt);

  // 9) laporan
  const hasEnd = items.some((i) => i.kind === 'endcard');
  report.needsTail = hasEnd ? ENDCARD_TAIL : 0;
  if (hasEnd && (opts.tail ?? 0) < ENDCARD_TAIL - 0.01) {
    report.warnings.push(`end card butuh edit.tail ≈ ${ENDCARD_TAIL} dtk (sekarang ${(opts.tail ?? 0).toFixed(1)} dtk)`);
  }
  blocks.forEach((b, k) => {
    const warnings: string[] = [];
    const ids = items.filter((_x, i) => itemBlock[i] === k);
    let span: BlockReport['span'] = null;
    if (A[k] !== null) {
      const txt = spanLines[k].map((i) => cands[i].text).join(' ');
      span = { text: txt, from: A[k]!, to: B[k]! };
      const cut = [...Array(B[k]! - A[k]! + 1).keys()].filter((o) => wt.s[A[k]! + o] === null).length;
      if (cut > 0) warnings.push(`${cut} dari ${B[k]! - A[k]! + 1} kata naskah dipotong dari hasil edit`);
    } else if (b.type !== 'endcard') {
      warnings.push('naskah sebelum blok ini tidak ketemu di transkrip: waktu mulai ditebak dari blok sekitarnya');
    }
    for (const u of unalignedOwner[k]) warnings.push(`baris naskah tidak terjajar: "${u.slice(0, 60)}"`);
    if (!ids.length) warnings.push('tidak ada item motion (blok tanpa isi)');
    if (ids.some((i) => i.review)) warnings.push('tandai review: komponen terdekat dipakai');
    if (ids.some((i) => i.kind === 'endcard')) warnings.push(`butuh edit.tail ≈ ${ENDCARD_TAIL} dtk`);
    const ruleConf = ids.length ? (ids.some((i) => i.review) ? 0.5 : 1) : 0;
    const sc = A[k] !== null ? Math.max(conf[k], 0.2) : b.type === 'endcard' ? 0.8 : 0.3;
    report.blocks.push({
      index: k,
      label: blockLabel(b),
      title: b.title,
      span,
      kinds: ids.map((i) => i.kind),
      itemIds: ids.map((i) => i.id),
      confidence: Math.round(sc * ruleConf * 100) / 100,
      review: ids.some((i) => i.review === true),
      timingGuessed: A[k] === null && b.type !== 'endcard',
      warnings,
    });
  });
  return { items, report };
}

function phaseAnchor(phase: Phase, startWord: number, startOff: number, spanEnd: number, lastWord: number): MotionAnchor {
  switch (phase) {
    case 'late': {
      const w = Math.min(spanEnd, Math.max(startWord + 1, startWord + Math.round(0.6 * (spanEnd - startWord))));
      return { word: Math.max(0, Math.min(w, lastWord)), edge: 's', off: -0.05 };
    }
    case 'after':
      return { word: Math.max(0, Math.min(spanEnd, lastWord)), edge: 'e', off: 0 };
    case 'tail':
      return { word: lastWord, edge: 'e', off: 0.1 };
    default:
      return { word: Math.max(0, Math.min(startWord, lastWord)), edge: 's', off: startOff };
  }
}

/**
 * Tetapkan `end`/`dur` tiap item dan hilangkan tumpang tindih antar-blok:
 *  - item berakhir di awal blok berikutnya (atau awal end card di blok yang sama);
 *  - blok dengan awal sama (mis. seksi tanpa naskah sendiri) membagi jendela sampai awal berbeda berikutnya;
 *  - "tahan" PAUSE yang tidak muat menggeser blok berikutnya (maks 1,7 dtk); jenis lain dibiarkan pendek;
 *  - jenis dengan durasi maksimum dipotong lewat `dur`.
 */
function schedule(
  items: MotionItem[],
  itemBlock: number[],
  holds: (number | undefined)[],
  nBlocks: number,
  words: RawWord[],
  wt: WordTimes,
): void {
  const t0s = items.map((it) => Math.max(0, anchorTime(it.start, wt, 's')));
  const speechEnd = anchorTime({ word: Math.max(words.length - 1, 0), edge: 'e', off: 0.1 }, wt, 'e');
  // awal efektif blok = item pertama yang bukan end card; blok hanya-end-card memakai awal end card-nya
  const blockStart: number[] = new Array(nBlocks).fill(Infinity);
  const hasNonEnd: boolean[] = new Array(nBlocks).fill(false);
  items.forEach((it, i) => {
    if (it.kind === 'endcard') return;
    blockStart[itemBlock[i]] = Math.min(blockStart[itemBlock[i]], t0s[i]);
    hasNonEnd[itemBlock[i]] = true;
  });
  items.forEach((it, i) => {
    if (it.kind === 'endcard' && !hasNonEnd[itemBlock[i]]) blockStart[itemBlock[i]] = Math.min(blockStart[itemBlock[i]], t0s[i]);
  });
  let acc = 0;
  for (let k = 0; k < nBlocks; k++) {
    if (!isFinite(blockStart[k])) continue;
    blockStart[k] = Math.max(blockStart[k], acc);
    acc = blockStart[k];
  }
  const shift: number[] = new Array(nBlocks).fill(0);
  // blok dengan awal sama: bagi rata jendela sampai awal berbeda berikutnya
  const live = blockStart.map((s, k) => (isFinite(s) ? k : -1)).filter((k) => k >= 0);
  for (let a = 0; a < live.length; ) {
    let b = a;
    while (b + 1 < live.length && Math.abs(blockStart[live[b + 1]] - blockStart[live[a]]) < 0.05) b++;
    if (b > a) {
      const next = b + 1 < live.length ? blockStart[live[b + 1]] : speechEnd;
      const base = blockStart[live[a]];
      const each = Math.max((next - base) / (b - a + 1), 0.8);
      for (let g = a; g <= b; g++) {
        const k = live[g];
        const ns = base + (g - a) * each;
        shift[k] += ns - blockStart[k];
        blockStart[k] = ns;
      }
    }
    a = b + 1;
  }
  // "tahan" PAUSE
  for (let k = 0; k < nBlocks; k++) {
    const idxs = items.map((_x, i) => i).filter((i) => itemBlock[i] === k && items[i].kind === 'statement' && holds[i]);
    if (!idxs.length || !isFinite(blockStart[k])) continue;
    const hold = Math.max(...idxs.map((i) => holds[i]!));
    const nk = nextLive(blockStart, k);
    if (nk < 0) continue;
    const need = blockStart[k] + hold;
    if (blockStart[nk] < need && need - blockStart[nk] <= 1.7) {
      shift[nk] += need - blockStart[nk];
      blockStart[nk] = need;
    }
  }
  const endcardOf = (k: number) => items.findIndex((x, j) => x.kind === 'endcard' && itemBlock[j] === k);
  items.forEach((it, i) => {
    const k = itemBlock[i];
    const nk = nextLive(blockStart, k);
    if (it.kind === 'endcard') {
      it.start = { ...it.start, off: round3((it.start.off ?? 0) + (hasNonEnd[k] ? 0 : shift[k])) };
      it.dur = ENDCARD_TAIL;
      delete it.end;
      return;
    }
    let t0 = t0s[i] + shift[k];
    t0 = Math.max(t0, blockStart[k]);
    // akhir: awal blok berikutnya, atau awal end card di blok ini, atau akhir ucapan
    const ec = endcardOf(k);
    let endAnchor: MotionAnchor | null = null;
    let limit = speechEnd;
    if (ec >= 0) {
      limit = anchorTime(items[ec].start, wt, 's');
      endAnchor = { ...items[ec].start };
    } else if (nk >= 0) {
      limit = blockStart[nk] - 0.05;
      endAnchor = startAnchorOfBlock(items, itemBlock, nk, shift[nk]);
    }
    // item "late"/"after" tidak boleh mulai terlalu dekat batas
    if (t0 > limit - 0.4) t0 = Math.max(blockStart[k], limit - 0.4);
    const baseT = anchorTime({ ...it.start, off: 0 }, wt, 's');
    it.start = { ...it.start, off: round3(t0 - baseT) };
    const hold = holds[i];
    const minD = Math.max(MIN_DUR[it.kind], hold ?? 0);
    const maxD = MAX_DUR[it.kind];
    if (limit - t0 > maxD) {
      it.dur = maxD;
      delete it.end;
      return;
    }
    if (limit - t0 < minD && hold) {
      it.dur = round3(Math.max(limit - t0, MIN_LEN));
      delete it.end;
      return;
    }
    it.end = endAnchor ?? { word: Math.max(words.length - 1, 0), edge: 'e', off: 0.1 };
  });
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function nextLive(blockStart: number[], k: number): number {
  for (let j = k + 1; j < blockStart.length; j++) if (isFinite(blockStart[j])) return j;
  return -1;
}

/** Jangkar awal item pertama (bukan end card) di blok `k`, dengan geseran. */
function startAnchorOfBlock(items: MotionItem[], itemBlock: number[], k: number, shiftK: number): MotionAnchor {
  let best: MotionItem | null = null;
  items.forEach((it, i) => {
    if (itemBlock[i] !== k || it.kind === 'endcard') return;
    if (!best || it.start.word < best.start.word || (it.start.word === best.start.word && (it.start.off ?? 0) < (best.start.off ?? 0))) best = it;
  });
  const b = (best ?? items.find((_x, i) => itemBlock[i] === k)) as MotionItem;
  return { word: b.start.word, edge: b.start.edge ?? 's', off: round3((b.start.off ?? 0) + shiftK - 0.05) };
}

/** em/en dash di semua string props -> tanda hubung biasa */
function deepDeDash<T>(v: T): T {
  if (typeof v === 'string') return deDash(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deepDeDash(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = deepDeDash(x);
    return o as T;
  }
  return v;
}
