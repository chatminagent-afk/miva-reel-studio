// Model tampilan motion untuk UI (murni, tanpa React/DOM): daftar urut waktu, laporan brief, pemetaan sumbu timeline
// (detik hasil edit <-> sumbu footage mentah + ekor), lajur blok yang bertumpuk, snapping dan hitungan seret.
//
// Sumbu timeline = detik FOOTAGE MENTAH (bagian terbuang tetap terlihat). Ekor (`edit.tail`, freeze frame akhir) menyambung
// sesudah durasi footage mentah; 1 detik hasil edit = `speed` detik sumbu, sama dengan bagian footage yang lain.
import { editedToSrc, srcToEdited } from '../../../core/edit';
import { getComponent } from '../../../core/motion';
import type { BriefReport } from '../../../core/motion/resolve';
import type { MotionItem, MotionKind, ResolvedMotion } from '../../../core/motion/types';
import type { Seg } from '../../../core/types';

/** Panjang minimal item (detik hasil edit); sama dengan MIN_LEN di ops.setMotionTimes dan resolveMotion. */
export const MOTION_MIN = 0.5;

/** mm:ss.s, mis. 00:03.4 */
export function mmss(t: number): string {
  const x = Math.max(0, t);
  const m = Math.floor(x / 60);
  const s = x - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export interface MotionRow {
  id: string;
  kind: MotionKind;
  title: string;
  /** label dari brief, kalau kosong judul komponen */
  name: string;
  t0: number;
  t1: number;
  review: boolean;
  scene: boolean;
  silent: boolean;
  manual: boolean;
}

/** Item bertanggal -> baris tampilan, urut waktu mulai (stabil menurut urutan item). */
export function motionRows(resolved: ResolvedMotion[]): MotionRow[] {
  return resolved
    .map((r, i) => {
      const comp = getComponent(r.kind);
      return {
        i,
        row: {
          id: r.id,
          kind: r.kind,
          title: comp?.title ?? r.kind,
          name: r.label?.trim() || comp?.title || r.kind,
          t0: r.t0,
          t1: r.t1,
          review: r.review === true,
          scene: r.scene ?? comp?.sceneDefault ?? false,
          silent: r.silent === true,
          manual: r.origin === 'manual',
        } satisfies MotionRow,
      };
    })
    .sort((a, b) => a.row.t0 - b.row.t0 || a.i - b.i)
    .map((x) => x.row);
}

// ---------- laporan Generate ----------

export interface ReportView {
  /** tidak ada blok yang dikenali */
  empty: boolean;
  blocks: number;
  created: number;
  /** item yang masih ditandai review (turun saat ditandai sudah dicek) */
  review: number;
  /** blok yang waktu mulainya ditebak */
  guessed: number;
  notes: string[];
}

const WARN_EN: [RegExp, string][] = [
  [/hampir tidak cocok/, 'The script in the brief barely matches the transcript: timings were spread evenly, check them by hand.'],
  [/transkrip kosong/, 'The transcript is empty: timings were spread evenly.'],
];

export function reportView(report: BriefReport | undefined, motion: MotionItem[] | undefined, tail: number): ReportView | null {
  if (!report) return null;
  const notes: string[] = [];
  const blocks = report.blocks.length;
  if (report.needsTail > 0) notes.push(tail > 0 ? `End card: the video holds its last frame for ${tail.toFixed(1)} s.` : 'The end card needs an end hold. Set "End card hold" below.');
  if (report.unalignedScript.length) notes.push(`${report.unalignedScript.length} script line${report.unalignedScript.length === 1 ? '' : 's'} not found in the transcript (ignored).`);
  for (const w of report.warnings) {
    if (/blok motion/.test(w) || /butuh edit\.tail/.test(w)) continue; // sudah tercakup "empty" / needsTail
    notes.push(WARN_EN.find(([re]) => re.test(w))?.[1] ?? w);
  }
  return {
    empty: blocks === 0,
    blocks,
    created: report.blocks.reduce((n, b) => n + b.itemIds.length, 0),
    review: (motion ?? []).filter((m) => m.review).length,
    guessed: report.blocks.filter((b) => b.timingGuessed).length,
    notes,
  };
}

// ---------- sumbu timeline ----------

export interface Axis {
  segs: Seg[];
  speed: number;
  /** durasi hasil edit tanpa ekor */
  body: number;
  /** durasi footage mentah (sumbu berakhir di sini, ekor menyambung sesudahnya) */
  raw: number;
}

/** Detik hasil edit -> titik sumbu timeline. */
export function editedToAxis(a: Axis, te: number): number {
  if (te <= a.body + 1e-6) return editedToSrc(a.segs, a.speed, te).src;
  return a.raw + (te - a.body) * a.speed;
}

/** Titik sumbu -> detik hasil edit. Di bagian terbuang: awal bagian terpakai berikutnya (kalau tidak ada: akhir badan). */
export function axisToEdited(a: Axis, x: number): number {
  if (x > a.raw) return a.body + (x - a.raw) / a.speed;
  const v = srcToEdited(a.segs, a.speed, x);
  if (v !== null) return v;
  const next = a.segs.find(([s]) => s > x);
  return next ? srcToEdited(a.segs, a.speed, next[0])! : a.body;
}

/** Lajur untuk blok yang waktunya bertumpuk (greedy): id -> nomor lajur dari 0. `rows` harus urut t0. */
export function assignLanes(rows: { id: string; t0: number; t1: number }[]): { lanes: Map<string, number>; count: number } {
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const r of rows) {
    let l = ends.findIndex((e) => e <= r.t0 + 1e-6);
    if (l < 0) {
      l = ends.length;
      ends.push(0);
    }
    ends[l] = r.t1;
    lanes.set(r.id, l);
  }
  return { lanes, count: Math.max(1, ends.length) };
}

// ---------- snapping + seret ----------

/** Titik terdekat dalam `thr` dari `x` (sumbu), atau null. */
export function nearest(x: number, cands: number[], thr: number): number | null {
  let best: number | null = null;
  let bd = thr;
  for (const c of cands) {
    const d = Math.abs(c - x);
    if (d <= bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export type DragMode = 'move' | 'left' | 'right';

/**
 * Hasil seret dalam sumbu timeline: `a0`/`a1` = tepi baru setelah digeser `dx` (detik sumbu) dan snapping ke `cands` (jarak
 * `thr` detik sumbu). Move: tepi mana saja (awal atau akhir) yang lebih dekat ke titik snap yang menarik seluruh blok.
 */
export function dragAxis(mode: DragMode, a0: number, a1: number, dx: number, cands: number[], thr: number): { a0: number; a1: number } {
  if (mode === 'left') {
    const x = a0 + dx;
    return { a0: nearest(x, cands, thr) ?? x, a1 };
  }
  if (mode === 'right') {
    const x = a1 + dx;
    return { a0, a1: nearest(x, cands, thr) ?? x };
  }
  const s0 = nearest(a0 + dx, cands, thr);
  const s1 = nearest(a1 + dx, cands, thr);
  let shift = dx;
  if (s0 !== null && (s1 === null || Math.abs(s0 - (a0 + dx)) <= Math.abs(s1 - (a1 + dx)))) shift = s0 - a0;
  else if (s1 !== null) shift = s1 - a1;
  return { a0: a0 + shift, a1: a1 + shift };
}

/**
 * Tepi hasil seret (sumbu) -> waktu hasil edit untuk `setMotionTimes`. Move mempertahankan durasi (detik hasil edit),
 * resize menjaga tepi yang lain; semuanya dijepit ke [0, total] dan panjang minimal MOTION_MIN.
 */
export function dragToTimes(mode: DragMode, ax: Axis, total: number, orig: { t0: number; t1: number }, edges: { a0: number; a1: number }): { t0: number; t1: number } {
  const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
  if (mode === 'move') {
    const dur = orig.t1 - orig.t0;
    const t0 = clamp(axisToEdited(ax, edges.a0), 0, Math.max(0, total - dur));
    return { t0, t1: t0 + dur };
  }
  if (mode === 'left') {
    const t0 = clamp(axisToEdited(ax, edges.a0), 0, Math.max(0, orig.t1 - MOTION_MIN));
    return { t0, t1: orig.t1 };
  }
  const t1 = clamp(axisToEdited(ax, edges.a1), orig.t0 + MOTION_MIN, total);
  return { t0: orig.t0, t1 };
}
