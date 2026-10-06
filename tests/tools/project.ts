// Proyek uji untuk export: data nyata acuan tes2 (timing, captions, edit, overlay) + footage & SFX sintetis
// (tes2.mp4 dan pustaka SFX asli tidak ada di repo).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ffmpeg } from '../../src/core/ffmpeg';
import type { RenderRuntime } from '../../src/core/hyperframes';
import type { CaptionsJson, EditJson, SfxCatalog, SfxFeature, TimingJson } from '../../src/core/types';

export const ROOT = join(__dirname, '..', '..');
export const ACUAN = join(ROOT, 'tests', 'fixtures', 'acuan-tes2');
const require = createRequire(join(ROOT, 'package.json'));

export const BROWSER = join(ROOT, 'resources', 'bin', 'linux64', 'chrome-headless-shell', 'chrome-headless-shell-linux64', 'chrome-headless-shell');
export const hasBrowser = process.platform === 'linux' && existsSync(BROWSER);

export function testRuntime(fontCacheDir: string): RenderRuntime {
  return {
    node: process.execPath,
    hyperframesCli: join(require.resolve('hyperframes/package.json'), '..', 'bin', 'hyperframes.mjs'),
    offlineGuard: join(ROOT, 'resources', 'scripts', 'offline-guard.mjs'),
    browser: BROWSER,
    // HyperFrames menolak nama perintah; harus path absolut
    ffmpeg: execFileSync('which', ['ffmpeg'], { encoding: 'utf-8' }).trim(),
    ffprobe: execFileSync('which', ['ffprobe'], { encoding: 'utf-8' }).trim(),
    fontCacheDir,
  };
}

export function renderAssets() {
  const dir = join(ROOT, 'resources', 'render');
  return {
    renderAssetsDir: dir,
    fontCss: readFileSync(join(dir, 'fonts.css'), 'utf-8'),
    template: readFileSync(join(ROOT, 'reference', 'skill-reel-edit', 'template', 'template.tpl'), 'utf-8'),
  };
}

/**
 * Potong data acuan jadi `seconds` detik pertama (untuk tes resolusi tinggi yang lambat): kata dan subtitle
 * diambil per kelompok utuh, potongan/SFX manual di luar durasi dibuang. Grafik overlay di luar durasi tidak tampil.
 */
function shorten(dir: string, seconds: number): number {
  const rd = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf-8'));
  const T = rd('timing.json') as TimingJson;
  const C = rd('captions.json') as CaptionsJson;
  const E = rd('edit.json') as EditJson;
  const chunks = [];
  for (const c of C.chunks) {
    if (T.words[c.w[c.w.length - 1]].e > seconds - 0.5) break;
    chunks.push(c);
  }
  const n = chunks.length ? chunks[chunks.length - 1].w.at(-1)! + 1 : 0;
  T.words = T.words.slice(0, n);
  T.cuts = T.cuts.filter((t) => t < seconds);
  T.duration = seconds;
  E.sfx = (E.sfx ?? []).filter((s) => s.t < seconds - 0.5);
  writeFileSync(join(dir, 'timing.json'), JSON.stringify(T));
  writeFileSync(join(dir, 'captions.json'), JSON.stringify({ chunks }));
  writeFileSync(join(dir, 'edit.json'), JSON.stringify(E));
  return seconds;
}

/** Footage sintetis 1080×1920 30 fps (pola bergerak) + suara, panjang sama dengan timing. */
export async function makeAcuanProject(dir: string, opts: { seconds?: number } = {}): Promise<number> {
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const f of ['edit.json', 'timing.json', 'captions.json', 'overlay.css', 'overlay.html', 'overlay.js'])
    copyFileSync(join(ACUAN, f), join(dir, f));
  const dur = opts.seconds ? shorten(dir, opts.seconds) : JSON.parse(readFileSync(join(ACUAN, 'timing.json'), 'utf-8')).duration;
  await ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=s=1080x1920:r=30:d=${dur}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-g', '15', '-pix_fmt', 'yuv420p', join(dir, 'assets', 'base.mp4'),
  ]);
  await ffmpeg([
    '-f', 'lavfi', '-i', `sine=f=180:sample_rate=48000:d=${dur}`,
    '-af', 'volume=0.5*(0.6+0.4*sin(2*PI*3*t)):eval=frame', '-ac', '2', '-c:a', 'pcm_s16le', join(dir, 'assets', 'voice.wav'),
  ]);
  return dur;
}

/** Pustaka SFX sintetis untuk id di catalog acuan (syn-*). */
export async function makeSfxLib(dir: string) {
  mkdirSync(dir, { recursive: true });
  const features = JSON.parse(readFileSync(join(ACUAN, 'sfxlib', '_fitur.json'), 'utf-8')) as Record<string, SfxFeature>;
  const catalog = JSON.parse(readFileSync(join(ACUAN, 'sfxlib', 'catalog.json'), 'utf-8')) as SfxCatalog;
  // tata letak sama dengan pustaka asli: <id>.wav + catalog.json + _fitur.json (dibaca app lewat REEL_SFX_DIR)
  for (const f of ['catalog.json', '_fitur.json']) copyFileSync(join(ACUAN, 'sfxlib', f), join(dir, f));
  let f = 400;
  for (const [id, feat] of Object.entries(features)) {
    f += 90;
    await ffmpeg([
      '-f', 'lavfi', '-i', `sine=f=${f}:sample_rate=48000:d=${feat.dur}`,
      '-af', `afade=t=out:st=${Math.max(0, feat.dur - 0.05)}:d=0.05`, '-ac', '2', '-c:a', 'pcm_s16le', join(dir, `${id}.wav`),
    ]);
  }
  return { dir, features, catalog };
}
