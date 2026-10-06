// Kamera untuk export cepat: gerak GSAP (#cam = zoom/pan dasar, #aroll = punch-in kata kunci) dihitung ulang
// di sini lalu diterjemahkan ke filter ffmpeg `perspective` (eval per frame, interpolasi subpixel), supaya
// video bisa digabung di FFmpeg dan Chrome hanya merender lapisan overlay.
//
// Transform CSS di template: translate(x, y) scale(s) dengan transform-origin = D.origin (ox, oy) pada kanvas 1080×1920.
// Titik sumber (u, v) tampil di layar pada  X = ox + (u - ox)·s + x,  Y = oy + (v - oy)·s + y.
// Jadi jendela sumber yang mengisi layar: kiri = ox - (ox + x)/s, atas = oy - (oy + y)/s, lebar W/s, tinggi H/s.
// #aroll ada di dalam #cam dengan origin sama, jadi skala efektif = s_cam · s_aroll (translasi hanya dari #cam).
import type { CamState, CamStep } from './types';

export const W = 1080;
export const H = 1920;

const EASE: Record<string, (p: number) => number> = {
  none: (p) => p,
  'sine.inOut': (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  'power2.out': (p) => 1 - (1 - p) ** 3, // GSAP power2 = kubik
  'power3.out': (p) => 1 - (1 - p) ** 4, // GSAP power3 = kuartik
  'power4.out': (p) => 1 - (1 - p) ** 5,
};

// Ekspresi ffmpeg setara (variabel P = progres 0..1)
const EASE_EXPR: Record<string, (P: string) => string> = {
  none: (P) => P,
  'sine.inOut': (P) => `(-(cos(PI*${P})-1)/2)`,
  'power2.out': (P) => `(1-pow(1-${P},3))`,
  'power3.out': (P) => `(1-pow(1-${P},4))`,
  'power4.out': (P) => `(1-pow(1-${P},5))`,
};

export function parseOrigin(origin: string): { ox: number; oy: number } {
  const [a, b] = origin.trim().split(/\s+/);
  const pct = (v: string, size: number) => (v.endsWith('%') ? (parseFloat(v) / 100) * size : parseFloat(v));
  return { ox: pct(a, W), oy: pct(b, H) };
}

/** Kamera hanya mendukung ease di tabel; whip memakai filter blur yang tidak bisa diterjemahkan ke FFmpeg. */
export function canComposeInFfmpeg(camera: CamStep[]): boolean {
  return camera.every((m) => EASE[m.ease] && !m.from.filter && !m.to.filter);
}

type Track = 'cam' | 'aroll';
const trackOf = (m: CamStep): Track => (m.el === '#aroll' ? 'aroll' : 'cam');
const prop = (st: Partial<CamState>, k: 'scale' | 'x' | 'y', dflt: number) => (st[k] ?? dflt);

/** Nilai satu properti pada waktu t, mengikuti semantik timeline GSAP (fromTo berurutan; tahan nilai `to` terakhir). */
function valueAt(steps: CamStep[], k: 'scale' | 'x' | 'y', t: number, dflt: number): number {
  let v = dflt;
  for (const m of steps) {
    if (t < m.t) break;
    const from = prop(m.from, k, v);
    const to = prop(m.to, k, from);
    const p = m.dur > 0 ? Math.min(1, (t - m.t) / m.dur) : 1;
    v = from + (to - from) * EASE[m.ease](p);
  }
  return v;
}

export interface CamValue {
  s: number;
  x: number;
  y: number;
}

export function cameraAt(camera: CamStep[], t: number): CamValue {
  const cam = camera.filter((m) => trackOf(m) === 'cam').sort((a, b) => a.t - b.t);
  const ar = camera.filter((m) => trackOf(m) === 'aroll').sort((a, b) => a.t - b.t);
  return {
    s: valueAt(cam, 'scale', t, 1) * valueAt(ar, 'scale', t, 1),
    x: valueAt(cam, 'x', t, 0),
    y: valueAt(cam, 'y', t, 0),
  };
}

/** Ekspresi ffmpeg piecewise untuk satu properti satu lapisan (T = waktu detik). */
function exprFor(steps: CamStep[], k: 'scale' | 'x' | 'y', dflt: number): string {
  // bangun dari belakang: if(gte(T, t_i), segmen_i, sebelumnya)
  let v = dflt;
  const parts: { t: number; e: string }[] = [];
  for (const m of steps) {
    const from = prop(m.from, k, v);
    const to = prop(m.to, k, from);
    const P = m.dur > 0 ? `min(1,(T-${m.t})/${m.dur})` : '1';
    parts.push({ t: m.t, e: from === to ? `${to}` : `(${from}+(${to - from})*${EASE_EXPR[m.ease](P)})` });
    v = to;
  }
  let expr = `${dflt}`;
  for (const p of parts) expr = `if(gte(T,${p.t}),${p.e},${expr})`;
  return expr;
}

/**
 * Filter `perspective` (sense=source, eval=frame) yang menerapkan kamera ke video 1080×1920.
 * `in` di filter perspective dimulai dari 1 (frame pertama = 1), jadi T = (in - 1)/fps.
 * Terbukti 06/10: dengan in/fps, frame di sebelah potongan memakai keadaan kamera frame berikutnya (PSNR 14 dB).
 */
export function perspectiveFilter(camera: CamStep[], origin: string, fps = 30): string {
  const { ox, oy } = parseOrigin(origin);
  const cam = camera.filter((m) => trackOf(m) === 'cam').sort((a, b) => a.t - b.t);
  const ar = camera.filter((m) => trackOf(m) === 'aroll').sort((a, b) => a.t - b.t);
  const T = `((in-1)/${fps})`;
  const sub = (e: string) => e.replaceAll('T', T);
  const S = `((${sub(exprFor(cam, 'scale', 1))})*(${sub(exprFor(ar, 'scale', 1))}))`; // kurung luar wajib: dipakai sebagai pembagi
  const X = sub(exprFor(cam, 'x', 0));
  const Y = sub(exprFor(cam, 'y', 0));
  const left = `(${ox}-(${ox}+${X})/${S})`;
  const top = `(${oy}-(${oy}+${Y})/${S})`;
  const right = `(${left}+${W}/${S})`;
  const bottom = `(${top}+${H}/${S})`;
  // koma di dalam ekspresi harus di-escape di filtergraph
  const q = (e: string) => `'${e}'`;
  return (
    `perspective=x0=${q(left)}:y0=${q(top)}:x1=${q(right)}:y1=${q(top)}:x2=${q(left)}:y2=${q(bottom)}:` +
    `x3=${q(right)}:y3=${q(bottom)}:sense=source:eval=frame:interpolation=cubic`
  );
}

/** Jendela sumber pada waktu t (untuk tes & preview). */
export function sourceWindow(camera: CamStep[], origin: string, t: number) {
  const { ox, oy } = parseOrigin(origin);
  const { s, x, y } = cameraAt(camera, t);
  return { left: ox - (ox + x) / s, top: oy - (oy + y) / s, width: W / s, height: H / s };
}
