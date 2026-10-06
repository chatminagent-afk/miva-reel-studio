// Port skill reel-edit `captions.py`: timing.json -> draf captions.json (kelompok kata + animasi default).
// Kata kunci ditandai sesudahnya (manual di UI, atau saran Rules / Local LLM / Claude).
import { pyLen } from './py';
import type { CaptionsJson, Chunk, TimingJson } from './types';

export const MAX_WORDS = 3;
export const MAX_CHARS = 18;
export const GAP = 0.3;
export const CPS = 28; // kecepatan ketik subtitle (huruf/dtk), sama dengan template

export function draftCaptions(T: TimingJson): CaptionsJson {
  const W = T.words;
  const chunks: number[][] = [];
  let cur: number[] = [];
  W.forEach((w, i) => {
    if (w.w.startsWith('-') && cur.length) {
      // "aplikasi -aplikasi" = satu kata tampil
      cur.push(i);
      return;
    }
    const text = cur.map((j) => W[j].w).join(' ');
    const last = cur.length ? W[cur[cur.length - 1]] : null;
    const newSeg = !!last && last.seg !== w.seg;
    const gap = !!last && w.s - last.e > GAP;
    if (
      last &&
      (cur.length >= MAX_WORDS || pyLen(text) + pyLen(w.w) > MAX_CHARS || gap || newSeg || /[,.?!]$/.test(last.w))
    ) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(i);
  });
  if (cur.length) chunks.push(cur);

  const res: Chunk[] = chunks.map((c, k) => {
    const text = c.map((j) => W[j].w).join(' ');
    const nxt = k + 1 < chunks.length ? W[chunks[k + 1][0]].s : T.duration;
    const room = nxt - W[c[0]].s;
    const prev = k > 0 ? chunks[k - 1] : null;
    const sentStart =
      k === 0 || /[.?!]$/.test(W[prev![prev!.length - 1]].w) || W[c[0]].seg !== W[prev![prev!.length - 1]].seg;
    const anim = sentStart && room >= pyLen(text) / CPS + 0.3 ? 'type' : 'pop';
    return { w: c, anim, _teks: text };
  });
  return { chunks: res };
}
