// E2E alur utama lewat UI app Electron: Import -> Auto Edit (sidecar asli + Whisper palsu dengan kata tes2) -> editor
// (coret kata, undo/redo, jeda, kata kunci, putar preview) -> Export (base dibangun ulang, cover, salinan WA) -> buka ulang.
// Skenario UAT 1–4, 6, 7, 12 (sebagian), 13–16 di docs/2026-10-06-uat-plan.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROWSER, hasBrowser } from '../tools/project';
import { fakeWhisperEnv, launchApp, makeRawFootage, ROOT, stubOpenDialog } from './helpers';

const hasSite = existsSync(join(ROOT, 'tests', 'fixtures', 'fake_whisper_site'));
const finalSecs = async (win: Page) => {
  const [m, sec] = (await win.textContent('[data-testid="timecode"]'))!.split('/')[1].trim().split(':').map(Number);
  return m * 60 + sec;
};

describe.skipIf(!hasBrowser || !hasSite)('alur editor lewat UI', () => {
  let work: string;
  let raw: string;
  let app: ElectronApplication;
  let win: Page;
  const external: string[] = [];

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'reel-ui-'));
    raw = join(work, 'tes2-raw.mp4');
    await makeRawFootage(raw);
    ({ app, win } = await launchApp(work, fakeWhisperEnv(work)));
    win.on('request', (r) => {
      if (!/^(file|data|blob|devtools|reel):/.test(r.url())) external.push(r.url());
    });
    await win.waitForSelector('[data-testid="choose"]');
    await win.evaluate((w) => window.reel.setSettings({ projectsRoot: `${w}/projects`, exportDir: `${w}/exports` }), work);
  });
  afterAll(async () => {
    await app?.close().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  });

  it('import + Auto Edit: progress 5 langkah, lalu editor dengan transkrip, potongan, kata kunci', async () => {
    await stubOpenDialog(app, raw);
    await win.click('[data-testid="choose"]');
    await win.waitForSelector('[data-testid="steps"]');
    await win.waitForSelector('[data-testid="editor"]', { timeout: 180_000 });
    expect(await win.textContent('[data-testid="autoedit-banner"]')).toMatch(/silences .* removed, \d+ keywords suggested/);
    expect(await win.$$eval('[data-testid="transcript"] .w', (els) => els.length)).toBe(72);
    expect(await win.$$eval('.w.key', (els) => els.map((e) => e.textContent))).toEqual(['CapCut,', 'Claude']);
    expect(await win.$$eval('.gap-cut', (els) => els.length)).toBeGreaterThan(3);
    expect(await win.$$eval('[data-testid="cut-piece"]', (els) => els.length)).toBeGreaterThan(3);
    // hasil 37 dtk -> ±21 dtk
    const total = await finalSecs(win);
    expect(total).toBeGreaterThan(15);
    expect(total).toBeLessThan(26);
  });

  it('coret kata (Delete) memperpendek video; undo/redo mengembalikannya persis', async () => {
    const before = await finalSecs(win);
    await win.click('[data-testid="w10"]');
    await win.keyboard.press('Delete');
    await win.waitForFunction(() => document.querySelector('[data-testid="w10"]')?.classList.contains('cut'));
    const after = await finalSecs(win);
    expect(after).toBeLessThan(before);
    await win.keyboard.press('Control+z');
    await win.waitForFunction(() => !document.querySelector('[data-testid="w10"]')?.classList.contains('cut'));
    expect(await finalSecs(win)).toBe(before);
    await win.keyboard.press('Control+Shift+z');
    await win.waitForFunction(() => document.querySelector('[data-testid="w10"]')?.classList.contains('cut'));
    expect(await finalSecs(win)).toBe(after);
  });

  it('jeda: simpan untuk grafik memperpanjang video', async () => {
    const before = await finalSecs(win);
    const gap = (await win.$$('.gap-cut'))[0];
    await gap.click();
    await win.click('.details .seg:has-text("Keep")');
    await win.waitForFunction((b) => {
      const t = document.querySelector('[data-testid="timecode"]')!.textContent!.split('/')[1].trim();
      const [m, s] = t.split(':').map(Number);
      return m * 60 + s > b;
    }, before);
  });

  it('kata kunci: jadikan kata biasa jadi kata kunci, pilih Boom', async () => {
    await win.click('[data-testid="w52"]'); // "subtitle"
    await win.click('.details [aria-label="Keyword"]');
    await win.waitForFunction(() => document.querySelector('[data-testid="w52"]')?.classList.contains('key'));
    await win.click('.details .seg:has-text("Boom")');
    expect(await win.textContent('.details')).toMatch(/boom/i);
  });

  it('preview: play memajukan waktu, overlay iframe termuat, tanpa request internet', async () => {
    await win.click('[data-testid="w20"]');
    const t0 = await win.textContent('[data-testid="timecode"]');
    await win.click('[data-testid="play"]');
    await new Promise((r) => setTimeout(r, 1500));
    await win.click('[data-testid="play"]');
    expect(await win.textContent('[data-testid="timecode"]')).not.toBe(t0);
    const frames = app.windows()[0].frames().map((f) => f.url());
    expect(frames.some((u) => u.startsWith('reel://preview/overlay.html'))).toBe(true);
    expect(external).toEqual([]);
  });

  it('export lewat dialog: base dibangun dari footage mentah, MP4 + cover + salinan WA', async () => {
    await win.click('[data-testid="open-export"]');
    await win.waitForSelector('[role="dialog"][aria-label="Export"]');
    await win.click('[aria-label="WhatsApp copy"]');
    await win.click('[aria-label="Open folder when done"]'); // jangan buka file manager di tes
    await win.click('[data-testid="export-start"]');
    await win.waitForSelector('[data-testid="export-progress"]');
    await win.waitForSelector('[data-testid="export-done"]', { timeout: 540_000 });
    const out = join(work, 'exports', 'tes2-raw.mp4');
    const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', out], { encoding: 'utf-8' });
    const p = JSON.parse(probe);
    expect([p.streams[0].width, p.streams[0].height]).toEqual([1080, 1920]);
    expect(Math.abs(Number(p.format.duration) - (await finalSecs(win)))).toBeLessThan(0.1);
    expect(existsSync(join(work, 'exports', 'tes2-raw-cover.jpg'))).toBe(true);
    expect(existsSync(join(work, 'exports', 'tes2-raw-wa.mp4'))).toBe(true);
    const proj = readdirSync(join(work, 'projects'))[0];
    expect(existsSync(join(work, 'projects', proj, 'assets', 'base.mp4'))).toBe(true);
    expect(spawnSync('pgrep', ['-f', BROWSER], { encoding: 'utf-8' }).stdout.trim()).toBe('');
    await win.click('[role="dialog"] .btn-pri:has-text("Close")');
  });

  it('autosave: buka ulang dari Recent, kata yang dicoret dan kata kunci tetap ada; proyek terbaca format skill', async () => {
    await new Promise((r) => setTimeout(r, 1500));
    await win.click('header .btn:has-text("Projects")');
    await win.waitForSelector('[data-testid="recent"]');
    await win.click('[data-testid="recent"]');
    await win.waitForSelector('[data-testid="editor"]');
    expect(await win.$eval('[data-testid="w10"]', (e) => e.classList.contains('cut'))).toBe(true);
    expect(await win.$eval('[data-testid="w52"]', (e) => e.classList.contains('key'))).toBe(true);
    const proj = join(work, 'projects', readdirSync(join(work, 'projects'))[0]);
    const C = JSON.parse(readFileSync(join(proj, 'captions.json'), 'utf-8'));
    const T = JSON.parse(readFileSync(join(proj, 'timing.json'), 'utf-8'));
    expect(C.chunks.flatMap((c: { w: number[] }) => c.w)).toEqual(T.words.map((_: unknown, i: number) => i));
    expect(C.chunks.some((c: { hit?: string }) => c.hit === 'boom')).toBe(true);
  });
});
