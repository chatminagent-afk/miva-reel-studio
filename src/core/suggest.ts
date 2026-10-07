// Saran otomatis Auto Edit yang jalan offline: retake (ulang ucapan) dan kata kunci mode "Rules".
// Semua saran bisa diterima/ditolak di editor; tidak ada yang permanen.
import type { RawWord } from './types';

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export interface Retake {
  /** kata mentah yang dibuang (percobaan pertama) */
  words: number[];
  /** rentang footage mentah yang dibuang */
  from: number;
  to: number;
  text: string;
}

const FILLERS = new Set(['eh', 'em', 'emm', 'ehm', 'hmm', 'anu', 'maksudnya', 'maksud', 'sorry', 'sori', 'bentar', 'ulang', 'salah']);

/**
 * Retake = frasa >= 2 kata yang diucapkan ulang dalam 4 dtk setelah jeda atau kata sela ("harus bayar, harus bayar
 * langganan"; "aku mau eh aku mau coba"). Percobaan pertama dibuang sampai awal pengulangan.
 * Bukan retake: pengulangan satu kata ("motion motion grafik", penekanan) dan struktur sejajar dengan isi berbeda di
 * antaranya ("bisa kasih subtitle, terus bisa kasih motion" — kata di antara bukan kata sela).
 */
export function detectRetakes(words: RawWord[], opts: { minWords?: number; maxGap?: number; maxBetween?: number } = {}): Retake[] {
  const minWords = opts.minWords ?? 2;
  const maxGap = opts.maxGap ?? 4;
  const maxBetween = opts.maxBetween ?? 2; // kata sela ("eh", "maksudnya") boleh ada di antara
  const t = words.map((w) => norm(w.w));
  const out: Retake[] = [];
  let i = 0;
  while (i < words.length) {
    let found: Retake | null = null;
    for (let j = i + minWords; j <= i + minWords + maxBetween && j < words.length && !found; j++) {
      let k = 0;
      while (i + k < j && j + k < words.length && t[i + k] && t[i + k] === t[j + k]) k++;
      const pause = words[j].s - (words[j - 1].e_ref ?? words[j - 1].e);
      const between = t.slice(i + k, j);
      const abandoned = between.every((x) => FILLERS.has(x)) && (between.length > 0 || pause >= 0.25 || k >= 3);
      if (k >= minWords && abandoned && words[j].s - (words[i + k - 1].e_ref ?? words[i + k - 1].e) <= maxGap) {
        const idx = Array.from({ length: j - i }, (_, n) => i + n);
        found = { words: idx, from: words[i].s, to: words[j].s, text: idx.map((n) => words[n].w).join(' ') };
      }
    }
    if (found) {
      out.push(found);
      i = found.words[found.words.length - 1] + 1;
    } else i++;
  }
  return out;
}

export interface KeywordMark {
  /** indeks kata mentah yang tampil besar (serif emas) */
  big: number[];
  anim: 'slam' | 'blur' | 'type';
  hit?: 'impact' | 'boom' | null;
  pos?: 'c' | 'l' | 'r';
}

// kata sambung/pengisi bahasa Indonesia lisan yang tidak pernah jadi kata kunci
const STOP = new Set(
  (
    'yang dan di ke dari ini itu aku kamu kita kami gue gua lo lu dia mereka ya sih kan nih tuh deh dong aja saja juga ' +
    'udah sudah bisa akan ada pake pakai buat untuk dengan kalau kalo terus jadi tapi atau karena kayak seperti apa ' +
    'gimana bagaimana kenapa mau lagi masih belum tidak gak nggak enggak ga engga banget sangat lebih paling semua ' +
    'satu dua tiga halo hai guys oke ok nah eh em hmm biasanya katanya menurut kali kita lihat dulu sama punya bikin ' +
    'harus perlu cuma hanya baru lalu nanti sekarang tadi gitu begitu begini gini atau pun para oleh pada dalam luar ' +
    'atas bawah sini situ sana tiap setiap'
  ).split(/\s+/),
);
const NUMBER_WORDS = /^(nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|sejuta|puluh(an)?|ratus(an)?|ribu(an)?|juta(an)?|miliar|triliun|persen)$/;

interface Ctx {
  lower: Set<string>;
  names: Set<string>;
  starts: Set<number>;
}

/**
 * Huruf besar = nama/merek, kecuali di awal kalimat. Whisper memberi huruf besar di awal setiap segmen walau tanpa titik
 * ("Keren gak menurut kalian?"), jadi awal segmen Whisper (dari sidecar) dihitung awal kalimat. Kata yang di tempat lain
 * muncul dengan huruf kecil juga dianggap kata biasa ("Edit" vs "edit").
 */
function isName(words: RawWord[], i: number, c: Ctx): boolean {
  const raw = words[i].w;
  const n = norm(raw);
  if (c.names.has(n)) return true;
  if (!/^\p{Lu}/u.test(raw) || c.lower.has(n) || c.starts.has(i)) return false;
  const prev = words[i - 1];
  return !!prev && !/[.?!]$/.test(prev.w);
}

/** Skor kandidat kata kunci (panduan caption-style.md): angka, nama produk/merek, kata inti di akhir kalimat. */
function score(words: RawWord[], i: number, c: Ctx): number {
  const raw = words[i].w;
  const n = norm(raw);
  if (!n || STOP.has(n)) return 0;
  let s = 0;
  if (/\d/.test(raw) || NUMBER_WORDS.test(n)) s += 3;
  if (isName(words, i, c)) s += 3;
  if (c.names.has(n)) s += 3;
  if (/[.?!]$/.test(raw) && n.length >= 5) s += 1; // kata penutup kalimat
  if (n.length >= 6) s += 1;
  return s;
}

export interface KeywordOptions {
  /** waktu kata di video hasil edit (untuk jarak antar-kata kunci); default waktu mentah */
  timeOf?: (i: number) => number;
  /** kata yang hanya boleh dipilih dari indeks ini (kata yang tidak dipotong) */
  candidates?: number[];
  /** kamus nama/merek dari Settings */
  names?: string[];
  /** indeks kata yang memulai segmen Whisper (awal kalimat) */
  sentenceStarts?: number[];
  /** jarak minimal antar-kata kunci (dtk) */
  minSpacing?: number;
  /** maksimal kata kunci per 30 dtk */
  per30s?: number;
}

/**
 * Mode "Rules" (offline, default): pilih kata dengan skor tertinggi, sekali per kata (kemunculan berikutnya jadi subtitle
 * biasa), berjarak >= 2,5 dtk, maks 7 per 30 dtk. Angka + satuan ("15 juta") digabung jadi satu kata kunci.
 * Animasi: kata pendek slam, kata panjang blur. Hit: kata kunci terakhir impact; angka pertama boom (maks 1).
 */
export function suggestKeywords(words: RawWord[], o: KeywordOptions = {}): KeywordMark[] {
  const timeOf = o.timeOf ?? ((i: number) => words[i].s);
  const cand = o.candidates ?? words.map((_, i) => i);
  const c: Ctx = {
    names: new Set((o.names ?? []).map(norm)),
    lower: new Set(words.filter((w) => !/^\p{Lu}/u.test(w.w)).map((w) => norm(w.w))),
    starts: new Set(o.sentenceStarts ?? []),
  };
  const minSpacing = o.minSpacing ?? 2.5;
  const scored = cand
    .map((i) => ({ i, s: score(words, i, c) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s || timeOf(a.i) - timeOf(b.i));
  const dur = cand.length ? timeOf(cand[cand.length - 1]) - timeOf(cand[0]) : 0;
  const max = Math.max(1, Math.round(((o.per30s ?? 7) * Math.max(dur, 1)) / 30));
  const used = new Set<string>();
  const picked: number[] = [];
  const candSet = new Set(cand);
  // nama dua kata ("Adobe Premiere"): pakai kata pertama sebagai titik pilih
  const nameStart = (i: number) => (i > 0 && candSet.has(i - 1) && isName(words, i - 1, c) && isName(words, i, c) ? i - 1 : i);
  for (const { i: i0 } of scored) {
    if (picked.length >= max) break;
    const i = nameStart(i0);
    if (picked.includes(i)) continue;
    const n = norm(words[i].w);
    if (used.has(n)) continue;
    if (picked.some((p) => Math.abs(timeOf(p) - timeOf(i)) < minSpacing)) continue;
    used.add(n);
    picked.push(i);
  }
  picked.sort((a, b) => a - b);
  let boom = false;
  return picked.map((i, k) => {
    const big = [i];
    const next = i + 1;
    const unit = /\d/.test(words[i].w) && NUMBER_WORDS.test(norm(words[next]?.w ?? ''));
    const twoName = isName(words, i, c) && candSet.has(next) && isName(words, next, c) && !/[,.?!]$/.test(words[i].w);
    if (candSet.has(next) && (unit || twoName)) big.push(next); // "15 juta", "Adobe Premiere"
    const text = big.map((b) => words[b].w).join(' ');
    const isNumber = /\d/.test(words[i].w) || NUMBER_WORDS.test(norm(words[i].w));
    let hit: KeywordMark['hit'] = null;
    if (isNumber && !boom) {
      hit = 'boom';
      boom = true;
    } else if (k === picked.length - 1 && picked.length > 1) hit = 'impact';
    return { big, anim: text.length > 9 ? 'blur' : 'slam', hit };
  });
}
