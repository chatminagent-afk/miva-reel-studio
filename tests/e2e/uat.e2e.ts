// UAT otomatis dengan komponen ASLI (model Whisper large-v3-turbo, Python + faster-whisper bawaan, FFmpeg, Chrome),
// dijalankan terhadap app hasil packaging (REEL_E2E_EXE). Suara uji = TTS (REEL_UAT_SPEECH, dibuat CI) diapit hening,
// jadi Auto Edit harus memotong hening awal/akhir. Akurasi bahasa Indonesia tetap dicek manual di laptop Steven.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpeg, ffmpegPath } from '../../src/core/ffmpeg';
import { launchApp, stubOpenDialog } from './helpers';

const SPEECH = process.env.REEL_UAT_SPEECH;
const ffprobeBin = () => process.env.REEL_FFPROBE ?? 'ffprobe';
const finalSecs = async (win: Page) => {
  const [m, s] = (await win.textContent('[data-testid="timecode"]'))!.split('/')[1].trim().split(':').map(Number);
  return m * 60 + s;
};
const previewVideo = (win: Page) =>
  win.$eval('[data-testid="preview-video"]', (v) => ({ src: (v as HTMLVideoElement).currentSrc, duration: (v as HTMLVideoElement).duration }));
const waitVideo = (win: Page) =>
  win.waitForFunction(() => ((document.querySelector('[data-testid="preview-video"]') as HTMLVideoElement | null)?.readyState ?? 0) >= 1, null, { timeout: 60_000 });

describe.skipIf(!SPEECH || !existsSync(SPEECH))('UAT dengan model Whisper asli', () => {
  let work: string;
  let raw: string;
  let rawDur: number;
  let raw2: string;
  let rawDur2: number;
  let app: ElectronApplication;
  let win: Page;
  const external: string[] = [];

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'reel-uat-'));
    raw = join(work, 'uat-raw.mp4');
    // 2,5 dtk hening (kamera dipasang) + suara + 1,5 dtk hening
    await ffmpeg([
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=2.5', '-i', SPEECH!, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1.5',
      '-filter_complex', '[1:a]aresample=48000,aformat=channel_layouts=stereo[s];[0:a][s][2:a]concat=n=3:v=0:a=1[a]',
      '-map', '[a]', '-c:a', 'pcm_s16le', join(work, 'audio.wav'),
    ]);
    rawDur = Number(execFileSync(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(work, 'audio.wav')], { encoding: 'utf-8' }));
    await ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=1080x1920:r=30:d=${rawDur}`, '-i', join(work, 'audio.wav'), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-shortest', raw]);
    // footage kedua (durasi beda) untuk regresi pindah proyek: 1 dtk hening + suara + 0,5 dtk hening
    raw2 = join(work, 'uat-raw2.mp4');
    await ffmpeg([
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1', '-i', SPEECH!, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=0.5',
      '-filter_complex', '[1:a]aresample=48000,aformat=channel_layouts=stereo[s];[0:a][s][2:a]concat=n=3:v=0:a=1[a]',
      '-map', '[a]', '-c:a', 'pcm_s16le', join(work, 'audio2.wav'),
    ]);
    rawDur2 = Number(execFileSync(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(work, 'audio2.wav')], { encoding: 'utf-8' }));
    await ffmpeg(['-f', 'lavfi', '-i', `testsrc=s=1080x1920:r=30:d=${rawDur2}`, '-i', join(work, 'audio2.wav'), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-shortest', raw2]);
    ({ app, win } = await launchApp(work));
    win.on('request', (r) => {
      if (!/^(file|data|blob|devtools|reel):/.test(r.url())) external.push(r.url());
    });
    await win.waitForSelector('[data-testid="choose"]', { timeout: 60_000 });
    await win.evaluate((w) => window.reel.setSettings({ projectsRoot: `${w}/projects`, exportDir: `${w}/exports` }), work);
  });
  afterAll(async () => {
    await app?.close().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  });

  it('komponen Whisper bawaan: versi terkunci, API cocok', async () => {
    const c = await win.evaluate(() => window.reel.whisperCheck());
    expect(c).toMatchObject({ faster_whisper: '1.2.1', ctranslate2: '4.8.2', missing_params: [] });
    console.log('whisper check', JSON.stringify(c));
  });

  it('import + Auto Edit dengan transkripsi asli: kata terbaca, hening dipotong', async () => {
    await stubOpenDialog(app, raw);
    await win.click('[data-testid="choose"]');
    await win.waitForSelector('[data-testid="editor"]', { timeout: 900_000 });
    const words = await win.$$eval('[data-testid="transcript"] .w', (els) => els.map((e) => e.textContent));
    console.log('transkrip:', words.join(' '));
    expect(words.length).toBeGreaterThanOrEqual(8);
    const fin = await finalSecs(win);
    expect(fin).toBeLessThan(rawDur - 3); // hening awal 2,5 dtk + akhir 1,5 dtk dibuang
    expect(fin).toBeGreaterThan(3);
    console.log('banner:', await win.textContent('[data-testid="autoedit-banner"]'));
  });

  it('export: base dari footage mentah, MP4 1080×1920, cover, durasi = hasil edit, tanpa request internet', async () => {
    await win.click('[data-testid="open-export"]');
    await win.waitForSelector('[role="dialog"][aria-label="Export"]');
    await win.click('[aria-label="Open folder when done"]');
    await win.click('[data-testid="export-start"]');
    await win.waitForSelector('[data-testid="export-done"], [data-testid="export-error"]', { timeout: 900_000 });
    const err = await win.$('[data-testid="export-error"]');
    if (err) throw new Error(`export gagal: ${await err.textContent()}`);
    const out = join(work, 'exports', readdirSync(join(work, 'exports')).find((f) => /\.mp4$/.test(f) && !/-wa\.mp4$/.test(f))!);
    const p = JSON.parse(execFileSync(ffprobeBin(), ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', out], { encoding: 'utf-8' }));
    expect([p.streams[0].width, p.streams[0].height]).toEqual([1080, 1920]);
    expect(Math.abs(Number(p.format.duration) - (await finalSecs(win)))).toBeLessThan(0.15);
    expect(readdirSync(join(work, 'exports')).some((f) => f.endsWith('-cover.jpg'))).toBe(true);
    console.log('export:', await win.textContent('[data-testid="export-done"]'), 'ffmpeg uji:', ffmpegPath());
    expect(external).toEqual([]);
  });

  // Regresi 07/10 (laptop Steven): semua proyek memakai URL proxy yang sama, cache media Chromium memutar video proyek lama
  it('Projects → import footage kedua: preview memutar footage kedua, bukan proxy proyek sebelumnya', async () => {
    await win.click('[data-testid="export-done"] button:has-text("Close")');
    await win.click('button:has-text("Projects")');
    await win.waitForSelector('[data-testid="choose"]');
    await stubOpenDialog(app, raw2);
    await win.click('[data-testid="choose"]');
    await win.waitForFunction(() => document.querySelector('[data-testid="project-name"]')?.textContent?.includes('uat-raw2'), null, { timeout: 900_000 });
    await waitVideo(win);
    const v = await previewVideo(win);
    expect(Math.abs(v.duration - rawDur2)).toBeLessThan(0.3);
    expect(Math.abs(v.duration - rawDur)).toBeGreaterThan(1);
  });

  // Regresi 07/10: proxy baru setelah ganti Grade gagal menggantikan _proxy.mp4 di Windows (file ditahan respons preview)
  it('ganti Grade: proxy baru menggantikan yang lama dan preview memuat proxy baru', async () => {
    const assets = join(work, 'projects', (await win.textContent('[data-testid="project-name"]'))!, 'assets');
    const proxy = join(assets, '_proxy.mp4');
    const before = { src: (await previewVideo(win)).src, mtime: statSync(proxy).mtimeMs };
    await win.click('.rtab:has-text("Adjust")');
    await win.click('[aria-label="Grade"] button:has-text("Lift")');
    await expect.poll(() => statSync(proxy).mtimeMs, { timeout: 120_000, interval: 250 }).not.toBe(before.mtime);
    await win.waitForSelector('text=Updating preview', { state: 'detached', timeout: 60_000 });
    expect(existsSync(join(assets, '_proxy.next.mp4'))).toBe(false);
    expect(await win.$('[data-testid="proxy-error"]')).toBeNull();
    await waitVideo(win);
    expect((await previewVideo(win)).src).not.toBe(before.src);
  });
});
