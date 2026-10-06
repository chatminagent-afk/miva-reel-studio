// E2E: export lewat UI API app Electron (renderer -> IPC -> proses utama -> HyperFrames sebagai Electron-as-Node).
// Membuktikan jalur yang dipakai app terpasang, bukan hanya fungsi core: progress, selesai, batal, tutup app saat export.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExportEvent } from '../../src/main/export';
import { BROWSER, hasBrowser, makeAcuanProject, makeSfxLib } from '../tools/project';

const chromeLeft = () => spawnSync('pgrep', ['-f', BROWSER], { encoding: 'utf-8' }).stdout.trim();

async function launch(sfxDir: string): Promise<{ app: ElectronApplication; win: Page; external: string[] }> {
  const app = await electron.launch({ args: ['--no-sandbox', resolve('out/main/index.js')], env: { ...process.env, REEL_SFX_DIR: sfxDir } });
  const win = await app.firstWindow();
  const external: string[] = [];
  win.on('request', (r) => {
    if (!/^(file|data|blob|devtools):/.test(r.url())) external.push(r.url());
  });
  await win.waitForSelector('[data-testid="import"]', { timeout: 20000 });
  // kumpulkan event export di halaman
  await win.evaluate(() => {
    (window as unknown as { __ev: ExportEvent[] }).__ev = [];
    window.reel.onExportEvent((e) => (window as unknown as { __ev: ExportEvent[] }).__ev.push(e));
  });
  return { app, win, external };
}

const events = (win: Page) => win.evaluate(() => (window as unknown as { __ev: ExportEvent[] }).__ev);

async function waitFor(win: Page, pred: (ev: ExportEvent[]) => boolean, ms = 540_000): Promise<ExportEvent[]> {
  const t0 = Date.now();
  for (;;) {
    const ev = await events(win);
    if (pred(ev)) return ev;
    if (Date.now() - t0 > ms) throw new Error(`timeout; event terakhir: ${JSON.stringify(ev.at(-1))}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe.skipIf(!hasBrowser)('export lewat app Electron', () => {
  let work: string;
  let sfxDir: string;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'reel-e2e-'));
    sfxDir = (await makeSfxLib(join(work, 'sfx'))).dir;
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('export selesai: progress sampai 100%, MP4 1080×1920, tanpa request jaringan', async () => {
    const proj = join(work, 'p1');
    await makeAcuanProject(proj, { seconds: 4 });
    const out = join(proj, 'renders', 'e2e.mp4');
    const { app, win, external } = await launch(sfxDir);
    try {
      const id = await win.evaluate((r) => window.reel.exportStart(r), { projDir: proj, output: out, resolution: '1080p' as const, fps: 30 as const, codec: 'h264' as const });
      // export kedua saat yang pertama berjalan ditolak
      await expect(win.evaluate((r) => window.reel.exportStart(r), { projDir: proj, output: out, resolution: '1080p' as const, fps: 30 as const, codec: 'h264' as const })).rejects.toThrow(/sedang berjalan/);
      const ev = await waitFor(win, (e) => e.some((x) => x.type !== 'progress'));
      const end = ev.at(-1)!;
      expect(end, JSON.stringify(end)).toMatchObject({ id, type: 'done' });
      const prog = ev.filter((x) => x.type === 'progress');
      expect(prog.length).toBeGreaterThan(5);
      expect(prog.at(-1)).toMatchObject({ stage: 'done', progress: 1 });
      const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf-8' }).trim();
      expect(dims).toBe('1080,1920');
      expect(external).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('tombol batal: event cancelled, output tidak ada, Chrome tidak tertinggal', async () => {
    const proj = join(work, 'p2');
    await makeAcuanProject(proj);
    const out = join(proj, 'renders', 'batal.mp4');
    const { app, win } = await launch(sfxDir);
    try {
      await win.evaluate((r) => window.reel.exportStart(r), { projDir: proj, output: out, resolution: '1080p' as const, fps: 30 as const, codec: 'h264' as const });
      await waitFor(win, (e) => e.some((x) => x.type === 'progress' && x.stage === 'overlay' && /frame \d+/.test(x.message)));
      expect(await win.evaluate(() => window.reel.exportCancel())).toBe(true);
      const ev = await waitFor(win, (e) => e.some((x) => x.type !== 'progress'), 30_000);
      expect(ev.at(-1)!.type).toBe('cancelled');
      expect(existsSync(out)).toBe(false);
      await new Promise((r) => setTimeout(r, 1500));
      expect(chromeLeft()).toBe('');
    } finally {
      await app.close();
    }
  });

  it('app ditutup di tengah export: proses render ikut berhenti', async () => {
    const proj = join(work, 'p3');
    await makeAcuanProject(proj);
    const { app, win } = await launch(sfxDir);
    await win.evaluate((r) => window.reel.exportStart(r), { projDir: proj, output: join(proj, 'renders', 'tutup.mp4'), resolution: '1080p' as const, fps: 30 as const, codec: 'h264' as const });
    await waitFor(win, (e) => e.some((x) => x.type === 'progress' && x.stage === 'overlay' && /frame \d+/.test(x.message)));
    await app.close();
    await new Promise((r) => setTimeout(r, 2000));
    expect(chromeLeft()).toBe('');
    expect(existsSync(join(proj, 'renders', '_frames'))).toBe(false);
  });
});
