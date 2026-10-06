// Lokasi file yang dibundel app. Satu-satunya tempat yang tahu tata letak dev vs app terpasang.
//
//   dev (repo)                                   app terpasang (electron-builder extraResources -> resources/)
//   resources/manifest.json                      manifest.json
//   resources/render/  (npm postinstall)         render/
//   resources/scripts/offline-guard.mjs          scripts/offline-guard.mjs
//   resources/bin/<platform>/ (fetch-resources)  bin/
//   resources/sfx/  (pustaka SFX Steven)         sfx/
//   reference/skill-reel-edit/template/          template/
//   node_modules/hyperframes (asar)              app.asar.unpacked/node_modules/hyperframes (wajib asarUnpack)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { app } from 'electron';
import type { RenderRuntime } from '../core/hyperframes';

const PLATFORM = process.platform === 'win32' ? 'win64' : 'linux64';

interface BinEntry {
  bin?: string;
  ffprobe?: string;
  system?: boolean;
}
interface Manifest {
  [name: string]: { version: string; platforms: Record<string, BinEntry> } | string;
}

export interface AppResources {
  runtime: RenderRuntime;
  renderAssetsDir: string;
  templatePath: string;
  sfxDir: string;
}

function layout() {
  if (app.isPackaged) {
    const r = process.resourcesPath;
    return { res: r, bin: join(r, 'bin'), template: join(r, 'template', 'template.tpl') };
  }
  // `electron out/main/index.js` memberi app path = out/main; naik sampai root repo (package.json)
  let root = app.getAppPath();
  while (!existsSync(join(root, 'package.json')) && dirname(root) !== root) root = dirname(root);
  return {
    res: join(root, 'resources'),
    bin: join(root, 'resources', 'bin', PLATFORM),
    template: join(root, 'reference', 'skill-reel-edit', 'template', 'template.tpl'),
  };
}

/** Path absolut perintah sistem (HyperFrames menolak nama perintah tanpa path). */
function which(cmd: string): string {
  const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf-8' });
  return out.split(/\r?\n/)[0].trim();
}

function binPaths(binRoot: string, manifest: Manifest) {
  const entry = (name: string): BinEntry => {
    const m = manifest[name];
    if (typeof m === 'string' || !m?.platforms[PLATFORM]) throw new Error(`manifest: ${name} tidak ada untuk ${PLATFORM}`);
    return m.platforms[PLATFORM];
  };
  const chrome = entry('chrome-headless-shell');
  const browser = join(binRoot, 'chrome-headless-shell', chrome.bin!);
  const ff = entry('ffmpeg');
  const ffmpeg = process.env.REEL_FFMPEG ?? (ff.system ? which('ffmpeg') : join(binRoot, 'ffmpeg', ff.bin!));
  const ffprobe = process.env.REEL_FFPROBE ?? (ff.system ? which('ffprobe') : join(binRoot, 'ffmpeg', ff.ffprobe!));
  return { browser: process.env.REEL_BROWSER ?? browser, ffmpeg, ffprobe };
}

export function appResources(): AppResources {
  const L = layout();
  const manifest = JSON.parse(readFileSync(join(L.res, 'manifest.json'), 'utf-8')) as Manifest;
  const { browser, ffmpeg, ffprobe } = binPaths(L.bin, manifest);
  const require = createRequire(import.meta.url);
  // CLI dijalankan sebagai proses Node terpisah dan memuat modul native (sharp), jadi harus dari folder unpacked
  const hfDir = dirname(require.resolve('hyperframes/package.json')).replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');
  const runtime: RenderRuntime = {
    node: process.execPath,
    nodeEnv: { ELECTRON_RUN_AS_NODE: '1' },
    hyperframesCli: join(hfDir, 'bin', 'hyperframes.mjs'),
    offlineGuard: join(L.res, 'scripts', 'offline-guard.mjs'),
    browser,
    ffmpeg,
    ffprobe,
    fontCacheDir: join(app.getPath('userData'), 'hyperframes-fonts'),
  };
  for (const [k, p] of Object.entries({ browser, ffmpeg, ffprobe, hyperframesCli: runtime.hyperframesCli }))
    if (!isAbsolute(p) || !existsSync(p)) throw new Error(`Komponen render tidak ditemukan (${k}): ${p}. Jalankan npm run fetch-resources.`);
  return {
    runtime,
    renderAssetsDir: join(L.res, 'render'),
    templatePath: L.template,
    sfxDir: process.env.REEL_SFX_DIR ?? join(L.res, 'sfx'),
  };
}
