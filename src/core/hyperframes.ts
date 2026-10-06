// Menjalankan `hyperframes render` (CLI 0.8.84) sepenuhnya offline, dengan progress dan pembatalan.
import { pathToFileURL } from 'node:url';
import { runProcess } from './proc';

/** Lokasi binary dan file yang dibundel app (lihat src/main/resources.ts). */
export interface RenderRuntime {
  /** Node untuk menjalankan CLI. Di app: binary Electron + ELECTRON_RUN_AS_NODE=1. */
  node: string;
  nodeEnv?: NodeJS.ProcessEnv;
  /** node_modules/hyperframes/bin/hyperframes.mjs */
  hyperframesCli: string;
  /** resources/scripts/offline-guard.mjs */
  offlineGuard: string;
  /** chrome-headless-shell yang dibundel */
  browser: string;
  ffmpeg: string;
  ffprobe: string;
  /** Folder cache font HyperFrames (harus bisa ditulis; tidak pernah diisi dari internet). */
  fontCacheDir: string;
}

export interface OverlayRenderOptions {
  projDir: string;
  /** File komposisi relatif ke projDir. */
  composition: string;
  /** Folder output PNG sequence (RGBA). */
  outDir: string;
  fps: number;
  /** '4k' = 2160×3840 (Chrome DPR 2); default 1080×1920. */
  resolution?: '1080p' | '4k';
  workers?: number;
  signal?: AbortSignal;
  onProgress?: (p: HfProgress) => void;
}

export interface HfProgress {
  /** 0..100 dari bar progress HyperFrames */
  pct: number;
  message: string;
  frame?: number;
  frames?: number;
}

export interface OverlayRenderResult {
  /** Koneksi jaringan yang dicoba dan diblokir penjaga offline (harus kosong). */
  blocked: string[];
}

export function hyperframesEnv(rt: RenderRuntime, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    ...rt.nodeEnv,
    HYPERFRAMES_NO_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1',
    HYPERFRAMES_NO_AUTO_INSTALL: '1',
    HYPERFRAMES_BROWSER_PATH: rt.browser,
    HYPERFRAMES_FFMPEG_PATH: rt.ffmpeg,
    HYPERFRAMES_FFPROBE_PATH: rt.ffprobe,
    HYPERFRAMES_FONT_CACHE_DIR: rt.fontCacheDir,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
}

// "  ██████░░░  25%  Capturing frame 596/626 (3 workers)"
const PROGRESS_RE = /(\d{1,3})%\s+(.+?)\s*$/;
const FRAME_RE = /frame (\d+)\/(\d+)/i;
const FAILED_RE = /^\s*\d{1,3}%\s+Failed:\s*(.+)$/;

export function parseHfLine(line: string): HfProgress | null {
  const m = PROGRESS_RE.exec(line);
  if (!m || !/[█░]/.test(line)) return null;
  const p: HfProgress = { pct: Math.min(100, Number(m[1])), message: m[2] };
  const f = FRAME_RE.exec(m[2]);
  if (f) {
    p.frame = Number(f[1]);
    p.frames = Number(f[2]);
  }
  return p;
}

export function hfRenderArgs(rt: RenderRuntime, o: OverlayRenderOptions): string[] {
  const args = [
    '--import',
    pathToFileURL(rt.offlineGuard).href,
    rt.hyperframesCli,
    'render',
    '--composition',
    o.composition,
    '--format',
    'png-sequence',
    '--output',
    o.outDir,
    '--fps',
    String(o.fps),
    '--workers',
    String(o.workers ?? 'auto'),
  ];
  if (o.resolution === '4k') args.push('--resolution', 'portrait-4k');
  return args;
}

/** Render komposisi ke PNG sequence RGBA (frame_000001.png, ...). */
export async function renderOverlay(rt: RenderRuntime, o: OverlayRenderOptions): Promise<OverlayRenderResult> {
  const blocked: string[] = [];
  let failure = '';
  await runProcess(rt.node, hfRenderArgs(rt, o), {
    cwd: o.projDir,
    env: hyperframesEnv(rt),
    signal: o.signal,
    onStdoutLine: (l) => {
      const f = FAILED_RE.exec(l);
      if (f) failure = f[1];
      const p = parseHfLine(l);
      if (p) o.onProgress?.(p);
    },
    onStderrLine: (l) => {
      const b = /^\[offline-guard\] blocked (.+)$/.exec(l);
      if (b) blocked.push(b[1]);
    },
  }).catch((e: Error) => {
    if (failure) e.message = `HyperFrames gagal: ${failure}`;
    throw e;
  });
  return { blocked };
}
