// Pustaka komponen motion + perakit. `buildMotionOverlay` menggabungkan semua item motion jadi satu overlay yang disuntik ke
// slot overlay template (/*OVERLAY-CSS*/, <!--OVERLAY-HTML-->, /*OVERLAY-JS*/), SEBELUM overlay.* tulisan tangan skill.
//
// Menambah komponen baru: buat components/<kind>.ts (MotionComponent<kind>), impor di sini, tambahkan ke MOTION_COMPONENTS.
// Kind yang belum ada di registry (bila ada) dilewati tanpa error.
import type { MotionComponent, MotionKind, MotionOverlay, MotionSfx, ResolvedMotion } from './types';
import { LOGO_DEFS, LOGO_GRAD_ID } from './logo';
import { r3, RUNTIME_CSS, RUNTIME_JS, uid } from './runtime';
import { bubbles } from './components/bubbles';
import { chain } from './components/chain';
import { chat } from './components/chat';
import { chips } from './components/chips';
import { counter } from './components/counter';
import { cta } from './components/cta';
import { endcard } from './components/endcard';
import { logo } from './components/logo';
import { phone } from './components/phone';
import { split } from './components/split';
import { statement } from './components/statement';
import { toasts } from './components/toasts';
import { toggle } from './components/toggle';

export { icon, chipIcon, ICON_NAMES } from './icons';
export { logoMark, LOGO_DEFS } from './logo';

export type MotionRegistry = { [K in MotionKind]?: MotionComponent<K> };

/** Semua 13 kind. Komponen baru: buat components/<kind>.ts, impor di atas, tambahkan di sini. */
export const MOTION_COMPONENTS: MotionRegistry = { statement, chat, chain, chips, counter, toasts, phone, split, bubbles, logo, endcard, toggle, cta };

export function getComponent(kind: string): MotionComponent | undefined {
  return (MOTION_COMPONENTS as Record<string, MotionComponent | undefined>)[kind];
}

/** Kind yang sudah punya komponen (urutan registry). */
export function implementedKinds(): MotionKind[] {
  return Object.keys(MOTION_COMPONENTS) as MotionKind[];
}

const SCENE_FADE = 0.3;
/** Dua adegan yang jaraknya kurang dari ini digabung (scrim tidak berkedip di antaranya). */
const SCENE_MERGE_GAP = 0.35;

export interface BuildOptions {
  /** Dipanggil bila build satu item gagal (item dilewati, overlay lain tetap jadi). */
  onError?: (item: ResolvedMotion, err: unknown) => void;
}

/**
 * Gabungkan item motion (waktu sudah dihitung) jadi satu overlay.
 * - CSS: runtime + CSS tiap kind (sekali per kind).
 * - HTML: definisi gradien logo (bila dipakai) + satu scrim + HTML tiap item urut waktu mulai (yang lebih akhir di atas).
 * - JS: SATU IIFE; helper runtime lalu tiap item dalam blok `{ }` sendiri, lalu tween scrim adegan.
 * - SFX: gabungan semua item, urut waktu. `scenes`: rentang adegan hasil gabungan untuk blur footage (FFmpeg/preview).
 * Adegan = item.scene (kalau tidak diisi, sceneDefault komponen).
 */
export function buildMotionOverlay(items: ResolvedMotion[], opts: BuildOptions = {}): MotionOverlay {
  const order = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !!getComponent(it.kind))
    .sort((a, b) => a.it.t0 - b.it.t0 || a.i - b.i);
  if (!order.length) return { html: '', css: '', js: '', sfx: [], scenes: [] };

  const used = new Set<string>();
  const cssByKind = new Map<string, string>();
  const htmlParts: string[] = [];
  const jsBlocks: string[] = [];
  const sfx: MotionSfx[] = [];
  const ranges: { s: number; e: number }[] = [];

  for (const { it } of order) {
    const comp = getComponent(it.kind)!;
    // id unik di dokumen (dua item bisa kebetulan sama id)
    let id = uid(it.id);
    for (let n = 2; used.has(id); n++) id = `${uid(it.id)}-${n}`;
    used.add(id);
    const item = id === it.id ? it : { ...it, id };
    try {
      const b = (comp as MotionComponent<any>).build(item as ResolvedMotion<any>);
      if (!cssByKind.has(it.kind)) cssByKind.set(it.kind, b.css);
      htmlParts.push(b.html);
      jsBlocks.push(`{ // ${it.kind} ${id} (${r3(it.t0)}-${r3(it.t1)} dtk)\n${b.js}\n}`);
      sfx.push(...b.sfx);
      if (item.scene ?? comp.sceneDefault) ranges.push({ s: item.t0, e: item.t1 });
    } catch (err) {
      used.delete(id);
      opts.onError?.(it, err);
    }
  }
  if (!htmlParts.length) return { html: '', css: '', js: '', sfx: [], scenes: [] };

  // adegan: urut, gabung yang bertumpuk/berdekatan
  ranges.sort((a, b) => a.s - b.s);
  const scenes: { s: number; e: number }[] = [];
  for (const r of ranges) {
    const last = scenes[scenes.length - 1];
    if (last && r.s - last.e < SCENE_MERGE_GAP) last.e = Math.max(last.e, r.e);
    else scenes.push({ s: r3(r.s), e: r3(r.e) });
  }
  scenes.forEach((s) => (s.e = r3(s.e)));

  const html = [(htmlParts.join('\n').includes(LOGO_GRAD_ID) ? LOGO_DEFS : ''), scenes.length ? '<div class="mv-scrim" id="mv-scrim"></div>' : '', ...htmlParts]
    .filter(Boolean)
    .join('\n');
  const css = [RUNTIME_CSS, ...cssByKind.values()].join('\n');

  const sceneJs = scenes
    .map((s) => {
      const d = r3(Math.min(SCENE_FADE, (s.e - s.s) / 2));
      return (
        `tl.fromTo("#mv-scrim", { opacity: 0 }, { opacity: 1, duration: ${d}, ease: "power2.out", immediateRender: false }, ${s.s});\n` +
        `tl.to("#mv-scrim", { opacity: 0, duration: ${d}, ease: "power2.in" }, ${r3(s.e - d)});`
      );
    })
    .join('\n');

  const js =
    `(() => {\n${RUNTIME_JS}\n${jsBlocks.join('\n')}\n` + `${sceneJs ? `// ---- adegan (scrim) ----\n${sceneJs}\n` : ''}})();`;
  sfx.sort((a, b) => a.t - b.t);
  return { html, css, js, sfx, scenes };
}
