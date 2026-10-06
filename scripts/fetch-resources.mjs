// Unduh binary yang dibundel app (Chrome headless shell, FFmpeg) sesuai resources/manifest.json.
//   node scripts/fetch-resources.mjs [--platform win64|linux64] [--only chrome-headless-shell|ffmpeg] [--pin]
// Hasil: resources/bin/<platform>/<nama>/ (gitignored). File diverifikasi sha256; unduhan yang sudah ada dilewati.
// --pin: untuk entri yang sha256-nya masih null, hitung hash lalu tulis ke manifest (sekali, saat menaikkan versi).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import extract from 'extract-zip';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'resources', 'manifest.json');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const platform = arg('--platform') ?? (process.platform === 'win32' ? 'win64' : process.platform === 'linux' ? 'linux64' : null);
if (!platform) throw new Error(`Platform ${process.platform} belum didukung`);
const only = arg('--only');
const pin = process.argv.includes('--pin');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));

async function sha256(path) {
  const h = createHash('sha256');
  for await (const chunk of (await import('node:fs')).createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Unduh gagal ${res.status}: ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

// Fitur yang dipakai app; build FFmpeg yang tidak punya salah satunya ditolak.
const FFMPEG_NEEDS = {
  filters: ['perspective', 'loudnorm', 'afftdn', 'acompressor', 'overlay', 'psnr', 'ebur128'],
  encoders: ['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc', 'aac'],
};

function verifyFfmpeg(bin) {
  const run = (a) => spawnSync(bin, ['-hide_banner', a], { encoding: 'utf-8' }).stdout;
  const filters = run('-filters');
  const encoders = run('-encoders');
  const missing = [
    ...FFMPEG_NEEDS.filters.filter((f) => !new RegExp(`\\s${f}\\s`).test(filters)),
    ...FFMPEG_NEEDS.encoders.filter((e) => !new RegExp(`\\s${e}\\s`).test(encoders)),
  ];
  if (missing.length) throw new Error(`FFmpeg ${bin} tidak punya: ${missing.join(', ')}`);
}

let changed = false;
for (const [name, entry] of Object.entries(manifest)) {
  if (name.startsWith('$') || (only && only !== name)) continue;
  const p = entry.platforms[platform];
  if (!p) throw new Error(`${name}: tidak ada entri untuk ${platform}`);
  if (p.system) {
    console.log(`${name} (${platform}): pakai versi sistem`);
    continue;
  }
  const dir = join(ROOT, 'resources', 'bin', platform, name);
  const stamp = join(dir, '.installed.json');
  if (existsSync(stamp)) {
    const s = JSON.parse(readFileSync(stamp, 'utf-8'));
    if (s.url === p.url && s.sha256 === p.sha256 && existsSync(join(dir, p.bin))) {
      console.log(`${name} ${entry.version} (${platform}): sudah ada`);
      continue;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, '_download.zip');
  console.log(`${name} ${entry.version} (${platform}): unduh ${p.url}`);
  await download(p.url, zip);
  const hash = await sha256(zip);
  if (p.sha256 === null) {
    if (!pin) throw new Error(`${name}: sha256 belum dipin di manifest (hash unduhan ${hash}); jalankan dengan --pin`);
    p.sha256 = hash;
    changed = true;
    console.log(`${name}: sha256 dipin ${hash}`);
  } else if (hash !== p.sha256) {
    throw new Error(`${name}: sha256 tidak cocok (${hash} != ${p.sha256})`);
  }
  await extract(zip, { dir });
  rmSync(zip);
  if (!existsSync(join(dir, p.bin))) throw new Error(`${name}: ${p.bin} tidak ada di arsip`);
  const hostPlatform = process.platform === 'win32' ? 'win64' : 'linux64';
  if (name === 'ffmpeg' && platform === hostPlatform) verifyFfmpeg(join(dir, p.bin));
  writeFileSync(stamp, JSON.stringify({ url: p.url, sha256: p.sha256, version: entry.version }, null, 2));
  console.log(`${name}: siap di resources/bin/${platform}/${name}/${p.bin}`);
}
if (changed) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
