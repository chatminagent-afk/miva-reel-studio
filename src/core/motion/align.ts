// Penjajaran fuzzy naskah brief -> transkrip Whisper (kata mentah). Tahap 2 dari 4.
//
// Steven improvisasi ("ngurus" vs "urus", "itu-itu lagi" vs "itu-itu aja") dan sebagian kata dipotong dari hasil edit, jadi:
//  - token dinormalkan (huruf kecil, tanpa tanda baca, huruf ganda dilipat, varian umum: nggak/gak/ga, aja/saja, -nya, MiFA -> miva);
//  - kemiripan token = edit-distance ternormalisasi + kesamaan batang kata;
//  - tiap baris naskah dicocokkan ke jendela transkrip dengan alignment lokal (semi-global di sisi naskah: kata naskah yang
//    tidak terucap kena penalti kecil, kata transkrip tambahan/improvisasi penalti lebih kecil);
//  - DP antar-baris menjaga urutan monoton: baris ke-i selalu berada sesudah baris ke-(i-1).
// Penjajaran memakai SEMUA kata mentah (termasuk yang dipotong dari edit); pemetaan ke waktu hasil edit dilakukan resolve.ts.

export interface WordLike {
  w: string;
}

export interface Placement {
  /** indeks kata mentah pertama / terakhir yang cocok */
  from: number;
  to: number;
  /** skor alignment (untuk DP) */
  score: number;
  /** bobot token naskah yang cocok / total bobot token naskah (0..1) */
  conf: number;
  /** jumlah token isi (bukan stopword) yang cocok */
  contentMatched: number;
  /** pasangan (indeks token naskah, indeks kata mentah) */
  pairs: [number, number][];
}

// ---------- normalisasi ----------

const ALIAS: Record<string, string> = {
  // kebiasaan Whisper pada nama produk
  mifa: 'miva', mipa: 'miva', miba: 'miva', mepa: 'miva', mipha: 'miva', miva: 'miva', viva: 'miva', vira: 'miva', mifah: 'miva',
  // negasi
  nggak: 'gak', ngak: 'gak', nga: 'gak', gk: 'gak', ga: 'gak', gak: 'gak', enggak: 'gak', engak: 'gak', tidak: 'gak', tdk: 'gak',
  nda: 'gak', ngga: 'gak',
  // varian umum
  saja: 'aja', aja: 'aja', bgt: 'banget', udh: 'udah', sudah: 'udah', udah: 'udah', gue: 'gue', gw: 'gue', gua: 'gue',
  lu: 'lo', kalo: 'kalau', klo: 'kalau', klu: 'kalau', sama: 'sama', emang: 'memang', tuh: 'itu', trus: 'terus', makanya: 'makanya',
  bales: 'balas', dibales: 'dibalas', dibeles: 'dibalas', beles: 'balas', ngebales: 'balas', blm: 'belum', dgn: 'dengan', yg: 'yang',
  utk: 'untuk', krn: 'karena', jd: 'jadi', tp: 'tapi', sy: 'saya', bs: 'bisa', org: 'orang', hp: 'hp',
  handover: 'handover', followup: 'followup',
};

const STOP = new Set([
  'yang', 'di', 'ke', 'dan', 'itu', 'ini', 'kamu', 'aku', 'gue', 'lo', 'nya', 'ya', 'sih', 'deh', 'dong', 'lah', 'kan', 'nih', 'juga',
  'aja', 'dengan', 'untuk', 'buat', 'dari', 'karena', 'jadi', 'tapi', 'lagi', 'sama', 'atau', 'pas', 'udah', 'dah', 'kok', 'tuh',
  'ada', 'mau', 'bisa', 'jadi', 'akan', 'se', 'nah', 'loh', 'lho', 'ku', 'mu', 'pun',
]);

/** Normalisasi satu token: huruf kecil, tanpa diakritik/tanda baca, huruf ganda dilipat, varian dipetakan. */
export function normToken(t: string): string {
  let s = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^a-z0-9]/g, '');
  if (!s) return '';
  s = s.replace(/([a-z])\1+/g, '$1');
  // "ngurus" -> "urus", "ngapain" -> "apain" (awalan ng- kolokial sebelum vokal)
  const alias = ALIAS[s];
  if (alias) return alias;
  if (/^ng[aiueo]/.test(s)) s = s.slice(2);
  return ALIAS[s] ?? s;
}

/** Pecah teks jadi token ternormalisasi. Tanda hubung memisahkan kata; sufiks "-nya" digabung ke kata sebelumnya. */
export function tokenize(text: string): string[] {
  const cleaned = text
    .replace(/\*\*/g, ' ')
    .replace(/-nya\b/gi, 'nya')
    .replace(/\b(\w+)nya\b/gi, (m) => m);
  const out: string[] = [];
  for (const piece of cleaned.split(/[\s\-‐-―/]+/)) {
    const n = normToken(piece);
    if (n) out.push(n);
  }
  return out;
}

function stem(w: string): string {
  let s = w;
  s = s.replace(/^(meng|meny|men|mem|me|ber|per|ter|di|ke|se|pe)(?=.{4,})/, '');
  s = s.replace(/(nya|kan|lah|kah|in|an|i)$/, (m) => (s.length - m.length >= 3 ? '' : m));
  return s;
}

function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

const simCache = new Map<string, number>();

/** Kemiripan dua token ternormalisasi, 0 kalau di bawah ambang. */
export function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const key = a < b ? a + '|' + b : b + '|' + a;
  const hit = simCache.get(key);
  if (hit !== undefined) return hit;
  let r = 0;
  const L = Math.max(a.length, b.length);
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) r = 0;
  else if (L >= 4) {
    const sa = stem(a);
    const sb = stem(b);
    if (sa.length >= 3 && sa === sb) r = 0.92;
    else {
      const ratio = 1 - lev(a, b) / L;
      const ratio2 = sa.length >= 3 && sb.length >= 3 ? 1 - lev(sa, sb) / Math.max(sa.length, sb.length) : 0;
      const best = Math.max(ratio, ratio2 * 0.95);
      r = best >= 0.74 ? best : 0;
    }
  }
  if (simCache.size > 200000) simCache.clear();
  simCache.set(key, r);
  return r;
}

const weight = (t: string) => (STOP.has(t) ? 0.4 : 1);

// ---------- alignment satu baris ----------

const GAP_SCRIPT = 0.5; // kata naskah tidak terucap (dipotong/diganti), dikali bobot
const GAP_WORD = 0.3; // kata transkrip tambahan (improvisasi) di tengah baris
const MISMATCH = 0.55; // substitusi (salah dengar Whisper), dikali bobot

/**
 * Cocokkan satu baris naskah (token) ke transkrip (token) dalam jendela [lo, hi] (inklusif). Mengembalikan kandidat
 * penempatan, satu per kolom akhir yang menjadi puncak lokal, diurutkan skor menurun.
 */
export function fitLine(tokens: string[], tw: string[], lo: number, hi: number, maxCand = 12): Placement[] {
  const n = tokens.length;
  if (!n || lo > hi) return [];
  const m = hi - lo + 1;
  const w = tokens.map(weight);
  const totalW = w.reduce((a, b) => a + b, 0);
  const W = m + 1;
  // H[i][j]: i token naskah diproses, j kata transkrip dipakai (kolom 1-based relatif ke lo)
  const H = new Float64Array((n + 1) * W);
  const B = new Uint8Array((n + 1) * W); // 1 = cocok/substitusi (diagonal), 2 = lewati token naskah, 3 = lewati kata transkrip
  for (let i = 1; i <= n; i++) {
    H[i * W] = H[(i - 1) * W] - GAP_SCRIPT * w[i - 1];
    B[i * W] = 2;
  }
  for (let i = 1; i <= n; i++) {
    const ti = tokens[i - 1];
    for (let j = 1; j <= m; j++) {
      const s = tokenSim(ti, tw[lo + j - 1]);
      const diag = H[(i - 1) * W + j - 1] + (s > 0 ? w[i - 1] * s : -MISMATCH * w[i - 1]);
      const up = H[(i - 1) * W + j] - GAP_SCRIPT * w[i - 1];
      const left = H[i * W + j - 1] - GAP_WORD;
      let best = diag;
      let bk = 1;
      if (up > best) {
        best = up;
        bk = 2;
      }
      if (left > best) {
        best = left;
        bk = 3;
      }
      H[i * W + j] = best;
      B[i * W + j] = bk;
    }
  }
  // puncak lokal di baris terakhir
  const ends: { j: number; v: number }[] = [];
  for (let j = 1; j <= m; j++) {
    const v = H[n * W + j];
    if (v <= 0) continue;
    const l = j > 1 ? H[n * W + j - 1] : -Infinity;
    const r = j < m ? H[n * W + j + 1] : -Infinity;
    if (v >= l && v > r) ends.push({ j, v });
  }
  ends.sort((a, b) => b.v - a.v);
  const out: Placement[] = [];
  for (const e of ends.slice(0, maxCand)) {
    let i = n;
    let j = e.j;
    const pairs: [number, number][] = [];
    while (i > 0 && j > 0) {
      const k = B[i * W + j];
      if (k === 1) {
        if (tokenSim(tokens[i - 1], tw[lo + j - 1]) > 0) pairs.push([i - 1, lo + j - 1]);
        i--;
        j--;
      } else if (k === 2) i--;
      else j--;
    }
    if (!pairs.length) continue;
    pairs.reverse();
    let matchedW = 0;
    let content = 0;
    for (const [ti, wj] of pairs) {
      matchedW += w[ti] * tokenSim(tokens[ti], tw[wj]);
      if (w[ti] === 1) content++;
    }
    out.push({
      from: pairs[0][1],
      to: pairs[pairs.length - 1][1],
      score: e.v,
      conf: matchedW / totalW,
      contentMatched: content,
      pairs,
    });
  }
  return out;
}

// ---------- alignment banyak baris (monoton) ----------

export interface LineAlign extends Placement {
  line: number;
}

export interface AlignOptions {
  /** konfiden minimum supaya baris dianggap terjajar */
  minConf?: number;
}

/**
 * Jajarkan baris-baris naskah (urutan dokumen) ke transkrip. Hasil[i] = penempatan baris i, atau null kalau tidak ada
 * yang cukup yakin. Penempatan antar-baris tidak bertumpuk dan mengikuti urutan baris.
 */
export function alignLines(lines: string[], words: WordLike[], opts: AlignOptions = {}): (LineAlign | null)[] {
  const minConf = opts.minConf ?? 0.5;
  const tw = words.map((x) => normToken(x.w));
  const W = tw.length;
  const toks = lines.map(tokenize);
  const cands: Placement[][] = toks.map((t) => {
    if (!t.length || !W) return [];
    return fitLine(t, tw, 0, W - 1, 14).filter((p) => {
      const need = t.length <= 3 ? 0.66 : 0.4;
      return p.conf >= need && p.contentMatched >= (t.filter((x) => weight(x) === 1).length >= 2 ? 2 : 1);
    });
  });
  // DP: best[i][c] = skor terbaik dengan baris i memakai kandidat c
  const best: number[][] = [];
  const prev: ({ i: number; c: number } | null)[][] = [];
  // bestPrefix[e] = (nilai, penunjuk) terbaik dari baris sebelumnya yang berakhir di kata < e
  let frontier: { v: number; ref: { i: number; c: number } | null }[] = new Array(W + 1).fill(null).map(() => ({ v: 0, ref: null }));
  for (let i = 0; i < lines.length; i++) {
    best[i] = [];
    prev[i] = [];
    const add: { end: number; v: number; ref: { i: number; c: number } }[] = [];
    cands[i].forEach((p, c) => {
      const base = frontier[p.from]; // kata < p.from
      best[i][c] = p.score + base.v;
      prev[i][c] = base.ref;
      add.push({ end: p.to, v: best[i][c], ref: { i, c } });
    });
    // perbarui frontier: frontier[e] = terbaik di antara frontier lama dan kandidat yang berakhir pada kata < e
    const next = frontier.map((x) => ({ ...x }));
    for (const a of add) {
      for (let e = a.end + 1; e <= W; e++) {
        if (a.v > next[e].v) next[e] = { v: a.v, ref: a.ref };
      }
    }
    frontier = next;
  }
  const result: (LineAlign | null)[] = new Array(lines.length).fill(null);
  let ref = frontier[W].ref;
  while (ref) {
    const p = cands[ref.i][ref.c];
    if (p.conf >= minConf || (p.conf >= 0.4 && p.contentMatched >= 3)) result[ref.i] = { ...p, line: ref.i };
    ref = prev[ref.i][ref.c];
  }
  return result;
}

/**
 * Cari satu kutipan/frasa di jendela [lo, hi]. Dipakai untuk mengikat isi motion (mis. "Harga berapa?") ke kata yang
 * benar-benar diucapkan. Ambang ketat supaya kutipan layar yang tidak diucapkan tidak menempel ke kata acak.
 */
export function alignPhrase(text: string, words: WordLike[], lo: number, hi: number): Placement | null {
  const toks = tokenize(text);
  if (!toks.length) return null;
  const tw = words.map((x) => normToken(x.w));
  const L = Math.max(0, lo);
  const H = Math.min(tw.length - 1, hi);
  if (L > H) return null;
  const cands = fitLine(toks, tw, L, H, 6);
  const content = toks.filter((t) => weight(t) === 1).length;
  for (const p of cands) {
    if (p.conf >= 0.8 && p.contentMatched >= Math.min(2, Math.max(1, content))) return p;
  }
  return null;
}
