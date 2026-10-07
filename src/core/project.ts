// Folder proyek app = folder proyek skill /reel-edit (edit.json, words-raw.json, timing.json, captions.json, overlay.*,
// assets/, renders/) + `.reel/state.json` untuk data khusus app (kata dengan e_ref, kata kunci per kata mentah, flag Auto Edit).
//
// timing.json dan captions.json selalu DITURUNKAN dari edit.json + state (bukan diedit langsung): captions.json skill
// mengacu ke indeks timing.json, yang berubah setiap potongan berubah. Kata kunci disimpan per kata mentah supaya tetap
// menempel di kata yang sama.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { mapTiming, SPEED_DEFAULT } from './base';
import { draftCaptions } from './captions';
import { keptWordIndices } from './edit';
import type { KeywordMark, Retake } from './suggest';
import type { CaptionsJson, Chunk, EditJson, RawWord, TimingJson } from './types';

export const STATE_VERSION = 1;

export interface ProjectState {
  version: number;
  name: string;
  /** footage mentah (path absolut) */
  source: string;
  created: string;
  updated: string;
  /** durasi audio footage mentah */
  duration: number;
  /** kata Whisper (waktu mentah) + e_ref (akhir kata dipangkas energi suara) */
  words: RawWord[];
  keywords: KeywordMark[];
  /** retake yang dibuang Auto Edit (untuk ditinjau) */
  retakes: Retake[];
  /** noise floor pita suara (dB), info */
  floor: number;
  /** cara saran kata kunci terakhir */
  keywordMode: 'rules' | 'llm' | 'claude' | 'manual';
  /** indeks kata pertama tiap segmen Whisper (awal kalimat; dipakai saran kata kunci) */
  segStarts?: number[];
}

export interface ProjectDoc {
  dir: string;
  edit: EditJson;
  state: ProjectState;
  overlay: { css?: string; html?: string; js?: string };
}

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

/** captions.json dari timing + kata kunci (indeks kata mentah). */
export function buildCaptions(timing: TimingJson, kept: number[], marks: KeywordMark[]): CaptionsJson {
  const draft = draftCaptions(timing);
  const toT = new Map(kept.map((raw, t) => [raw, t]));
  const chunks: Chunk[] = draft.chunks.map((c) => ({ ...c }));
  for (const m of marks) {
    const big = m.big.map((r) => toT.get(r)).filter((t): t is number => t !== undefined);
    if (!big.length) continue; // kata kunci sedang dipotong
    const c = chunks.find((ch) => ch.w.includes(big[0]));
    if (!c) continue;
    c.big = big.filter((t) => c.w.includes(t));
    c.anim = m.anim;
    if (m.hit) c.hit = m.hit;
    if (m.pos && m.pos !== 'c') c.pos = m.pos;
  }
  return { chunks };
}

/** timing.json + captions.json yang diturunkan dari dokumen. */
export function derive(doc: Pick<ProjectDoc, 'edit' | 'state'>): { timing: TimingJson; captions: CaptionsJson; kept: number[] } {
  // words-raw.json skill tidak berisi e_ref (timing memakai akhir kata Whisper); app mengikuti skill dulu (lihat DECISIONS)
  const raw = doc.state.words.map(({ e_ref: _e, ...w }) => w);
  const { timing } = mapTiming(doc.edit, raw);
  const kept = keptWordIndices(doc.edit.segs, doc.state.words);
  return { timing, captions: buildCaptions(timing, kept, doc.state.keywords), kept };
}

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

/** edit.json awal (sama dengan default transcribe.py skill) + pilihan import. */
export function initialEdit(src: string, opts: { speed?: number; grade?: string; fix?: Record<string, string> } = {}): EditJson {
  return {
    src,
    segs: [],
    fix: { ...(opts.fix ?? {}) },
    grade: opts.grade ?? 'natural',
    speed: opts.speed ?? SPEED_DEFAULT,
    music: { style: 'none' },
    camera: 'auto',
    sfx: [],
    inserts: [],
  };
}
