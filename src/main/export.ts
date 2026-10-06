// IPC export: UI meminta export, proses utama menjalankan runner (src/core/export.ts) dan mengirim progress.
// Hanya satu export berjalan pada satu waktu; tombol batal dan menutup app menghentikan seluruh proses render.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { app, ipcMain, shell, type WebContents } from 'electron';
import { exportReel, type Codec, type ExportProgress, type ExportResult, type Resolution } from '../core/export';
import { CancelledError } from '../core/proc';
import { appResources } from './resources';

export interface ExportRequest {
  projDir: string;
  output: string;
  resolution: Resolution;
  fps: 30 | 60;
  codec: Codec;
  openFolder?: boolean;
}

export type ExportEvent =
  | ({ id: number; type: 'progress' } & ExportProgress)
  | { id: number; type: 'done'; result: ExportResult }
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

let seq = 0;
let job: { id: number; ac: AbortController } | null = null;
let quitting = false;

export function registerExportIpc(): void {
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
    const onProgress = (p: ExportProgress) => {
      const now = Date.now();
      if (p.stage === lastStage && now - last < 100) return;
      last = now;
      lastStage = p.stage;
      send({ id, type: 'progress', ...p });
    };
    void (async () => {
      try {
        const result = await exportReel({
          projDir: req.projDir,
          output: req.output,
          resolution: req.resolution,
          fps: req.fps,
          codec: req.codec,
          runtime: res.runtime,
          template: readFileSync(res.templatePath, 'utf-8'),
          fontCss: readFileSync(join(res.renderAssetsDir, 'fonts.css'), 'utf-8'),
          renderAssetsDir: res.renderAssetsDir,
          sfx: loadSfx(res.sfxDir),
          signal: ac.signal,
          onProgress,
        });
        send({ id, type: 'done', result });
        if (req.openFolder) shell.showItemInFolder(result.output);
      } catch (err) {
        if (err instanceof CancelledError) send({ id, type: 'cancelled' });
        else send({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
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
