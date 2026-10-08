// Runtime bersama komponen motion: CSS dasar (token, kartu, chip, nada), helper JS animasi, dan utilitas penulis HTML/JS.
//
// Pagar tabrakan dengan overlay.* tulisan tangan skill yang bisa ikut di dokumen yang sama (dipasang SETELAH motion app):
// - CSS: semua kelas berawalan `.mv-`, semua id berawalan `mv-`, variabel `--mv-*`. Tidak menyentuh `:root`/`#id` skill.
// - JS: seluruh JS motion dibungkus SATU IIFE (lihat index.ts) dan tiap komponen dalam blok `{ }` sendiri, jadi tidak ada
//   deklarasi global; `const show/pop/hide/...` milik overlay.js skill tidak bentrok.
// Semua animasi deterministik dan seek-safe: hanya tl.fromTo/to/set pada `tl` global di waktu absolut, immediateRender:false
// pada fromTo, tanpa tl.call, tanpa acak (PRNG berbenih), tanpa Date, tanpa timer, tanpa URL jaringan.
import type { MotionSfx, ResolvedMotion, Tone } from './types';

/** Lama animasi keluar (detik): selesai tepat di t1. */
export const EXIT_DUR = 0.25;
/**
 * Font wordmark MIVA = Montserrat 800/600 seperti skill, dibundel di resources/render/fonts.css (@fontsource/montserrat).
 * Keluarga font tanpa @font-face lokal membuat compiler HyperFrames mengunduhnya dari Google (gagal offline).
 */
export const WORDMARK_FONT = '"Montserrat", "Inter", sans-serif';

// ---------- nada (tone) ----------

interface ToneDef {
  /** warna utama (garis, ring) */
  c: string;
  /** "r,g,b" untuk rgba() */
  rgb: string;
  /** teks/ikon terang di atas latar gelap bernada */
  ct: string;
  /** angka besar (counter) */
  n: string;
  /** isian lingkaran ikon (counter) */
  bg: string;
}

export const TONES: Record<Tone, ToneDef> = {
  dark: { c: '#8aa39e', rgb: '138,163,158', ct: '#E7EEEA', n: '#E7EEEA', bg: '#1D322D' },
  mint: { c: '#BBE1D4', rgb: '187,225,212', ct: '#d9f1e8', n: '#BBE1D4', bg: '#3b6b5c' },
  red: { c: '#ff6b5e', rgb: '255,107,94', ct: '#ffb3ac', n: '#ff6b5e', bg: '#ff6b5e' },
  amber: { c: '#ffb547', rgb: '255,181,71', ct: '#ffd9a0', n: '#ffb547', bg: '#e89a1f' },
  green: { c: '#2fbf7a', rgb: '47,191,122', ct: '#9ff3c8', n: '#5fe39a', bg: '#25a35a' },
  cyan: { c: '#22d6ee', rgb: '34,214,238', ct: '#a6f0fa', n: '#22d6ee', bg: '#1c9db3' },
  gold: { c: '#ffd65a', rgb: '255,214,90', ct: '#ffe8a3', n: '#ffd65a', bg: '#d9a92a' },
};

export function toneOf(t: Tone | undefined, fallback: Tone = 'dark'): ToneDef {
  return TONES[t ?? fallback] ?? TONES[fallback];
}
export function toneClass(t: Tone | undefined, fallback: Tone = 'dark'): string {
  return `mv-t-${t && TONES[t] ? t : fallback}`;
}

// ---------- CSS dasar ----------

const toneCss = (Object.keys(TONES) as Tone[])
  .map((k) => `.mv-t-${k} { --c: ${TONES[k].c}; --rgb: ${TONES[k].rgb}; --ct: ${TONES[k].ct}; --cn: ${TONES[k].n}; --cb: ${TONES[k].bg}; }`)
  .join('\n');

export const RUNTIME_CSS = `/* ===== motion app (mv-): runtime bersama ===== */
:root { --mv-bg: #0A1513; --mv-s1: #13221f; --mv-s2: #1D322D; --mv-mint: #BBE1D4; --mv-teal: #8aa39e; --mv-ink: #E7EEEA;
        --mv-bot: #0e6b52; --mv-gold: #ffd65a; --mv-red: #ff6b5e; --mv-amber: #ffb547; --mv-green: #2fbf7a; --mv-cyan: #22d6ee;
        --mv-card: rgba(10, 21, 19, 0.90); --mv-cline: rgba(187, 225, 212, 0.22); --mv-wm: ${WORDMARK_FONT}; }
.mv-r { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; pointer-events: none; font-family: "Inter", sans-serif; color: #fff; }
.mv-scrim { position: absolute; inset: 0; opacity: 0; background: rgba(10, 21, 19, 0.82); }
.mv-card { background: var(--mv-card); border: 1.5px solid var(--mv-cline); border-radius: 36px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45); }
.mv-mk { display: block; fill: none; stroke: none; width: 100%; height: auto; }
.mv-i { display: block; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.mv-tile { width: 100px; height: 100px; border-radius: 28px; background: #eef2f6; display: grid; place-items: center; flex: none; }
.mv-tile .mv-mk { width: 78%; }
.mv-c { display: none; }
.mv-pill { position: absolute; left: 0; right: 0; display: flex; justify-content: center; opacity: 0; }
.mv-pill > span { padding: 14px 36px; border-radius: 22px; background: rgba(10, 21, 19, 0.86); font-size: 50px; font-weight: 800; letter-spacing: -0.5px;
                color: #fff; text-align: center; max-width: 980px; line-height: 1.2; }
.mv-pill em { font-style: italic; color: var(--mv-mint); }
.mv-chip { display: flex; align-items: center; gap: 10px; height: 72px; padding: 0 24px; border-radius: 36px; white-space: nowrap; opacity: 0;
           background: rgba(var(--rgb), 0.14); border: 2.5px solid rgba(var(--rgb), 0.85); color: var(--ct);
           font-size: 28px; font-weight: 900; letter-spacing: 1px; }
.mv-chip small { font-size: 26px; font-weight: 600; letter-spacing: 0; color: rgba(255, 255, 255, 0.86); }
.mv-chip .mv-i { width: 32px; height: 32px; stroke-width: 4.5; flex: none; }
/* pill bubble chat putih (split, bubbles) */
.mv-fb { position: absolute; display: flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 26px 26px 26px 8px; background: #fff; color: #111;
         font-size: 29px; font-weight: 800; white-space: nowrap; opacity: 0; box-shadow: 0 10px 26px rgba(0, 0, 0, 0.4); }
.mv-fb i { width: 12px; height: 12px; border-radius: 50%; background: #25a35a; flex: none; }
${toneCss}
`;

// ---------- JS runtime (isi IIFE; tidak mendeklarasikan apa pun ke global) ----------

export const RUNTIME_JS = `// ---- runtime motion (helper bersama; tl/D/DUR milik template) ----
const $ = (id) => document.getElementById(id);
// id polos -> elemen; selector ("#a .b", ".c") dan elemen dilewatkan apa adanya (GSAP menanganinya)
const E = (x) => (typeof x === "string" && !/^[#.\\[]|\\s/.test(x) ? $(x) : x);
const IN = { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", ease: "power3.out", immediateRender: false };
const mv = {
  // masuk halus (power3.out + blur-in)
  show(el, t, d) { tl.fromTo(E(el), { opacity: 0, y: 18, scale: 0.96, filter: "blur(6px)" }, { ...IN, duration: d || 0.32 }, t); },
  // masuk membal (back.out)
  pop(el, t, d) {
    tl.fromTo(E(el), { opacity: 0, y: 26, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, duration: d || 0.3, ease: "back.out(1.7)", immediateRender: false }, t);
  },
  // masuk dari samping (fx = geser awal px)
  slide(el, t, fx, d) {
    tl.fromTo(E(el), { opacity: 0, x: fx, scale: 0.7 }, { opacity: 1, x: 0, scale: 1, duration: d || 0.28, ease: "back.out(1.8)", immediateRender: false }, t);
  },
  // keluar: pudar + blur
  hide(el, t, d) { tl.to(E(el), { opacity: 0, filter: "blur(10px)", duration: d || 0.24, ease: "power2.in" }, t); },
  // huruf diketik: tiap span .mv-c disembunyikan (display:none) lalu dimunculkan per huruf, jadi bubble tumbuh mengikuti ketikan
  type(el, t, cps) {
    const e = E(el), cs = e.querySelectorAll(".mv-c");
    tl.fromTo(e, { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none", immediateRender: false }, t);
    cs.forEach((s, k) => tl.set(s, { display: "inline" }, t + k / cps));
    return t + cs.length / cps;
  },
  // tiga titik mengetik, melompat bergantian dari t0 sampai t1 lalu hilang
  dots(el, t0, t1) {
    const e = E(el);
    tl.fromTo(e, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.15, ease: "power3.out", immediateRender: false }, t0);
    const bs = e.querySelectorAll("b");
    for (let t = t0 + 0.1, k = 0; t < t1 - 0.12; t += 0.16, k++)
      bs.forEach((b, j) => tl.to(b, { y: j === k % 3 ? -7 : 0, opacity: j === k % 3 ? 1 : 0.55, duration: 0.14, ease: "sine.inOut" }, t));
    tl.set(e, { display: "none" }, t1);
  },
  // tiga titik status melompat bergantian dari t0 sampai t1 (tanpa muncul/hilang; elemen <b> di dalam el)
  jump(el, t0, t1) {
    const bs = E(el).querySelectorAll("b");
    for (let t = t0, k = 0; t < t1; t += 0.16, k++)
      bs.forEach((b, j) => tl.to(b, { y: j === k % 3 ? -6 : 0, opacity: j === k % 3 ? 1 : 0.5, duration: 0.14, ease: "sine.inOut" }, t));
  },
  // kilat putih (#flash milik template)
  flash(t, o) {
    tl.fromTo("#flash", { opacity: 0 }, { opacity: o || 0.25, duration: 0.05, ease: "none", immediateRender: false }, t);
    tl.to("#flash", { opacity: 0, duration: 0.25, ease: "power2.out" }, t + 0.06);
  },
  // denyut skala (mis. angka berganti)
  bump(el, t, s) {
    tl.fromTo(E(el), { scale: 1 }, { scale: s || 1.35, duration: 0.1, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, t);
  },
  // getar horizontal (n genap = kembali ke posisi awal)
  shake(el, t, amp, n) {
    tl.fromTo(E(el), { x: 0 }, { x: amp || 6, duration: 0.04, yoyo: true, repeat: n || 7, ease: "none", immediateRender: false }, t);
  },
  // cincin menyebar di sekeliling elemen (rgb = "r,g,b")
  ring(el, t, rgb) {
    tl.fromTo(E(el), { boxShadow: "0 0 0 0px rgba(" + rgb + ",0.5)" }, { boxShadow: "0 0 0 14px rgba(" + rgb + ",0)", duration: 0.5, ease: "power2.out", immediateRender: false }, t);
  },
  // PRNG berbenih (mulberry32 dari string): deterministik, pengganti acak
  rng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
};
`;

// ---------- utilitas penulis (TypeScript) ----------

/** Cue SFX motion (tipe kontrak MotionSfx). `dur` (opsional) memotong klip di mixer, mis. ketik selama teks diketik. */
export function cue(t: number, kat: string, gain_db?: number, o: { align?: boolean; dur?: number } = {}): MotionSfx {
  const c: MotionSfx = { t: r3(t), kat };
  if (gain_db !== undefined) c.gain_db = gain_db;
  if (o.align) c.align = true;
  if (o.dur) c.dur = r3(o.dur);
  return c;
}

export const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** id item -> potongan id DOM aman (huruf kecil, angka, - dan _). */
export function uid(id: string): string {
  const s = id.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'x';
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Nilai -> literal JS aman di dalam <script> ("<" di-escape supaya "</script>" tidak menutup tag). */
export function js(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

/** Teks -> deretan span huruf tersembunyi (display:none lewat .mv-c); mv.type memunculkannya satu per satu. Spasi tetap spasi biasa supaya teks bisa membungkus baris. */
export function typedHtml(text: string): string {
  return Array.from(text)
    .map((ch) => `<span class="mv-c">${esc(ch)}</span>`)
    .join('');
}

/** PRNG berbenih (mulberry32) untuk penentuan tata letak saat build. Deterministik per seed. */
export function rngFor(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Teks dengan frasa disorot/dicoret. Mengembalikan HTML (sudah di-escape). Pencocokan tanpa peka huruf besar-kecil,
 * frasa terpanjang didahulukan, tidak tumpang tindih. `wrap(kind, text)` membuat markup tiap cocokan.
 */
export function markup(
  text: string,
  marks: { accent?: string[]; strike?: string[] },
  wrap: (kind: 'accent' | 'strike', hit: string, idx: number) => string,
): string {
  const phrases: { p: string; kind: 'accent' | 'strike' }[] = [];
  for (const p of marks.strike ?? []) if (p) phrases.push({ p, kind: 'strike' });
  for (const p of marks.accent ?? []) if (p) phrases.push({ p, kind: 'accent' });
  phrases.sort((a, b) => b.p.length - a.p.length);
  const low = text.toLowerCase();
  const taken: { s: number; e: number; kind: 'accent' | 'strike' }[] = [];
  for (const { p, kind } of phrases) {
    const q = p.toLowerCase();
    let from = 0;
    for (;;) {
      const i = low.indexOf(q, from);
      if (i < 0) break;
      from = i + q.length;
      if (taken.some((x) => i < x.e && i + q.length > x.s)) continue;
      taken.push({ s: i, e: i + q.length, kind });
    }
  }
  taken.sort((a, b) => a.s - b.s);
  let out = '';
  let pos = 0;
  let sk = 0;
  for (const m of taken) {
    out += esc(text.slice(pos, m.s));
    out += wrap(m.kind, esc(text.slice(m.s, m.e)), m.kind === 'strike' ? sk++ : -1);
    pos = m.e;
  }
  return out + esc(text.slice(pos));
}

// ---------- waktu internal ----------

/** n titik merata dari a ke b (inklusif). n=1 -> [a]. */
export function evenly(n: number, a: number, b: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [a];
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
}

/**
 * n titik waktu untuk langkah internal. Memakai item.beatTimes bila cukup; kalau hanya sebagian, sisanya dibagi rata
 * sesudah beat terakhir; kalau kosong, dibagi rata di [a, b]. Hasil dijepit ke [t0, t1 - 0.3] dan dinaikkan monoton.
 */
export function beatsOr(item: ResolvedMotion, n: number, a: number, b: number): number[] {
  const given = (item.beatTimes ?? []).filter((x) => Number.isFinite(x));
  let out: number[];
  if (given.length >= n) out = given.slice(0, n);
  else if (given.length === 0) out = evenly(n, a, b);
  else {
    const last = given[given.length - 1];
    const rest = n - given.length;
    const step = Math.max(0.12, (b - last) / (rest + 1));
    out = [...given, ...Array.from({ length: rest }, (_, i) => last + step * (i + 1))];
  }
  const hi = Math.max(item.t0, item.t1 - 0.3);
  let prev = -Infinity;
  return out.map((x) => {
    const v = Math.max(prev, Math.min(hi, Math.max(item.t0, x)));
    prev = v;
    return r3(v);
  });
}

/**
 * Titik waktu dengan nilai bawaan per indeks yang boleh ditimpa beatTimes (index-by-index), dijepit ke [t0, t1 - 0.3].
 * Untuk komponen yang beat-nya bukan deret rata (mis. node rapat lalu jeda lalu morph).
 */
export function withBeats(item: ResolvedMotion, defaults: number[]): number[] {
  const given = (item.beatTimes ?? []).filter((x) => Number.isFinite(x));
  const hi = Math.max(item.t0, item.t1 - 0.3);
  return defaults.map((d, i) => r3(Math.max(item.t0, Math.min(hi, i < given.length ? given[i] : d))));
}

/** Waktu mulai keluar (detik): animasi keluar selesai di t1. */
export function exitAt(item: ResolvedMotion): number {
  return r3(Math.max(item.t0 + 0.1, item.t1 - EXIT_DUR));
}
