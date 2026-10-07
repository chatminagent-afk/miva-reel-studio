// Model edit di app: `segs` (rentang waktu footage mentah yang dipakai, sama dengan edit.json skill) adalah satu-satunya
// sumber kebenaran potongan. Transkrip (coret kata, simpan/buang jeda) dan timeline (trim, split) sama-sama mengubah segs,
// jadi keduanya selalu sinkron dan proyek tetap bisa dibuka skill /reel-edit.
//
// Kata dianggap terpakai kalau awal katanya + 0,05 dtk jatuh di dalam salah satu seg: kriteria yang sama dengan
// mapTiming() (build_base.py), jadi status kata di UI = kata yang benar-benar muncul di timing.json.
import { GAP_CUT, PAD_IN, PAD_OUT } from './cut';
import { pyRound } from './py';
import type { RawWord, Seg } from './types';

const EPS = 1e-6;
const r2 = (x: number) => pyRound(x, 2);

/** Rapikan: urutkan, gabung yang bertumpuk/bersentuhan, buang yang terlalu pendek (< 0,05 dtk). */
export function normalizeSegs(segs: Seg[]): Seg[] {
  const s = segs.filter(([a, b]) => b - a > 0.05 - EPS).map(([a, b]) => [r2(a), r2(b)] as Seg).sort((x, y) => x[0] - y[0]);
  const out: Seg[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Buang rentang [a, b] dari segs. */
export function cutRange(segs: Seg[], a: number, b: number): Seg[] {
  const out: Seg[] = [];
  for (const [x, y] of segs) {
    if (y <= a + EPS || x >= b - EPS) out.push([x, y]);
    else {
      if (x < a) out.push([x, a]);
      if (y > b) out.push([b, y]);
    }
  }
  return normalizeSegs(out);
}

/** Tambahkan rentang [a, b] ke segs. */
export function keepRange(segs: Seg[], a: number, b: number): Seg[] {
  return normalizeSegs([...segs, [a, b]]);
}

export function wordKept(segs: Seg[], w: RawWord): boolean {
  const t = w.s + 0.05;
  return segs.some(([a, b]) => a <= t && t <= b);
}

const endOf = (w: RawWord) => w.e_ref ?? w.e;

/**
 * Rentang yang dibuang/dikembalikan saat kata i dicoret/dipulihkan: kata + padding, dibatasi titik tengah ke kata
 * tetangga supaya tidak memakan kata lain.
 */
export function wordSpan(words: RawWord[], i: number, duration: number): [number, number] {
  const w = words[i];
  const prev = words[i - 1];
  const next = words[i + 1];
  const lo = prev ? (endOf(prev) + w.s) / 2 : 0;
  const hi = next ? (endOf(w) + next.s) / 2 : duration;
  return [r2(Math.max(lo, w.s - PAD_IN)), r2(Math.min(hi, endOf(w) + PAD_OUT))];
}

export function setWordKept(segs: Seg[], words: RawWord[], i: number, keep: boolean, duration: number): Seg[] {
  const [a, b] = wordSpan(words, i, duration);
  return keep ? keepRange(segs, a, b) : cutRange(segs, a, b);
}

export interface Gap {
  /** jeda sesudah kata ke-`after` */
  after: number;
  start: number;
  end: number;
  /** jeda dibuang dari video */
  cut: boolean;
}

/** Jeda antar-kata yang cukup panjang untuk diputuskan (>= GAP_CUT), beserta statusnya di segs. */
export function gaps(segs: Seg[], words: RawWord[], minGap = GAP_CUT): Gap[] {
  const out: Gap[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const start = endOf(words[i]);
    const end = words[i + 1].s;
    if (end - start < minGap) continue;
    const mid = (start + end) / 2;
    out.push({ after: i, start, end, cut: !segs.some(([a, b]) => a <= mid && mid <= b) });
  }
  return out;
}

/** Simpan jeda (mis. untuk memberi waktu grafik) atau buang lagi. */
export function setGapKept(segs: Seg[], g: Pick<Gap, 'start' | 'end'>, keep: boolean): Seg[] {
  // padding kata di kedua sisi tidak disentuh
  const a = r2(g.start + PAD_OUT);
  const b = r2(g.end - PAD_IN);
  if (b <= a) return segs;
  return keep ? keepRange(segs, a - 0.01, b + 0.01) : cutRange(segs, a, b);
}

export function keptDuration(segs: Seg[]): number {
  return segs.reduce((acc, [a, b]) => acc + (b - a), 0);
}

/** Waktu footage mentah -> waktu hasil edit (sesudah potong + percepat); null kalau titik itu dibuang. */
export function srcToEdited(segs: Seg[], speed: number, t: number): number | null {
  let acc = 0;
  for (const [a, b] of segs) {
    if (t >= a - EPS && t <= b + EPS) return (acc + Math.min(Math.max(t, a), b) - a) / speed;
    acc += b - a;
  }
  return null;
}

/** Waktu hasil edit -> waktu footage mentah (untuk preview yang memutar footage asli/proxy). */
export function editedToSrc(segs: Seg[], speed: number, te: number): { src: number; seg: number } {
  let acc = 0;
  const x = Math.max(0, te * speed);
  for (let k = 0; k < segs.length; k++) {
    const [a, b] = segs[k];
    if (x <= acc + (b - a) + EPS) return { src: a + (x - acc), seg: k };
    acc += b - a;
  }
  const last = segs.length - 1;
  return { src: last >= 0 ? segs[last][1] : 0, seg: Math.max(0, last) };
}

/** Indeks kata mentah yang masuk timing.json (urutan sama dengan timing.words). */
export function keptWordIndices(segs: Seg[], words: RawWord[]): number[] {
  const out: number[] = [];
  words.forEach((w, i) => {
    if (wordKept(segs, w)) out.push(i);
  });
  return out;
}
