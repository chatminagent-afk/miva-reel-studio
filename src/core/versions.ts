// Checkpoint versi proyek (v1, v2, ...): salinan edit.json + state di .reel/versions/vN/. Salinan kerja (file di root
// proyek, format skill) tetap satu; membuka versi lama menyalinnya ke salinan kerja, versi lama tidak pernah ditimpa.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectState } from './doc';
import type { EditJson } from './types';

export interface VersionInfo {
  n: number;
  created: string;
  label: string;
}

const dirOf = (proj: string) => join(proj, '.reel', 'versions');

export async function listVersions(proj: string): Promise<VersionInfo[]> {
  const root = dirOf(proj);
  if (!existsSync(root)) return [];
  const out: VersionInfo[] = [];
  for (const name of await readdir(root)) {
    const m = /^v(\d+)$/.exec(name);
    if (!m || !existsSync(join(root, name, 'meta.json'))) continue;
    out.push(JSON.parse(await readFile(join(root, name, 'meta.json'), 'utf-8')) as VersionInfo);
  }
  return out.sort((a, b) => a.n - b.n);
}

// motion kosong dan tidak ada dianggap sama (proyek lama belum punya field-nya)
export const sameDoc = (a: { edit: EditJson; state: ProjectState }, b: { edit: EditJson; state: ProjectState }) =>
  JSON.stringify(a.edit) === JSON.stringify(b.edit) &&
  JSON.stringify(a.state.keywords) === JSON.stringify(b.state.keywords) &&
  JSON.stringify(a.state.motion ?? []) === JSON.stringify(b.state.motion ?? []) &&
  (a.state.motionBrief ?? '') === (b.state.motionBrief ?? '');

/** Simpan versi baru (vN+1). Kalau isinya sama dengan versi terakhir, versi terakhir dikembalikan (tidak dobel). */
export async function saveVersion(proj: string, doc: { edit: EditJson; state: ProjectState }, label: string): Promise<VersionInfo> {
  const list = await listVersions(proj);
  const last = list[list.length - 1];
  if (last) {
    const prev = await loadVersion(proj, last.n);
    if (sameDoc(prev, doc)) return last;
  }
  const n = (last?.n ?? 0) + 1;
  const dir = join(dirOf(proj), `v${n}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'edit.json'), JSON.stringify(doc.edit, null, 1));
  await writeFile(join(dir, 'state.json'), JSON.stringify(doc.state));
  const info: VersionInfo = { n, created: new Date().toISOString(), label };
  await writeFile(join(dir, 'meta.json'), JSON.stringify(info)); // meta terakhir: versi hanya terlihat kalau lengkap
  return info;
}

export async function loadVersion(proj: string, n: number): Promise<{ edit: EditJson; state: ProjectState }> {
  const dir = join(dirOf(proj), `v${n}`);
  return {
    edit: JSON.parse(await readFile(join(dir, 'edit.json'), 'utf-8')) as EditJson,
    state: JSON.parse(await readFile(join(dir, 'state.json'), 'utf-8')) as ProjectState,
  };
}

/** Versi yang isinya sama dengan dokumen sekarang (untuk label di header), atau null kalau ada perubahan sesudahnya. */
export async function matchingVersion(proj: string, doc: { edit: EditJson; state: ProjectState }): Promise<number | null> {
  const list = await listVersions(proj);
  for (let i = list.length - 1; i >= 0; i--) if (sameDoc(await loadVersion(proj, list[i].n), doc)) return list[i].n;
  return null;
}
