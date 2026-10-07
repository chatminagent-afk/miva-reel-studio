// Folder proyek app = folder proyek skill /reel-edit (edit.json, words-raw.json, timing.json, captions.json, overlay.*,
// assets/, renders/) + `.reel/state.json` untuk data khusus app (kata dengan e_ref, kata kunci per kata mentah, flag Auto Edit).
//
// timing.json dan captions.json selalu DITURUNKAN dari edit.json + state (bukan diedit langsung): captions.json skill
// mengacu ke indeks timing.json, yang berubah setiap potongan berubah. Kata kunci disimpan per kata mentah supaya tetap
// menempel di kata yang sama.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { derive, STATE_VERSION, type ProjectDoc, type ProjectState } from './doc';
import type { EditJson, TimingJson, CaptionsJson } from './types';

export * from './doc';

export const stateFile = (dir: string) => join(dir, '.reel', 'state.json');

/** Nama folder proyek: YYYY-MM-DD-<nama file footage>. */
export function projectName(src: string, date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  const slug = basename(src, extname(src))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${d}-${slug || 'reel'}`;
}

/** Folder unik di bawah root (tambah -2, -3, ... kalau sudah ada). */
export function uniqueDir(root: string, name: string): string {
  let dir = join(root, name);
  for (let n = 2; existsSync(dir); n++) dir = join(root, `${name}-${n}`);
  return dir;
}

async function writeJson(path: string, data: unknown, indent = 1): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, indent));
  await rename(tmp, path); // tulis atomik: proyek tidak rusak kalau app mati di tengah simpan
}

const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf-8')) as T;
const readOpt = async (path: string) => (existsSync(path) ? readFile(path, 'utf-8') : undefined);

/** Simpan dokumen: edit.json, timing.json, captions.json (format skill) + .reel/state.json. */
export async function saveProject(doc: ProjectDoc): Promise<{ timing: TimingJson; captions: CaptionsJson }> {
  await mkdir(join(doc.dir, '.reel'), { recursive: true });
  doc.state.updated = new Date().toISOString();
  const { timing, captions } = derive(doc);
  await writeJson(join(doc.dir, 'edit.json'), doc.edit);
  await writeJson(join(doc.dir, 'timing.json'), timing);
  await writeJson(join(doc.dir, 'captions.json'), captions);
  await writeJson(stateFile(doc.dir), doc.state);
  return { timing, captions };
}

export async function loadProject(dir: string): Promise<ProjectDoc> {
  const state = await readJson<ProjectState>(stateFile(dir));
  if (state.version > STATE_VERSION) throw new Error(`Proyek dibuat versi app yang lebih baru (state v${state.version})`);
  const edit = await readJson<EditJson>(join(dir, 'edit.json'));
  const overlay = {
    css: await readOpt(join(dir, 'overlay.css')),
    html: await readOpt(join(dir, 'overlay.html')),
    js: await readOpt(join(dir, 'overlay.js')),
  };
  return { dir, edit, state, overlay };
}
