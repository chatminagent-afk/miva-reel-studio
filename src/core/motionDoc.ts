// Jembatan dokumen proyek <-> motion graphic (murni, tanpa Node: dipakai proses utama dan UI).
//   motionOverlayFor  state.motion + edit/timing -> item bertanggal (detik hasil edit) + overlay HTML/CSS/JS + adegan + SFX
//   mergeOverlay      overlay motion dulu, overlay.* tulisan tangan skill sesudahnya (keduanya tampil)
//   anchorAt          detik hasil edit -> jangkar kata mentah (kebalikan resolveMotion)
import type { ProjectState } from './doc';
import { buildMotionOverlay } from './motion';
import { buildWordTimes, resolveMotion } from './motion/resolve';
import type { MotionAnchor, MotionOverlay, ResolvedMotion } from './motion/types';
import { SPEED_DEFAULT } from './timing';
import type { EditJson, RawWord, Seg, TimingJson } from './types';

export interface MotionOverlayResult {
  /** item dengan waktu bertanggal; selalu satu per item state.motion (urutan sama) */
  resolved: ResolvedMotion[];
  overlay: MotionOverlay;
  /** item yang gagal dirakit (dilewati, overlay lain tetap jadi) */
  errors: { id: string; message: string }[];
}

const EMPTY: MotionOverlay = { html: '', css: '', js: '', sfx: [], scenes: [] };

/**
 * Overlay motion proyek. `timing.duration` sudah termasuk `edit.tail`, jadi item boleh jatuh di freeze-frame akhir (end card).
 * Tanpa motion: overlay kosong (mergeOverlay lalu mengembalikan overlay.* skill apa adanya, hasil render tidak berubah).
 */
export function motionOverlayFor(
  edit: Pick<EditJson, 'segs' | 'speed'>,
  state: Pick<ProjectState, 'words' | 'motion'>,
  timing: Pick<TimingJson, 'duration'>,
): MotionOverlayResult {
  const items = state.motion ?? [];
  if (!items.length) return { resolved: [], overlay: EMPTY, errors: [] };
  const speed = Number(edit.speed ?? SPEED_DEFAULT);
  const resolved = resolveMotion(items, state.words, edit.segs, speed, timing.duration);
  const errors: { id: string; message: string }[] = [];
  const overlay = buildMotionOverlay(resolved, {
    onError: (it, err) => errors.push({ id: it.id, message: err instanceof Error ? err.message : String(err) }),
  });
  return { resolved, overlay, errors };
}

interface Layer {
  css?: string;
  html?: string;
  js?: string;
}

const cat = (a: string | undefined, b: string | undefined): string | undefined => {
  if (!a?.trim()) return b;
  if (!b?.trim()) return a;
  return `${a}\n${b}`;
};

/**
 * Gabungkan overlay motion app dengan overlay.* tulisan tangan (proyek skill). Motion DULU: CSS tulisan tangan bisa menimpa,
 * HTML tulisan tangan tampil di atas, JS tulisan tangan jalan sesudah IIFE motion (timeline `tl` sama). Sisi yang kosong
 * dikembalikan apa adanya, jadi tanpa motion hasilnya identik dengan overlay.* asli.
 */
export function mergeOverlay(motion: Layer, hand: Layer = {}): Layer {
  return { css: cat(motion.css, hand.css), html: cat(motion.html, hand.html), js: cat(motion.js, hand.js) };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------- blur footage di adegan ----------

export interface SceneRange {
  s: number;
  e: number;
}

/** Blur footage di adegan = CSS `blur(14px)` pada kanvas selebar 1080 (sigma gaussian 14 px), rampa 0,3 dtk masuk dan keluar. */
export const SCENE_BLUR_PX = 14;
export const SCENE_FADE = 0.3;

/** Seberapa blur footage pada detik `t` (0..1): rampa linear 0,3 dtk di tepi adegan (maks 1/2 adegan kalau adegan pendek). */
export function sceneBlurAt(scenes: SceneRange[], t: number): number {
  let a = 0;
  for (const { s, e } of scenes) {
    if (t < s || t > e) continue;
    const d = Math.min(SCENE_FADE, (e - s) / 2);
    a = Math.max(a, d <= 0 ? 1 : Math.min(1, (t - s) / d, (e - t) / d));
  }
  return a;
}

/**
 * JS blur footage per adegan untuk jalur render penuh (whip): footage `#aroll` ada di Chrome, jadi blur dibuat di timeline `tl`
 * template (jalur cepat memakai FFmpeg, lihat compositeArgs). Rampa sama dengan sceneBlurAt.
 */
export function sceneBlurJs(scenes: SceneRange[]): string {
  const lines = scenes
    .filter((x) => x.e - x.s > 0.1)
    .map(({ s, e }) => {
      const d = r3(Math.min(SCENE_FADE, (e - s) / 2));
      return [
        `tl.fromTo("#aroll", { filter: "blur(0px)" }, { filter: "blur(${SCENE_BLUR_PX}px)", duration: ${d}, ease: "none", immediateRender: false }, ${r3(s)});`,
        `tl.to("#aroll", { filter: "blur(0px)", duration: ${d}, ease: "none" }, ${r3(e - d)});`,
      ].join('\n');
    });
  return lines.length ? ['// ---- blur footage di adegan (render penuh) ----', ...lines].join('\n') : '';
}

/**
 * Jangkar untuk detik hasil edit `t`: kata terpakai terdekat (awal kata) + selisih waktu `off`. Hasilnya dijamin kembali ke `t`
 * (dalam 1 ms) lewat resolveMotion/anchorTime selama potongan yang sama. Di freeze-frame akhir (t > kata terakhir) jangkarnya
 * kata terakhir dengan `off` besar; tanpa kata terpakai sama sekali: kata 0 dengan `off` = t.
 */
export function anchorAt(t: number, words: RawWord[], segs: Seg[], speed: number): MotionAnchor {
  const T = Math.max(0, t);
  const wt = buildWordTimes(words, segs, speed);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < wt.n; i++) {
    const s = wt.s[i];
    if (s === null) continue;
    const d = Math.abs(s - T);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return { word: 0, edge: 's', off: r3(T) };
  return { word: best, edge: 's', off: r3(T - (wt.s[best] as number)) };
}
