// Pemetaan kata ke waktu base.mp4 (bagian murni build_base.py, tanpa ffmpeg): dipakai proses utama dan UI.
import { pyRound } from './py';
import type { EditJson, RawWord, TimedWord, TimingJson } from './types';

export const SPEED_DEFAULT = 1.25; // fast paced (06/10)

/** `edit.tail` (dtk freeze + hening sesudah kata terakhir), tidak pernah negatif. Sama dengan `tail` di build_base.py skill. */
export function tailOf(edit: Pick<EditJson, 'tail'>): number {
  const t = Number(edit.tail ?? 0);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

export interface TimingResult {
  timing: TimingJson;
  lost: string[];
}

/** Petakan kata mentah ke waktu base.mp4 (sesudah potong + percepat). */
export function mapTiming(edit: EditJson, words: RawWord[]): TimingResult {
  const segs = edit.segs;
  const fix = edit.fix ?? {};
  const speed = Number(edit.speed ?? SPEED_DEFAULT);
  const tail = tailOf(edit);
  const offs: number[] = [];
  let acc = 0;
  for (const [a, b] of segs) {
    offs.push(acc);
    acc += b - a;
  }
  const res: TimedWord[] = [];
  const lost: string[] = [];
  for (const w of words) {
    const t = w.s + 0.05; // awal kata; akhir kata Whisper sering molor
    let found = false;
    for (let k = 0; k < segs.length; k++) {
      const [a, b] = segs[k];
      const o = offs[k];
      if (a <= t && t <= b) {
        const e = Math.min(w.e_ref ?? w.e, b);
        const segIdx = segs.findIndex(([x, y]) => x === a && y === b);
        res.push({
          w: Object.prototype.hasOwnProperty.call(fix, w.w) ? fix[w.w] : w.w,
          s: pyRound((Math.max(w.s, a) - a + o) / speed, 3),
          e: pyRound((e - a + o) / speed, 3),
          seg: segIdx,
        });
        found = true;
        break;
      }
    }
    if (!found) lost.push(w.w);
  }
  return {
    timing: { duration: pyRound(acc / speed + tail, 3), speed, cuts: offs.slice(1).map((o) => pyRound(o / speed, 3)), words: res },
    lost,
  };
}
