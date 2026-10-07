// Unduh komponen yang dibundel app sesuai resources/manifest.json, semuanya diverifikasi sha256.
//   node scripts/fetch-resources.mjs [--platform win64|linux64] [--only <nama>] [--skip <nama>[,<nama>]] [--pin]
// Jenis entri:
//   zip (default)  arsip zip/nupkg -> resources/bin/<platform>/<nama>/
//   pip            site-packages dari lock (--require-hashes) -> resources/bin/<platform>/<nama>/
//   hf             file model HuggingFace pada revisi terkunci -> resources/models/<nama>/
// Hasil gitignored; unduhan yang sudah ada dan cocok dilewati.
// --pin: entri yang hash/revisinya masih null dihitung lalu ditulis ke manifest (sekali, saat menaikkan versi).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
const hostPlatform = process.platform === 'win32' ? 'win64' : process.platform === 'linux' ? 'linux64' : null;
const platform = arg('--platform') ?? hostPlatform;
if (!platform) throw new Error(`Platform ${process.platform} belum didukung`);
const only = arg('--only');
const skip = new Set((arg('--skip') ?? '').split(',').filter(Boolean));
const pin = process.argv.includes('--pin');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));

async function sha256(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Unduh gagal ${res.status}: ${url}`);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}: ${url}`);
  return res.json();
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

const readStamp = (dir) => (existsSync(join(dir, '.installed.json')) ? JSON.parse(readFileSync(join(dir, '.installed.json'), 'utf-8')) : null);
const writeStamp = (dir, s) => writeFileSync(join(dir, '.installed.json'), JSON.stringify(s, null, 2));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let changed = false;

async function fetchZip(name, entry, p) {
  const dir = join(ROOT, 'resources', 'bin', platform, name);
  const want = { url: p.url, sha256: p.sha256, version: entry.version };
  if (same(readStamp(dir), want) && existsSync(join(dir, p.bin))) return console.log(`${name} ${entry.version} (${platform}): sudah ada`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, '_download.zip');
  console.log(`${name} ${entry.version} (${platform}): unduh ${p.url}`);
  await download(p.url, zip);
  const hash = await sha256(zip);
  if (p.sha256 === null) {
    if (!pin) throw new Error(`${name}: sha256 belum dipin di manifest (hash unduhan ${hash}); jalankan dengan --pin`);
    p.sha256 = want.sha256 = hash;
    changed = true;
    console.log(`${name}: sha256 dipin ${hash}`);
  } else if (hash !== p.sha256) {
    throw new Error(`${name}: sha256 tidak cocok (${hash} != ${p.sha256})`);
  }
  await extract(zip, { dir });
  rmSync(zip);
  if (!existsSync(join(dir, p.bin))) throw new Error(`${name}: ${p.bin} tidak ada di arsip`);
  if (name === 'ffmpeg' && platform === hostPlatform) verifyFfmpeg(join(dir, p.bin));
  writeStamp(dir, want);
  console.log(`${name}: siap di resources/bin/${platform}/${name}/${p.bin}`);
}

async function fetchPip(name, entry, p) {
  const dir = join(ROOT, 'resources', 'bin', platform, name);
  const lock = join(ROOT, p.lock);
  const want = { lock: p.lock, lockSha256: await sha256(lock) };
  if (same(readStamp(dir), want)) return console.log(`${name} (${platform}): sudah ada`);
  rmSync(dir, { recursive: true, force: true });
  // pip pembangun = Python mesin build (CI: actions/setup-python 3.13); platform target lewat --platform
  const py = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const target = p.platformArgs ?? [];
  console.log(`${name} (${platform}): pip install dari ${p.lock}`);
  const r = spawnSync(
    py,
    ['-m', 'pip', 'install', '--quiet', '--no-deps', '--require-hashes', '--only-binary=:all:', '--no-compile', '--target', dir, ...target, '-r', lock],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`${name}: pip install gagal (${r.status})`);
  writeStamp(dir, want);
  console.log(`${name}: siap di resources/bin/${platform}/${name}`);
}

async function fetchHf(name, entry) {
  const dir = join(ROOT, 'resources', 'models', name);
  if (!entry.revision || !entry.files) {
    if (!pin) throw new Error(`${name}: revisi/hash model belum dipin di manifest; jalankan dengan --pin (butuh akses huggingface.co)`);
    const info = await getJson(`https://huggingface.co/api/models/${entry.repo}`);
    const tree = await getJson(`https://huggingface.co/api/models/${entry.repo}/tree/${info.sha}`);
    entry.revision = info.sha;
    entry.files = Object.fromEntries(
      tree.filter((f) => f.type === 'file' && !/^(\.gitattributes|README\.md)$/.test(f.path)).map((f) => [f.path, f.lfs?.oid ?? null]),
    );
    changed = true;
    console.log(`${name}: revisi dipin ${entry.revision} (${Object.keys(entry.files).length} file)`);
  }
  const want = { repo: entry.repo, revision: entry.revision, files: entry.files };
  if (same(readStamp(dir), want)) return console.log(`${name} (${entry.repo}@${entry.revision.slice(0, 8)}): sudah ada`);
  mkdirSync(dir, { recursive: true });
  for (const [file, expect] of Object.entries(entry.files)) {
    const dest = join(dir, file);
    const part = `${dest}.part`;
    console.log(`${name}: unduh ${file}`);
    await download(`https://huggingface.co/${entry.repo}/resolve/${entry.revision}/${file}`, part);
    const hash = await sha256(part);
    if (expect === null) {
      if (!pin) throw new Error(`${name}: sha256 ${file} belum dipin; jalankan dengan --pin`);
      entry.files[file] = want.files[file] = hash;
      changed = true;
    } else if (hash !== expect) {
      throw new Error(`${name}: sha256 ${file} tidak cocok (${hash} != ${expect})`);
    }
    renameSync(part, dest);
  }
  writeStamp(dir, want);
  console.log(`${name}: siap di resources/models/${name}`);
}

try {
  for (const [name, entry] of Object.entries(manifest)) {
    if (name.startsWith('$') || (only && only !== name) || skip.has(name)) continue;
    const p = entry.platforms[platform] ?? entry.platforms.all;
    if (!p) throw new Error(`${name}: tidak ada entri untuk ${platform}`);
    if (p.system) {
      console.log(`${name} (${platform}): pakai versi sistem`);
      continue;
    }
    if (entry.type === 'pip') await fetchPip(name, entry, p);
    else if (entry.type === 'hf') await fetchHf(name, entry);
    else await fetchZip(name, entry, p);
  }
} finally {
  if (changed) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}
