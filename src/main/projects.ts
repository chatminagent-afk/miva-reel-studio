// IPC proyek: pengaturan, proyek terakhir, buka/simpan, Auto Edit (dengan progress + batal), komposisi preview.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app, ipcMain, type WebContents } from 'electron';
import { makeProxy, PROXY, runAutoEdit, type AutoEditProgress, type AutoEditResult } from '../core/autoedit';
import { decodeMono16 } from '../core/ffmpeg';
import { derive, loadProject, saveProject, type ProjectDoc } from '../core/project';
import { CancelledError } from '../core/proc';
import { listVersions, loadVersion, matchingVersion, saveVersion } from '../core/versions';
import { WhisperError } from '../core/whisper';
import { setPreviewHtml, setProjectDir, setSfxDir } from './protocol';
import { appResources, appWhisper } from './resources';
import { getSettings, recentProjects, setSettings, touchRecent, type Settings } from './settings';

export interface AutoEditRequest {
  src: string;
  autoEdit: boolean;
  speed: boolean;
  grade: 'natural' | 'warm' | 'lift';
}

export type AutoEditEvent =
  | ({ id: number; type: 'progress' } & AutoEditProgress)
  | { id: number; type: 'done'; dir: string; summary: AutoEditResult['summary'] }
  | { id: number; type: 'cancelled' }
  | { id: number; type: 'error'; message: string; code?: string };

export interface OpenedProject {
  doc: ProjectDoc;
  /** timing.json/captions.json turunan saat dibuka */
  timing: ReturnType<typeof derive>['timing'];
  captions: ReturnType<typeof derive>['captions'];
  /** versi proxy preview, lihat proxyRev() */
  proxyRev: string;
}

/**
 * Versi proxy (folder proyek + waktu ubah + ukuran), dipakai di URL preview. File proxy selalu assets/_proxy.mp4, dan
 * Chromium memakai ulang data media untuk URL yang sama: tanpa versi ini preview memutar video proyek sebelumnya atau
 * proxy sebelum ganti Grade (bug 07/10).
 */
export function proxyRev(dir: string): string {
  const id = createHash('sha1').update(dir).digest('hex').slice(0, 10);
  try {
    const s = statSync(join(dir, PROXY));
    return `${id}-${Math.round(s.mtimeMs)}-${s.size}`;
  } catch {
    return `${id}-0`;
  }
}

/** rename yang tahan kunci sesaat di Windows (file sedang dibaca preview atau antivirus): coba ulang sampai ±2 dtk. */
async function replaceFile(tmp: string, dest: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, dest);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 20 || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await rm(tmp, { force: true });
        throw e;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

let current: string | null = null;
let seq = 0;
let job: { id: number; ac: AbortController } | null = null;
let quitting = false;

export function currentProjectDir(): string | null {
  return current;
}

async function open(dir: string): Promise<OpenedProject> {
  const doc = await loadProject(dir);
  current = dir;
  setProjectDir(dir);
  touchRecent(dir, doc.state.name);
  const { timing, captions } = derive(doc);
  return { doc, timing, captions, proxyRev: proxyRev(dir) };
}

export function registerProjectIpc(): void {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => setSettings(patch));
  ipcMain.handle('projects:recent', () => recentProjects());
  ipcMain.handle('projects:open', (_e, dir: string) => open(dir));
  // checkpoint versi: daftar, simpan, buka (keadaan sekarang disimpan dulu sebagai versi kalau belum ada)
  ipcMain.handle('versions:list', async (_e, doc: Pick<ProjectDoc, 'edit' | 'state'>) => {
    if (!current) return { versions: [], current: null };
    return { versions: await listVersions(current), current: await matchingVersion(current, doc) };
  });
  ipcMain.handle('versions:save', async (_e, doc: Pick<ProjectDoc, 'edit' | 'state'>, label: string) => {
    if (!current) throw new Error('Tidak ada proyek terbuka');
    return saveVersion(current, doc, label || 'Manual');
  });
  ipcMain.handle('versions:open', async (_e, n: number, doc: Pick<ProjectDoc, 'edit' | 'state'>) => {
    if (!current) throw new Error('Tidak ada proyek terbuka');
    const dir = current;
    if ((await matchingVersion(dir, doc)) === null) await saveVersion(dir, doc, `Before opening v${n}`);
    const v = await loadVersion(dir, n);
    const full = await loadProject(dir);
    await saveProject({ ...full, edit: v.edit, state: v.state });
    return open(dir);
  });
  ipcMain.handle('projects:save', async (_e, doc: Pick<ProjectDoc, 'edit' | 'state'>) => {
    if (!current) throw new Error('Tidak ada proyek terbuka');
    const full = await loadProject(current);
    await saveProject({ ...full, edit: doc.edit, state: doc.state });
    return { saved: new Date().toISOString() };
  });

  // aset untuk membangun komposisi preview di UI (template skill + @font-face lokal)
  ipcMain.handle('render:assets', () => {
    const res = appResources();
    return { template: readFileSync(res.templatePath, 'utf-8'), fontCss: readFileSync(join(res.renderAssetsDir, 'fonts.css'), 'utf-8') };
  });
  ipcMain.handle('preview:set', (_e, html: string) => setPreviewHtml(html));
  // grade berubah: proxy preview dibuat ulang (file sementara lalu diganti, preview lama tetap jalan sampai selesai)
  ipcMain.handle('projects:proxy', async (_e, grade: string) => {
    if (!current) throw new Error('Tidak ada proyek terbuka');
    const dir = current;
    const doc = await loadProject(dir);
    const tmp = join(dir, 'assets', '_proxy.next.mp4');
    await makeProxy(appResources().runtime.ffmpeg, doc.state.source, tmp, grade, doc.state.duration);
    await replaceFile(tmp, join(dir, PROXY));
    return { ok: true, proxyRev: proxyRev(dir) };
  });
  // bentuk gelombang suara footage mentah: puncak per 10 ms (0..1), dari proxy
  ipcMain.handle('projects:waveform', async () => {
    if (!current) return [];
    const a = await decodeMono16(join(current, PROXY), 8000);
    const out: number[] = [];
    for (let i = 0; i < a.length; i += 80) {
      let m = 0;
      for (let j = i; j < Math.min(a.length, i + 80); j++) m = Math.max(m, Math.abs(a[j]));
      out.push(Math.round(m * 1000) / 1000);
    }
    return out;
  });
  // pustaka SFX aktif: untuk SFX otomatis di UI, audisi, dan preview (file lewat reel://sfx/<id>.wav)
  ipcMain.handle('sfx:library', () => {
    const dir = appResources().sfxDir;
    setSfxDir(dir);
    return {
      catalog: JSON.parse(readFileSync(join(dir, 'catalog.json'), 'utf-8')),
      features: JSON.parse(readFileSync(join(dir, '_fitur.json'), 'utf-8')),
      builtin: /sfx-default$/.test(dir),
    };
  });

  ipcMain.handle('autoedit:start', (e, req: AutoEditRequest) => {
    if (job) throw new Error('Auto Edit lain sedang berjalan');
    if (typeof req?.src !== 'string' || !req.src) throw new Error('File footage tidak valid');
    const s = getSettings();
    setSettings({ importDefaults: { autoEdit: req.autoEdit, speed: req.speed, grade: req.grade } });
    const res = appResources();
    const id = ++seq;
    const ac = new AbortController();
    job = { id, ac };
    const sender: WebContents = e.sender;
    const send = (ev: AutoEditEvent) => {
      if (!sender.isDestroyed()) sender.send('autoedit:event', ev);
    };
    let last = 0;
    void (async () => {
      try {
        const r = await runAutoEdit({
          src: req.src,
          root: s.projectsRoot,
          speed: req.speed ? 1.25 : 1,
          grade: req.grade,
          fix: s.fix,
          names: s.names,
          device: s.whisperDevice,
          autoCut: req.autoEdit,
          ffmpeg: res.runtime.ffmpeg,
          whisper: appWhisper(),
          signal: ac.signal,
          onProgress: (p) => {
            const now = Date.now();
            if (p.progress > 0 && p.progress < 1 && now - last < 100) return;
            last = now;
            send({ id, type: 'progress', ...p });
          },
        });
        touchRecent(r.doc.dir, r.doc.state.name);
        send({ id, type: 'done', dir: r.doc.dir, summary: r.summary });
      } catch (err) {
        if (err instanceof CancelledError) send({ id, type: 'cancelled' });
        else send({ id, type: 'error', message: err instanceof Error ? err.message : String(err), code: err instanceof WhisperError ? err.code : undefined });
      } finally {
        job = null;
        if (quitting) app.quit();
      }
    })();
    return id;
  });
  ipcMain.handle('autoedit:cancel', () => {
    if (!job) return false;
    job.ac.abort();
    return true;
  });
  app.on('before-quit', (ev) => {
    if (!job) return;
    ev.preventDefault();
    quitting = true;
    job.ac.abort();
  });
}
