// base.mp4 + voice.wav (potong + percepat + grade + bersihkan suara, build_base.py) hanya dibuat ulang kalau isinya
// berubah: kunci = footage, potongan, kecepatan, grade. Proyek buatan skill (tanpa .reel/state.json) tidak disentuh.
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildBaseCommands } from './base';
import { ffmpegPath, graphToFile } from './ffmpeg';
import { runProcess } from './proc';
import { tailOf } from './timing';
import type { EditJson } from './types';

export function baseKey(edit: EditJson): string {
  let src = { size: 0, mtime: 0 };
  try {
    const st = statSync(edit.src);
    src = { size: st.size, mtime: Math.round(st.mtimeMs) };
  } catch {
    /* footage hilang: kunci tetap dihitung, build akan gagal dengan pesan ffmpeg */
  }
  // tail hanya masuk kunci kalau > 0: kunci proyek lama (tanpa tail) tidak berubah, base-nya tidak dibangun ulang
  const tail = tailOf(edit);
  return JSON.stringify({ src: edit.src, ...src, segs: edit.segs, speed: edit.speed ?? 1.25, grade: edit.grade ?? 'natural', ...(tail ? { tail } : {}) });
}

export async function baseIsFresh(proj: string, edit: EditJson): Promise<boolean> {
  if (!existsSync(join(proj, 'assets', 'base.mp4')) || !existsSync(join(proj, 'assets', 'voice.wav'))) return false;
  if (!existsSync(join(proj, '.reel', 'state.json'))) return true; // proyek skill: base dibuat skill
  const f = join(proj, '.reel', 'base.json');
  if (!existsSync(f)) return false;
  return JSON.parse(await readFile(f, 'utf-8')).key === baseKey(edit);
}

/** Bangun base kalau perlu. Kembalikan true kalau dibangun ulang. */
export async function ensureBase(proj: string, edit: EditJson, o: { signal?: AbortSignal; onFrac?: (f: number) => void } = {}): Promise<boolean> {
  if (await baseIsFresh(proj, edit)) return false;
  if (!edit.segs.length) throw new Error('Semua bagian video dipotong: tidak ada yang bisa di-export');
  await mkdir(join(proj, 'assets'), { recursive: true });
  const [encode, video, audio] = buildBaseCommands(edit, proj);
  const out = edit.segs.reduce((a, [x, y]) => a + (y - x), 0) / Number(edit.speed ?? 1.25) + tailOf(edit);
  const graphFile = join(proj, 'assets', '_base-graph.txt'); // graf potong+gabung tumbuh ±161 karakter per potongan
  try {
    const encodeArgs = await graphToFile(['-v', 'error', '-y', '-nostats', '-progress', 'pipe:1', ...encode], graphFile);
    await runProcess(ffmpegPath(), encodeArgs, {
      signal: o.signal,
      onStdoutLine: (l) => {
        const m = /^out_time_us=(\d+)/.exec(l);
        if (m && out > 0) o.onFrac?.(Math.min(0.98, Number(m[1]) / 1e6 / out));
      },
    });
    await runProcess(ffmpegPath(), ['-v', 'error', '-y', ...video], { signal: o.signal });
    await runProcess(ffmpegPath(), ['-v', 'error', '-y', ...audio], { signal: o.signal });
  } finally {
    await rm(graphFile, { force: true });
    await rm(join(proj, 'assets', '_base.mov'), { force: true });
  }
  await mkdir(join(proj, '.reel'), { recursive: true });
  await writeFile(join(proj, '.reel', 'base.json'), JSON.stringify({ key: baseKey(edit), built: new Date().toISOString() }));
  o.onFrac?.(1);
  return true;
}
