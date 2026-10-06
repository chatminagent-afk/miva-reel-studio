// Integrasi export cepat end-to-end: HyperFrames (Chrome headless dibundel) + ffmpeg, data nyata acuan tes2,
// footage & SFX sintetis. Butuh `npm run fetch-resources` (Chrome); dilewati kalau Chrome belum diunduh.
// Bukti offline penuh: `npm run test:offline` menjalankan file ini di network namespace tanpa internet.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { layoutCaptions } from '../../src/core/compose';
import { exportReel, type ExportOptions, type ExportProgress } from '../../src/core/export';
import { CancelledError } from '../../src/core/proc';
import { ACUAN, BROWSER, hasBrowser, makeAcuanProject, makeSfxLib, renderAssets, testRuntime } from '../tools/project';

const probe = (file: string) =>
  JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,codec_tag_string,width,height,r_frame_rate', '-of', 'json', file], {
      encoding: 'utf-8',
    }),
  );

/** Piksel RGB satu frame output pada waktu t (diturunkan ke 1080×1920 supaya koordinat sama). */
function frameAt(file: string, t: number): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=1080:1920', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    maxBuffer: 64 << 20,
  });
}

/** Jumlah piksel warna kata kunci (emas #ffd65a) di area kata kunci. */
function goldPixels(rgb: Buffer): number {
  let n = 0;
  for (let y = 1000; y < 1500; y++)
    for (let x = 0; x < 1080; x++) {
      const i = (y * 1080 + x) * 3;
      if (Math.abs(rgb[i] - 0xff) < 30 && Math.abs(rgb[i + 1] - 0xd6) < 30 && Math.abs(rgb[i + 2] - 0x5a) < 40) n++;
    }
  return n;
}

const chromeLeft = () => spawnSync('pgrep', ['-f', BROWSER], { encoding: 'utf-8' }).stdout.trim();

describe.skipIf(!hasBrowser)('export cepat (integrasi)', { timeout: 600_000 }, () => {
  let work: string;
  let base: Omit<ExportOptions, 'projDir' | 'output' | 'resolution' | 'fps' | 'codec'>;

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'reel-export-'));
    base = { runtime: testRuntime(join(work, 'fontcache')), sfx: await makeSfxLib(join(work, 'sfx')), ...renderAssets() };
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('1080p 30 fps H.264: durasi, ukuran, audio, overlay tampil, offline, folder bersih', async () => {
    const proj = join(work, 'p1080');
    const dur = await makeAcuanProject(proj);
    const out = join(work, 'out', 'tes2-1080.mp4');
    const prog: ExportProgress[] = [];
    const r = await exportReel({ ...base, projDir: proj, output: out, resolution: '1080p', fps: 30, codec: 'h264', encoder: 'libx264', onProgress: (p) => prog.push(p) });

    const p = probe(out);
    const v = p.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect([v.codec_name, v.width, v.height, v.r_frame_rate]).toEqual(['h264', 1080, 1920, '30/1']);
    expect(p.streams.find((s: { codec_type: string }) => s.codec_type === 'audio').codec_name).toBe('aac');
    expect(Math.abs(Number(p.format.duration) - dur)).toBeLessThan(0.05);
    expect(r.blocked).toEqual([]);
    expect(r.mode).toBe('fast');

    // progress naik terus sampai 1, urutan tahap benar
    prog.forEach((x, i) => i && expect(x.progress).toBeGreaterThanOrEqual(prog[i - 1].progress));
    expect(prog.at(-1)).toMatchObject({ stage: 'done', progress: 1 });
    expect([...new Set(prog.map((x) => x.stage))]).toEqual(['prepare', 'overlay', 'mix', 'composite', 'done']);

    // kata kunci tampil (emas) di output saat ditahan penuh (sesudah slam 0,24 dtk, sebelum fade 0,14 dtk),
    // dan tidak ada sebelum muncul. Dipilih kata kunci dengan waktu tahan terpanjang.
    const T = JSON.parse(readFileSync(join(ACUAN, 'timing.json'), 'utf-8'));
    const keys = layoutCaptions(T, JSON.parse(readFileSync(join(ACUAN, 'captions.json'), 'utf-8'))).keys;
    const hold = (x: (typeof keys)[0]) => x.e - 0.14 - (x.hit + 0.2);
    const k = keys.reduce((a, b) => (hold(b) > hold(a) ? b : a));
    expect(goldPixels(frameAt(out, (k.hit + 0.2 + k.e - 0.14) / 2))).toBeGreaterThan(3000);
    expect(goldPixels(frameAt(out, Math.max(0, k.s - 0.3)))).toBeLessThan(200);

    // cues.json ditulis (skill bisa melanjutkan) dan sama dengan acuan; file sementara dibersihkan
    expect(JSON.parse(readFileSync(join(proj, 'cues.json'), 'utf-8'))).toEqual(JSON.parse(readFileSync(join(ACUAN, 'cues.json'), 'utf-8')));
    for (const f of ['renders/_frames', '_render.html', 'assets/_vendor']) expect(existsSync(join(proj, f))).toBe(false);
    expect(chromeLeft()).toBe('');
  });

  it('2K 60 fps HEVC: overlay 4K diturunkan ke 1440×2560', async () => {
    const proj = join(work, 'p2k');
    const dur = await makeAcuanProject(proj, { seconds: 3 });
    const out = join(work, 'out', 'tes2-2k.mp4');
    const r = await exportReel({ ...base, projDir: proj, output: out, resolution: '2k', fps: 60, codec: 'hevc', encoder: 'libx265' });
    const v = probe(out).streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect([v.codec_name, v.codec_tag_string, v.width, v.height, v.r_frame_rate]).toEqual(['hevc', 'hvc1', 1440, 2560, '60/1']);
    expect(Math.abs(r.duration - dur)).toBeLessThan(0.001);
  });

  it('4K 30 fps H.264: 2160×3840', async () => {
    const proj = join(work, 'p4k');
    await makeAcuanProject(proj, { seconds: 3 });
    const out = join(work, 'out', 'tes2-4k.mp4');
    await exportReel({ ...base, projDir: proj, output: out, resolution: '4k', fps: 30, codec: 'h264', encoder: 'libx264' });
    const v = probe(out).streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect([v.width, v.height, v.r_frame_rate]).toEqual([2160, 3840, '30/1']);
  });

  it('proyek dengan whip: otomatis render penuh (kamera + blur di Chrome)', async () => {
    const proj = join(work, 'pwhip');
    const dur = await makeAcuanProject(proj, { seconds: 3 });
    const edit = JSON.parse(readFileSync(join(proj, 'edit.json'), 'utf-8'));
    writeFileSync(join(proj, 'edit.json'), JSON.stringify({ ...edit, whip: [1] }));
    const out = join(work, 'out', 'whip.mp4');
    const r = await exportReel({ ...base, projDir: proj, output: out, resolution: '1080p', fps: 30, codec: 'h264', encoder: 'libx264' });
    expect(r.mode).toBe('full');
    const p = probe(out);
    const v = p.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect([v.width, v.height, v.r_frame_rate]).toEqual([1080, 1920, '30/1']);
    expect(Math.abs(Number(p.format.duration) - dur)).toBeLessThan(0.05);
    expect(r.blocked).toEqual([]);
    for (const f of ['renders/_frames', '_render.html', 'assets/_vendor']) expect(existsSync(join(proj, f))).toBe(false);
  });

  it('batal saat render grafik: Chrome & ffmpeg berhenti, output dan file sementara dihapus', async () => {
    const proj = join(work, 'pcancel');
    await makeAcuanProject(proj);
    const out = join(work, 'out', 'batal.mp4');
    const ac = new AbortController();
    let sawCapture = false;
    const run = exportReel({
      ...base,
      projDir: proj,
      output: out,
      resolution: '1080p',
      fps: 30,
      codec: 'h264',
      encoder: 'libx264',
      signal: ac.signal,
      onProgress: (p) => {
        if (p.stage === 'overlay' && /frame \d+/.test(p.message) && !sawCapture) {
          sawCapture = true;
          ac.abort();
        }
      },
    });
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(sawCapture).toBe(true);
    for (const f of ['renders/_frames', '_render.html', 'assets/_vendor']) expect(existsSync(join(proj, f))).toBe(false);
    expect(existsSync(out)).toBe(false);
    await new Promise((r) => setTimeout(r, 1500));
    expect(chromeLeft()).toBe('');
  });
});
