// IPC export: UI meminta export, proses utama menjalankan runner (src/core/export.ts) dan mengirim progress.
// Urutan: base.mp4 dibuat ulang kalau potongan/kecepatan/grade berubah -> export (overlay + gabung) -> cover JPG
// (opsional) -> salinan WhatsApp (opsional). Hanya satu export berjalan; batal dan menutup app menghentikan semuanya.
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { app, ipcMain, shell, type WebContents } from 'electron';
import { ensureBase } from '../core/basecache';
import { buildCompositionData } from '../core/compose';
import { renderCover } from '../core/cover';
import { exportReel, type Codec, type ExportProgress, type ExportResult, type Quality, type Resolution } from '../core/export';
import { CancelledError, runProcess } from '../core/proc';
import type { CaptionsJson, EditJson, TimingJson } from '../core/types';
import { appResources } from './resources';
import { setSettings } from './settings';

export interface ExportRequest {
  projDir: string;
  output: string;
  resolution: Resolution;
  fps: 30 | 60;
  codec: Codec;
  quality?: Quality;
  /** cover JPG: judul format skill ("kecil|*BESAR*|kecil"); null = tanpa cover */
  cover?: { title: string; t?: number } | null;
  /** salinan kecil untuk WhatsApp (<nama>-wa.mp4, CRF 23 maks 4 Mbps, sama dengan render.sh --wa) */
  waCopy?: boolean;
  openFolder?: boolean;
  /** simpan folder output sebagai folder export default */
  setDefaultDir?: boolean;
}

export interface ExportDone extends ExportResult {
  cover: string | null;
  waCopy: string | null;
  baseRebuilt: boolean;
}

export type ExportEvent =
  | ({ id: number; type: 'progress' } & Omit<ExportProgress, 'stage'> & { stage: ExportProgress['stage'] | 'base' | 'cover' | 'wa' })
  | { id: number; type: 'done'; result: ExportDone }
  | { id: number; type: 'cancelled' }
  | { id: number; type: 'error'; message: string };

const RESOLUTIONS: Resolution[] = ['1080p', '2k', '4k'];
const CODECS: Codec[] = ['h264', 'hevc'];

function validate(r: ExportRequest): void {
  if (!r || typeof r.projDir !== 'string' || !isAbsolute(r.projDir)) throw new Error('Folder proyek tidak valid');
  if (typeof r.output !== 'string' || !isAbsolute(r.output) || !/\.mp4$/i.test(r.output)) throw new Error('File output harus .mp4 (path absolut)');
  if (!RESOLUTIONS.includes(r.resolution)) throw new Error(`Resolusi tidak dikenal: ${r.resolution}`);
  if (r.fps !== 30 && r.fps !== 60) throw new Error(`FPS tidak didukung: ${r.fps}`);
  if (!CODECS.includes(r.codec)) throw new Error(`Codec tidak dikenal: ${r.codec}`);
  if (r.quality && r.quality !== 'recommended' && r.quality !== 'higher') throw new Error(`Kualitas tidak dikenal: ${r.quality}`);
}

function loadSfx(dir: string) {
  const f = (n: string) => join(dir, n);
  if (!existsSync(f('catalog.json')) || !existsSync(f('_fitur.json'))) throw new Error(`Pustaka SFX belum ada di ${dir}`);
  return {
    dir,
    catalog: JSON.parse(readFileSync(f('catalog.json'), 'utf-8')),
    features: JSON.parse(readFileSync(f('_fitur.json'), 'utf-8')),
  };
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T;

/** Judul cover + waktu default: kata kunci pertama (baris kecil sebelum/sesudah, kata besar emas). */
export function defaultCover(projDir: string): { title: string; t: number } {
  const T = readJson<TimingJson>(join(projDir, 'timing.json'));
  const C = readJson<CaptionsJson>(join(projDir, 'captions.json'));
  const E = readJson<EditJson>(join(projDir, 'edit.json'));
  const k = buildCompositionData(T, C, E).keys[0];
  if (!k) return { title: '', t: Math.min(1, T.duration / 3) };
  return { title: k.lines.map((l) => (l.big ? `*${l.t}*` : l.t)).join('|'), t: Math.min(T.duration - 0.1, k.hit + 0.6) };
}

let seq = 0;
let job: { id: number; ac: AbortController } | null = null;
let quitting = false;

export function registerExportIpc(): void {
  ipcMain.handle('export:defaultCover', (_e, projDir: string) => defaultCover(projDir));

  ipcMain.handle('export:start', (e, req: ExportRequest) => {
    if (job) throw new Error('Export lain sedang berjalan');
    validate(req);
    const res = appResources();
    const id = ++seq;
    const ac = new AbortController();
    job = { id, ac };
    const send = (ev: ExportEvent, to: WebContents = e.sender) => {
      if (!to.isDestroyed()) to.send('export:event', ev);
    };
    // progress dibatasi ±10 kali/detik; pergantian tahap selalu dikirim
    let last = 0;
    let lastStage = '';
    const progress = (stage: Extract<ExportEvent, { type: 'progress' }>['stage'], value: number, message: string) => {
      const now = Date.now();
      if (stage === lastStage && now - last < 100) return;
      last = now;
      lastStage = stage;
      send({ id, type: 'progress', stage, progress: Math.min(1, value), message });
    };
    void (async () => {
      const extras: string[] = [];
      try {
        const P = req.projDir;
        const edit = readJson<EditJson>(join(P, 'edit.json'));
        // bobot: base (kalau perlu) 0–0,3, export 0,3–0,95, cover + WA 0,95–1
        progress('base', 0, 'Preparing video');
        const rebuilt = await ensureBase(P, edit, { signal: ac.signal, onFrac: (f) => progress('base', f * 0.3, 'Cutting and cleaning footage') });
        const off = rebuilt ? 0.3 : 0;
        const span = 0.95 - off;
        const result = await exportReel({
          projDir: P,
          output: req.output,
          resolution: req.resolution,
          fps: req.fps,
          codec: req.codec,
          quality: req.quality,
          runtime: res.runtime,
          template: readFileSync(res.templatePath, 'utf-8'),
          fontCss: readFileSync(join(res.renderAssetsDir, 'fonts.css'), 'utf-8'),
          renderAssetsDir: res.renderAssetsDir,
          sfx: loadSfx(res.sfxDir),
          signal: ac.signal,
          onProgress: (p) => p.stage !== 'done' && progress(p.stage, off + p.progress * span, p.message),
        });
        const base = req.output.replace(/\.mp4$/i, '');
        let cover: string | null = null;
        if (req.cover) {
          progress('cover', 0.96, 'Cover JPG');
          cover = `${base}-cover.jpg`;
          const d = defaultCover(P);
          await renderCover({
            base: join(P, 'assets', 'base.mp4'),
            t: req.cover.t ?? d.t,
            title: req.cover.title || d.title,
            out: cover,
            workDir: join(P, 'renders'),
            browser: res.runtime.browser,
            fontCss: readFileSync(join(res.renderAssetsDir, 'fonts.css'), 'utf-8'),
            fontsDir: join(res.renderAssetsDir, 'fonts'),
            signal: ac.signal,
          });
          extras.push(cover);
        }
        let wa: string | null = null;
        if (req.waCopy) {
          progress('wa', 0.98, 'WhatsApp copy');
          wa = `${base}-wa.mp4`;
          extras.push(wa);
          await runProcess(res.runtime.ffmpeg, [
            '-v', 'error', '-y', '-i', req.output, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', wa,
          ], { signal: ac.signal });
        }
        if (req.setDefaultDir) setSettings({ exportDir: dirname(req.output) });
        lastStage = '';
        progress('done', 1, 'Done');
        send({ id, type: 'done', result: { ...result, cover, waCopy: wa, baseRebuilt: rebuilt } });
        if (req.openFolder) shell.showItemInFolder(result.output);
      } catch (err) {
        for (const f of extras) await rm(f, { force: true });
        if (err instanceof CancelledError) {
          await rm(req.output, { force: true });
          send({ id, type: 'cancelled' });
        } else send({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        job = null;
        if (quitting) app.quit();
      }
    })();
    return id;
  });

  ipcMain.handle('export:cancel', () => {
    if (!job) return false;
    job.ac.abort();
    return true;
  });

  // jangan tinggalkan Chrome/ffmpeg yatim saat app ditutup di tengah export: batalkan, tunggu selesai, baru keluar
  app.on('before-quit', (ev) => {
    if (!job) return;
    ev.preventDefault();
    quitting = true;
    job.ac.abort();
  });
}
