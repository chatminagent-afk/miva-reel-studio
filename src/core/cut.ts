// Port bagian pasca-Whisper dari skill reel-edit `transcribe.py`: pangkas akhir kata yang molor memakai energi
// pita suara, lalu usulkan potongan (segs) dari celah antar-kata.
//
// Kenapa bukan silencedetect: footage HP (mis. di mobil) punya noise rata ±-20 dB, jadi jeda bicara tidak pernah
// "sunyi". Yang dipakai: energi pita suara 250–3500 Hz per 10 ms + celah antar-kata Whisper.
import { decodeMono16 } from './ffmpeg';
import { percentile, pyRound } from './py';
import type { RawWord, Seg } from './types';

import { GAP_CUT, PAD_IN, PAD_OUT } from './cutparams';

export { GAP_CUT, PAD_IN, PAD_OUT };
export const SR = 16000;
const HOP = 160; // 10 ms

/** Energi pita suara per 10 ms dalam dB (sama dengan band_db di skill). */
export function bandDbFromSamples(a: Float32Array): Float64Array {
  const n = Math.ceil(a.length / HOP);
  const out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    const i0 = f * HOP;
    const i1 = Math.min(a.length, i0 + HOP);
    let sum = 0;
    for (let i = i0; i < i1; i++) sum += a[i] * a[i];
    out[f] = 20 * Math.log10(Math.sqrt(sum / (i1 - i0)) + 1e-9);
  }
  return out;
}

/** Energi pita suara + durasi audio (jumlah sampel 16 kHz / 16000, sama dengan skill). */
export async function analyzeAudio(src: string): Promise<{ edb: Float64Array; duration: number }> {
  const a = await decodeMono16(src, SR, 'highpass=f=250,lowpass=f=3500');
  return { edb: bandDbFromSamples(a), duration: a.length / SR };
}

export interface CutOptions {
  gapCut?: number;
  padIn?: number;
  padOut?: number;
}

export interface CutResult {
  words: RawWord[]; // dengan e_ref terisi
  segs: Seg[];
  floor: number;
  keptDuration: number;
}

/**
 * @param words kata Whisper (waktu dalam detik, footage mentah)
 * @param edb energi pita suara per 10 ms (bandDb)
 * @param duration durasi audio mentah (detik)
 */
export function proposeCuts(words: RawWord[], edb: ArrayLike<number>, duration: number, opts: CutOptions = {}): CutResult {
  const gapCut = opts.gapCut ?? GAP_CUT;
  const padIn = opts.padIn ?? PAD_IN;
  const padOut = opts.padOut ?? PAD_OUT;
  const floor = percentile(edb, 20);
  const thr = floor + 5;

  const ws = words.map((w) => ({ ...w }));
  for (const w of ws) {
    const a = Math.trunc(w.s * 100);
    const b = Math.trunc(w.e * 100);
    let last = -1;
    for (let i = a; i < Math.min(b, edb.length); i++) if (edb[i] > thr) last = i - a;
    const end = last >= 0 ? (a + last + 1) / 100 : w.e;
    w.e_ref = pyRound(Math.max(w.s + 0.08, end), 3);
  }

  const cut: [number, number][] = [];
  for (const w of ws) {
    const prev = cut[cut.length - 1];
    if (prev && w.s - prev[1] < gapCut) prev[1] = w.e_ref!;
    else cut.push([w.s, w.e_ref!]);
  }

  const segs: Seg[] = [];
  cut.forEach(([a0, b0], i) => {
    const a = Math.max(0, a0 - padIn, segs.length ? segs[segs.length - 1][1] : 0);
    const b = Math.min(duration, b0 + padOut, i + 1 < cut.length ? cut[i + 1][0] - 0.02 : duration);
    segs.push([pyRound(a, 2), pyRound(b, 2)]);
  });
  const keptDuration = segs.reduce((acc, [a, b]) => acc + (b - a), 0);
  return { words: ws, segs, floor, keptDuration };
}
