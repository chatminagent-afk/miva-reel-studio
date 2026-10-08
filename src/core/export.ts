// Export cepat: lapisan overlay (Chrome/HyperFrames, latar transparan) + video & kamera (FFmpeg) -> MP4.
//
//   1. siapkan   data komposisi (compose.ts), cues SFX, komposisi overlay offline (overlay.ts)
//   2. overlay   HyperFrames -> PNG RGBA. 2K dirender 4K lalu diturunkan (keputusan 06/10: --resolution
//                HyperFrames hanya kelipatan bulat 1080, jadi 1440 tidak bisa langsung)
//   3. mix       suara + SFX (mix.ts) -> renders/_mix.wav
//   4. gabung    base.mp4 -> kamera (`perspective`) -> skala target, ditumpuk overlay, encode H.264/HEVC
//
// Proyek dengan whip (blur kamera) tidak bisa lewat jalur ini (canComposeInFfmpeg() = false): otomatis render penuh
// seperti skill (footage + kamera di Chrome, ±6× lebih lambat), lalu frame di-encode dengan audio.
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { canComposeInFfmpeg, perspectiveFilter } from './camera';
import { buildCompositionData, buildCues, layoutCaptions, renderTemplate, type SfxLibrary } from './compose';
import { mix, type MixReport } from './mix';
import { externalUrls, toFullTemplate, toOverlayTemplate, VENDOR_DIR } from './overlay';
import { applySfxOff } from './sfxedit';
import { graphToFile } from './ffmpeg';
import { renderOverlay, type RenderRuntime } from './hyperframes';
import { mergeOverlay, motionOverlayFor, SCENE_BLUR_PX, SCENE_FADE, sceneBlurJs, type SceneRange } from './motionDoc';
import { CancelledError, runProcess } from './proc';
import type { ProjectState } from './doc';
import type { CaptionsJson, EditJson, TimingJson } from './types';

export type Resolution = '1080p' | '2k' | '4k';
export type Codec = 'h264' | 'hevc';

export const SIZES: Record<Resolution, { w: number; h: number }> = {
  '1080p': { w: 1080, h: 1920 },
  '2k': { w: 1440, h: 2560 },
  '4k': { w: 2160, h: 3840 },
};

export interface ExportOptions {
  projDir: string;
  output: string;
  resolution: Resolution;
  fps: 30 | 60;
  codec: Codec;
  runtime: RenderRuntime;
  /** Isi template.tpl skill dan resources/render/fonts.css */
  template: string;
  fontCss: string;
  /** resources/render (fonts/, gsap.min.js) */
  renderAssetsDir: string;
  sfx: SfxLibrary & { dir: string };
  /** Encoder video; default: NVENC kalau benar-benar jalan, kalau tidak libx264/libx265. */
  encoder?: string;
  quality?: Quality;
  workers?: number;
  signal?: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
}

export type ExportStage = 'prepare' | 'overlay' | 'mix' | 'composite' | 'done';

export interface ExportProgress {
  stage: ExportStage;
  /** 0..1 keseluruhan */
  progress: number;
  message: string;
}

export interface ExportResult {
  output: string;
  /** fast = overlay + gabung FFmpeg; full = render penuh di Chrome (proyek dengan whip) */
  mode: 'fast' | 'full';
  duration: number;
  width: number;
  height: number;
  fps: number;
  encoder: string;
  mix: MixReport;
  /** Koneksi jaringan yang diblokir saat render (harus kosong). */
  blocked: string[];
  timings: Record<'overlay' | 'mix' | 'composite', number>;
  /** motion graphic yang ikut dirender (dari .reel/state.json); tidak ada = proyek tanpa motion */
  motion?: { items: number; scenes: number; sfx: number; errors: string[] };
}

// Bobot progress per tahap (overlay paling lama). Dipakai hanya untuk bar progress UI.
const SPAN: Record<Exclude<ExportStage, 'done'>, [number, number]> = {
  prepare: [0, 0.02],
  overlay: [0.02, 0.62],
  mix: [0.62, 0.67],
  composite: [0.67, 1],
};

export type Quality = 'recommended' | 'higher';

/** Argumen encoder video untuk ffmpeg. "higher" = CRF/CQ 2 lebih rendah (file lebih besar). */
export function encoderArgs(encoder: string, quality: Quality = 'recommended'): string[] {
  const q = (n: number) => String(quality === 'higher' ? n - 2 : n);
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', q(19), '-b:v', '0', '-profile:v', 'high'];
    case 'hevc_nvenc':
      return ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', q(21), '-b:v', '0', '-tag:v', 'hvc1'];
    case 'libx265':
      return ['-c:v', 'libx265', '-preset', 'medium', '-crf', q(20), '-tag:v', 'hvc1'];
    case 'libx264':
      return ['-c:v', 'libx264', '-preset', 'slow', '-crf', q(18)]; // recommended = render.sh skill
    default:
      throw new Error(`Encoder tidak dikenal: ${encoder}`);
  }
}

const encoderCache = new Map<string, boolean>();

/** Encoder benar-benar jalan? (ffmpeg bisa mencantumkan NVENC walau tidak ada GPU NVIDIA.) */
export async function encoderWorks(ffmpeg: string, encoder: string): Promise<boolean> {
  const key = `${ffmpeg}\0${encoder}`;
  const hit = encoderCache.get(key);
  if (hit !== undefined) return hit;
  const ok = await runProcess(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30:d=0.2', '-pix_fmt', 'yuv420p',
    ...encoderArgs(encoder), '-f', 'null', '-',
  ]).then(
    () => true,
    () => false,
  );
  encoderCache.set(key, ok);
  return ok;
}

export async function pickEncoder(ffmpeg: string, codec: Codec): Promise<string> {
  const [hw, sw] = codec === 'hevc' ? ['hevc_nvenc', 'libx265'] : ['h264_nvenc', 'libx264'];
  return (await encoderWorks(ffmpeg, hw)) ? hw : sw;
}

export interface CompositeSpec {
  base: string;
  /** pola PNG sequence, mis. renders/_frames/frame_%06d.png */
  frames: string;
  /** ukuran frame overlay (1080×1920 atau 2160×3840) */
  framesSize: { w: number; h: number };
  audio: string;
  output: string;
  size: { w: number; h: number };
  fps: number;
  duration: number;
  camera: Parameters<typeof perspectiveFilter>[0];
  origin: string;
  encoder: string;
  quality?: Quality;
  /** adegan motion (detik hasil edit): footage di-blur di dalam rentang ini, dengan fade 0,3 dtk masuk/keluar */
  scenes?: SceneRange[];
}

const num = (x: number) => String(Math.round(x * 1000) / 1000);

/**
 * Cabang blur footage per adegan, dipasang di antara `[inLabel]` (video + kamera, sudah di ukuran target, gbrp) dan overlay.
 * Per adegan: aliran dibelah dua; cabang blur (gblur hanya aktif di dalam rentang adegan) diberi alpha yang naik/turun
 * (fade alpha) lalu ditumpuk ke aliran tajam hanya di dalam rentang. Tanpa blend per-piksel. Kembalikan filter + label keluaran
 * (tanpa adegan: filter kosong, label = inLabel).
 */
export function sceneBlurFilters(scenes: SceneRange[] | undefined, width: number, inLabel: string): { filters: string; out: string } {
  const list = (scenes ?? [])
    .filter((x) => x.e - x.s > 0.1)
    .sort((a, b) => a.s - b.s);
  if (!list.length) return { filters: '', out: inLabel };
  const sigma = num((SCENE_BLUR_PX * width) / 1080);
  let cur = inLabel;
  const parts: string[] = [];
  list.forEach((sc, i) => {
    const d = Math.min(SCENE_FADE, (sc.e - sc.s) / 2);
    const on = `'between(t,${num(sc.s)},${num(sc.e)})'`;
    const next = `bs${i + 1}`;
    parts.push(
      `[${cur}]split[bk${i}a][bk${i}b]`,
      `[bk${i}b]gblur=sigma=${sigma}:planes=7:enable=${on},format=gbrap,` +
        `fade=t=in:st=${num(sc.s)}:d=${num(d)}:alpha=1,fade=t=out:st=${num(sc.e - d)}:d=${num(d)}:alpha=1[bl${i}]`,
      `[bk${i}a][bl${i}]overlay=format=gbrp:enable=${on}[${next}]`,
    );
    cur = next;
  });
  return { filters: parts.join(';') + ';', out: cur };
}

/**
 * Argumen ffmpeg penggabung. Kamera diterapkan di resolusi asli base (1080×1920, sama dengan koordinat template),
 * lalu diskalakan ke target. Kalau ada adegan motion, footage di-blur per adegan (sceneBlurFilters) sebelum overlay.
 * Blending di RGB (gbrp) seperti Chrome, lalu satu kali ke yuv420p.
 */
export function compositeArgs(s: CompositeSpec): string[] {
  const { w, h } = s.size;
  const scaleBg = w === 1080 && h === 1920 ? '' : `,scale=${w}:${h}:flags=lanczos`;
  const scaleOv = s.framesSize.w === w && s.framesSize.h === h ? '' : `scale=${w}:${h}:flags=lanczos,`;
  const blur = sceneBlurFilters(s.scenes, w, 'bg');
  const graph =
    `[0:v]fps=${s.fps},${perspectiveFilter(s.camera, s.origin, s.fps)}${scaleBg},format=gbrp[bg];` +
    blur.filters +
    `[1:v]${scaleOv}format=gbrap[ov];` +
    `[${blur.out}][ov]overlay=format=gbrp:eof_action=pass,format=yuv420p[v]`;
  return [
    '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1',
    '-i', s.base,
    '-framerate', String(s.fps), '-start_number', '1', '-i', s.frames,
    '-i', s.audio,
    '-filter_complex', graph,
    '-map', '[v]', '-map', '2:a',
    ...encoderArgs(s.encoder, s.quality),
    '-pix_fmt', 'yuv420p', '-r', String(s.fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-t', s.duration.toFixed(3),
    '-movflags', '+faststart',
    s.output,
  ];
}

/** Worker Chrome paralel: semua core kecuali satu (untuk UI), maks 6 (±256 MB RAM per worker). */
export function defaultWorkers(): number {
  return Math.max(1, Math.min(6, availableParallelism() - 1));
}

export interface EncodeFramesSpec {
  frames: string;
  framesSize: { w: number; h: number };
  audio: string;
  output: string;
  size: { w: number; h: number };
  fps: number;
  duration: number;
  encoder: string;
  quality?: Quality;
}

/** Argumen ffmpeg untuk render penuh: frame lengkap dari Chrome + audio mix -> MP4 (seperti render.sh skill). */
export function encodeFramesArgs(s: EncodeFramesSpec): string[] {
  const { w, h } = s.size;
  const scale = s.framesSize.w === w && s.framesSize.h === h ? '' : `scale=${w}:${h}:flags=lanczos,`;
  return [
    '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1',
    '-framerate', String(s.fps), '-start_number', '1', '-i', s.frames,
    '-i', s.audio,
    '-filter_complex', `[0:v]${scale}format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    ...encoderArgs(s.encoder, s.quality),
    '-pix_fmt', 'yuv420p', '-r', String(s.fps),
    '-c:a', 'aac', '-b:a', '192k',
    '-t', s.duration.toFixed(3),
    '-movflags', '+faststart',
    s.output,
  ];
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

async function readOptional(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, 'utf-8') : undefined;
}

/** Export proyek (folder kompatibel skill) ke MP4. */
export async function exportReel(o: ExportOptions): Promise<ExportResult> {
  const P = o.projDir;
  const report = (stage: Exclude<ExportStage, 'done'>, frac: number, message: string) => {
    const [a, b] = SPAN[stage];
    o.onProgress?.({ stage, progress: a + (b - a) * Math.max(0, Math.min(1, frac)), message });
  };
  const check = () => {
    if (o.signal?.aborted) throw new CancelledError();
  };
  const size = SIZES[o.resolution];
  const frames4k = o.resolution !== '1080p';
  const renders = join(P, 'renders');
  const framesDir = join(renders, '_frames');
  const compositionFile = '_render.html';
  const graphFile = join(renders, '_graph.txt'); // graf filter gabung: lewat file, bukan argumen (batas baris perintah Windows)
  const vendor = join(P, VENDOR_DIR);
  const timings = { overlay: 0, mix: 0, composite: 0 };

  report('prepare', 0, 'Preparing composition');
  const T = await readJson<TimingJson>(join(P, 'timing.json'));
  const C = await readJson<CaptionsJson>(join(P, 'captions.json'));
  const E = await readJson<EditJson>(join(P, 'edit.json'));
  const base = join(P, 'assets', 'base.mp4');
  if (!existsSync(base)) throw new Error('assets/base.mp4 belum ada (jalankan Auto Edit dulu)');

  const data = buildCompositionData(T, C, E);
  const fast = canComposeInFfmpeg(data.camera);
  const { caps, keys } = layoutCaptions(T, C);
  // motion graphic app-only: .reel/state.json (proyek skill tidak punya). Waktu dihitung dari kata mentah + potongan terkini.
  const stateText = await readOptional(join(P, '.reel', 'state.json'));
  const state = stateText ? (JSON.parse(stateText) as ProjectState) : null;
  const mo = state?.motion?.length ? motionOverlayFor(E, state, T) : null;
  const cues = applySfxOff(buildCues(T, caps, keys, E, o.sfx, mo?.overlay.sfx).cues, E);
  // overlay motion dulu, overlay.* tulisan tangan skill sesudahnya (keduanya tampil)
  const overlay = mergeOverlay(mo?.overlay ?? {}, {
    css: await readOptional(join(P, 'overlay.css')),
    html: await readOptional(join(P, 'overlay.html')),
    js: await readOptional(join(P, 'overlay.js')),
  });
  // render penuh (whip): footage ada di Chrome, jadi blur adegan dibuat di timeline yang sama (jalur cepat: FFmpeg, lihat compositeArgs)
  const scenes = mo?.overlay.scenes ?? [];
  if (!fast && scenes.length) overlay.js = [overlay.js, sceneBlurJs(scenes)].filter(Boolean).join('\n');
  const html = renderTemplate((fast ? toOverlayTemplate : toFullTemplate)(o.template, o.fontCss), data, overlay);
  const ext = externalUrls(html);
  if (ext.length) throw new Error(`Komposisi memuat URL internet (tidak boleh, app offline): ${ext.join(', ')}`);

  let writingOutput = false;
  try {
    await mkdir(renders, { recursive: true });
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(vendor, { recursive: true });
    await cp(join(o.renderAssetsDir, 'fonts'), join(vendor, 'fonts'), { recursive: true });
    await copyFile(join(o.renderAssetsDir, 'gsap.min.js'), join(vendor, 'gsap.min.js'));
    await writeFile(join(P, compositionFile), html);
    await writeFile(join(P, 'cues.json'), JSON.stringify(cues, null, 1)); // sama dengan build_html.py: skill bisa lanjut
    const encoder = o.encoder ?? (await pickEncoder(o.runtime.ffmpeg, o.codec));
    report('prepare', 1, 'Composition ready');

    check();
    let t0 = Date.now();
    const { blocked } = await renderOverlay(o.runtime, {
      projDir: P,
      composition: compositionFile,
      outDir: framesDir,
      fps: o.fps,
      resolution: frames4k ? '4k' : '1080p',
      workers: o.workers ?? defaultWorkers(),
      signal: o.signal,
      onProgress: (p) => {
        const what = fast ? 'Rendering graphics' : 'Full render (whip)';
        report('overlay', p.pct / 100, p.frames ? `${what}: frame ${p.frame}/${p.frames}` : `${what}: ${p.message}`);
      },
    });
    timings.overlay = Date.now() - t0;

    check();
    t0 = Date.now();
    report('mix', 0, 'Mixing voice and SFX');
    const mixReport = await mix(P, cues, { sfxPath: (id) => join(o.sfx.dir, `${id}.wav`) });
    timings.mix = Date.now() - t0;
    report('mix', 1, 'Mix done');

    check();
    t0 = Date.now();
    const duration = T.duration;
    await mkdir(dirname(o.output), { recursive: true });
    const common = {
      frames: join(framesDir, 'frame_%06d.png'),
      framesSize: frames4k ? SIZES['4k'] : SIZES['1080p'],
      audio: join(renders, '_mix.wav'),
      output: o.output,
      size,
      fps: o.fps,
      duration,
      encoder,
      quality: o.quality,
    };
    const motion = mo ? { items: mo.resolved.length, scenes: scenes.length, sfx: mo.overlay.sfx.length, errors: mo.errors.map((e) => `${e.id}: ${e.message}`) } : undefined;
    writingOutput = true;
    // graf kamera tumbuh ±1,4 KB per langkah: 24 langkah sudah 33 KB > 32.767 di Windows (spawn ENAMETOOLONG)
    const args = await graphToFile(fast ? compositeArgs({ ...common, base, camera: data.camera, origin: data.origin, scenes }) : encodeFramesArgs(common), graphFile);
    await runProcess(o.runtime.ffmpeg, args, {
      signal: o.signal,
      onStdoutLine: (l) => {
        const m = /^out_time_us=(\d+)/.exec(l);
        if (m) report('composite', Number(m[1]) / 1e6 / duration, `${fast ? 'Compositing video' : 'Encoding video'} (${encoder})`);
      },
    });
    timings.composite = Date.now() - t0;
    o.onProgress?.({ stage: 'done', progress: 1, message: 'Done' });
    const mode = fast ? 'fast' : 'full';
    return { output: o.output, mode, duration, width: size.w, height: size.h, fps: o.fps, encoder, mix: mixReport, blocked, timings, motion };
  } catch (e) {
    if (writingOutput) await rm(o.output, { force: true }); // tidak meninggalkan file setengah jadi (UAT 15)
    throw e;
  } finally {
    await rm(framesDir, { recursive: true, force: true });
    await rm(graphFile, { force: true });
    await rm(join(P, compositionFile), { force: true });
    await rm(vendor, { recursive: true, force: true });
  }
}
