// Unit: komposisi overlay offline, parser progress HyperFrames, argumen ffmpeg penggabung, pembatalan proses.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildBaseCommands } from '../../src/core/base';
import { autoCamera, renderTemplate } from '../../src/core/compose';
import { compositeArgs, encodeFramesArgs, encodeWithFallback, encoderArgs, SIZES, softwareEncoder, type CompositeSpec } from '../../src/core/export';
import { graphToFile } from '../../src/core/ffmpeg';
import { hfRenderArgs, hyperframesEnv, parseHfLine, type RenderRuntime } from '../../src/core/hyperframes';
import { externalUrls, toFullTemplate, toOverlayTemplate } from '../../src/core/overlay';
import { assertCommandFits, CancelledError, commandLineLength, runProcess, WIN_CMDLINE_MAX } from '../../src/core/proc';
import type { EditJson, Seg, TimingJson } from '../../src/core/types';
import { friendlyError } from '../../src/renderer/src/api';
import { ACUAN, renderAssets } from '../tools/project';

const { template, fontCss } = renderAssets();
const J = (f: string) => JSON.parse(readFileSync(join(ACUAN, f), 'utf-8'));
const overlayFiles = () => ({
  css: readFileSync(join(ACUAN, 'overlay.css'), 'utf-8'),
  html: readFileSync(join(ACUAN, 'overlay.html'), 'utf-8'),
  js: readFileSync(join(ACUAN, 'overlay.js'), 'utf-8'),
});

describe('komposisi overlay offline', () => {
  const tpl = toOverlayTemplate(template, fontCss);
  const html = renderTemplate(tpl, J('data.json'), overlayFiles());

  it('tanpa CDN, tanpa footage, latar transparan', () => {
    expect(html).not.toMatch(/googleapis|jsdelivr|gstatic/);
    expect(html).not.toContain('<video id="aroll"');
    expect(html).toContain('<div id="aroll"></div>');
    expect(html).toContain('<script src="assets/_vendor/gsap.min.js"></script>');
    expect(html).toContain('overflow: hidden; background: transparent; }'); // html, body dan #root
    expect(html).not.toMatch(/(html, body|#root|#bgl) \{[^}]*background: #000/);
    expect(html).toContain('.ins { position: absolute; inset: 0; overflow: hidden; background: #000; }'); // b-roll tetap menutup video
    expect(externalUrls(html)).toEqual([]);
  });

  it('font lokal di-inline sebagai @font-face (HyperFrames tidak mengunduh) dan fallback tak terbundel dibuang', () => {
    expect((html.match(/@font-face/g) ?? []).length).toBe(46); // Inter 22 + Playfair 20 + Montserrat 600/800 (4)
    expect(html).toContain('url("assets/_vendor/fonts/inter-latin-700-italic.woff2")');
    expect(html).toContain('url("assets/_vendor/fonts/playfair-display-latin-800-italic.woff2")');
    expect(html).not.toMatch(/Segoe UI|Georgia/);
  });

  it('bagian lain template tidak berubah (timeline, subtitle, kata kunci, overlay per video)', () => {
    const full = renderTemplate(template.replace(/\r\n/g, '\n'), J('data.json'), overlayFiles());
    const body = (s: string) => s.slice(s.indexOf('<div id="flash">'));
    expect(body(html)).toBe(body(full));
  });

  it('gagal keras kalau template skill berubah', () => {
    expect(() => toOverlayTemplate(template.replace('#bgl { position: absolute; inset: 0; background: #000; }', ''), fontCss)).toThrow(
      /latar #bgl/,
    );
  });

  it('render penuh (fallback whip): offline tapi footage dan latar hitam tetap', () => {
    const full = renderTemplate(toFullTemplate(template, fontCss), J('data.json'), overlayFiles());
    expect(full).not.toMatch(/googleapis|jsdelivr|Segoe UI|Georgia/);
    expect(full).toContain('<video id="aroll" class="clip" src="assets/base.mp4"');
    expect(full).toContain('html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }');
    expect((full.match(/@font-face/g) ?? []).length).toBe(46);
    expect(externalUrls(full)).toEqual([]);
  });

  it('URL internet terdeteksi', () => {
    const bad = '<img src="https://x.com/a.png"><link href="//cdn.x/y.css"><style>.a{background:url(http://z/i.png)}</style>';
    expect(externalUrls(bad)).toEqual(['https://x.com/a.png', '//cdn.x/y.css', 'http://z/i.png']);
    expect(externalUrls('<a data-x="https://ok">teks https://bukan-request</a>')).toEqual([]);
  });
});

describe('progress HyperFrames', () => {
  it('membaca persen, pesan, dan nomor frame', () => {
    expect(parseHfLine('  █████████████████░░░░░░░░  68%  Capturing frame 596/626 (3 workers)')).toEqual({
      pct: 68,
      message: 'Capturing frame 596/626 (3 workers)',
      frame: 596,
      frames: 626,
    });
    expect(parseHfLine('  █░░░░░░░░░░░░░░░░░░░░░░░░  5%  Compiling composition')).toEqual({ pct: 5, message: 'Compiling composition' });
    expect(parseHfLine('   30fps · standard · 3 workers')).toBeNull();
    expect(parseHfLine('   40.3 MB · 626 frames · rendered in 23.2s')).toBeNull();
  });

  const rt: RenderRuntime = {
    node: '/x/node',
    hyperframesCli: '/x/hf.mjs',
    offlineGuard: '/x/guard.mjs',
    browser: '/x/chrome',
    ffmpeg: '/x/ffmpeg',
    ffprobe: '/x/ffprobe',
    fontCacheDir: '/x/fonts',
  };

  it('argumen render: penjaga offline dipasang, 4K lewat --resolution', () => {
    const a = hfRenderArgs(rt, { projDir: '/p', composition: '_render.html', outDir: '/p/o', fps: 60, resolution: '4k' });
    expect(a.slice(0, 4)).toEqual(['--import', pathToFileURL('/x/guard.mjs').href, '/x/hf.mjs', 'render']); // Windows: file:///D:/x/...
    expect(a.join(' ')).toContain('--format png-sequence');
    expect(a.join(' ')).toContain('--fps 60');
    expect(a.join(' ')).toContain('--resolution portrait-4k');
    expect(hfRenderArgs(rt, { projDir: '/p', composition: 'c', outDir: 'o', fps: 30 })).not.toContain('--resolution');
  });

  it('env: telemetry/update mati, binary dan cache font lokal', () => {
    const env = hyperframesEnv(rt, {});
    expect(env).toMatchObject({
      HYPERFRAMES_NO_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
      HYPERFRAMES_NO_UPDATE_CHECK: '1',
      HYPERFRAMES_NO_AUTO_INSTALL: '1',
      HYPERFRAMES_BROWSER_PATH: '/x/chrome',
      HYPERFRAMES_FFMPEG_PATH: '/x/ffmpeg',
      HYPERFRAMES_FONT_CACHE_DIR: '/x/fonts',
    });
  });
});

describe('penggabung ffmpeg', () => {
  const spec = (over: Partial<CompositeSpec>): CompositeSpec => ({
    base: 'b.mp4',
    frames: 'f/frame_%06d.png',
    framesSize: SIZES['1080p'],
    audio: 'm.wav',
    output: 'o.mp4',
    size: SIZES['1080p'],
    fps: 30,
    duration: 20.856,
    camera: J('data.json').camera,
    origin: '50% 38%',
    encoder: 'libx264',
    ...over,
  });
  const graph = (a: string[]) => a[a.indexOf('-filter_complex') + 1];

  it('1080p: kamera di resolusi asli, tanpa skala, blending RGB', () => {
    const a = compositeArgs(spec({}));
    const g = graph(a);
    expect(g).toMatch(/^\[0:v\]fps=30,perspective=/);
    expect(g).toContain('((in-1)/30)');
    expect(g).not.toContain('scale=');
    expect(g).toContain('overlay=format=gbrp');
    expect(a).toEqual(expect.arrayContaining(['-framerate', '30', '-t', '20.856', '-map', '2:a']));
    expect(a.slice(a.indexOf('-c:v'), a.indexOf('-c:v') + 6)).toEqual(['-c:v', 'libx264', '-preset', 'slow', '-crf', '18']);
  });

  it('2K: overlay dirender 4K lalu diturunkan, video dinaikkan', () => {
    const g = graph(compositeArgs(spec({ size: SIZES['2k'], framesSize: SIZES['4k'], fps: 60 })));
    expect(g).toContain('fps=60,perspective=');
    expect(g).toContain('((in-1)/60)');
    expect(g).toContain(',scale=1440:2560:flags=lanczos,format=gbrp[bg]');
    expect(g).toContain('[1:v]scale=1440:2560:flags=lanczos,format=gbrap[ov]');
  });

  it('4K: overlay sudah 4K, hanya video yang diskalakan', () => {
    const g = graph(compositeArgs(spec({ size: SIZES['4k'], framesSize: SIZES['4k'] })));
    expect(g).toContain(',scale=2160:3840:flags=lanczos,format=gbrp[bg]');
    expect(g).toContain('[1:v]format=gbrap[ov]');
  });

  it('render penuh: frame + audio, 2K diturunkan dari 4K', () => {
    const a = encodeFramesArgs({ frames: 'f/frame_%06d.png', framesSize: SIZES['4k'], audio: 'm.wav', output: 'o.mp4', size: SIZES['2k'], fps: 60, duration: 3, encoder: 'libx264' });
    expect(graph(a)).toBe('[0:v]scale=1440:2560:flags=lanczos,format=yuv420p[v]');
    expect(a).toEqual(expect.arrayContaining(['-framerate', '60', '-map', '1:a', '-t', '3.000']));
    const b = encodeFramesArgs({ frames: 'f', framesSize: SIZES['1080p'], audio: 'm', output: 'o', size: SIZES['1080p'], fps: 30, duration: 3, encoder: 'libx264' });
    expect(graph(b)).toBe('[0:v]format=yuv420p[v]');
  });

  it('encoder: NVENC dan software, HEVC diberi tag hvc1', () => {
    expect(encoderArgs('hevc_nvenc')).toContain('hvc1');
    expect(encoderArgs('libx265')).toContain('hvc1');
    expect(encoderArgs('h264_nvenc')).toEqual(expect.arrayContaining(['-c:v', 'h264_nvenc', '-cq', '19']));
    expect(() => encoderArgs('x')).toThrow();
  });
});

// Regresi spawn ENAMETOOLONG (Windows, 08/10): graf kamera ±1,4 KB per langkah, graf base ±161 karakter per potongan,
// keduanya inline di argumen -> lewat 32.767 karakter. Sekarang graf lewat file (-/filter_complex <file>, ffmpeg >= 7).
describe('graf filter lewat file (batas baris perintah Windows)', () => {
  const LIMIT = 32_766;
  const tmp = mkdtempSync(join(tmpdir(), 'reel-graph-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const graphOf = (a: string[]) => a[a.indexOf('-filter_complex') + 1];

  /** Reel 60 dtk dengan 30 potongan dan kamera otomatis penuh. */
  const longSpec = (): CompositeSpec => {
    const T: TimingJson = { duration: 60, speed: 1.25, cuts: Array.from({ length: 30 }, (_, i) => +(((i + 1) * 60) / 31).toFixed(3)), words: [] };
    const camera = autoCamera(T, [], { src: 'x', segs: [] });
    return {
      base: 'D:\\proyek\\assets\\base.mp4',
      frames: 'D:\\proyek\\renders\\_frames\\frame_%06d.png',
      framesSize: SIZES['1080p'],
      audio: 'D:\\proyek\\renders\\_mix.wav',
      output: 'D:\\hasil\\reel.mp4',
      size: SIZES['1080p'],
      fps: 30,
      duration: 60,
      camera,
      origin: '50% 40%',
      encoder: 'libx264',
    };
  };

  it('graphToFile: graf keluar dari argumen, isi file = graf, opsi -/filter_complex', async () => {
    const g = '[0:v]fps=30,format=gbrp[bg];[bg]format=yuv420p[v]';
    const file = join(tmp, 'g1.txt');
    const out = await graphToFile(['-v', 'error', '-i', 'a.mp4', '-filter_complex', g, '-map', '[v]', 'o.mp4'], file);
    expect(out).toEqual(['-v', 'error', '-i', 'a.mp4', '-/filter_complex', file, '-map', '[v]', 'o.mp4']);
    expect(out).not.toContain(g);
    expect(readFileSync(file, 'utf-8')).toBe(g);
  });

  it('graphToFile: graf berkutip/non-ASCII utuh, -vf/-af juga dipindah, tanpa opsi graf tidak berubah', async () => {
    const g = "[0:v]perspective=x0='if(gte(T,1),2,3)':sense=source,drawtext=text='Kopi \u2615'[v]";
    const f1 = join(tmp, 'g2.txt');
    expect(await graphToFile(['-i', 'a', '-vf', g, 'o'], f1)).toEqual(['-i', 'a', '-/vf', f1, 'o']);
    expect(readFileSync(f1, 'utf-8')).toBe(g);
    const f2 = join(tmp, 'g3.txt');
    expect(await graphToFile(['-i', 'a', '-af', 'volume=2', 'o'], f2)).toEqual(['-i', 'a', '-/af', f2, 'o']);
    const none = ['-i', 'a', '-c:v', 'copy', 'o'];
    const f3 = join(tmp, 'g4.txt');
    expect(await graphToFile(none, f3)).toBe(none);
    expect(existsSync(f3)).toBe(false);
    await expect(graphToFile(['-vf', 'a', '-af', 'b'], join(tmp, 'g5.txt'))).rejects.toThrow(/hanya satu opsi graf/);
  });

  it('composite reel 60 dtk, 30 potongan: inline > 32.766 karakter, lewat file < 4.000', async () => {
    const inline = compositeArgs(longSpec());
    expect(graphOf(inline).length).toBeGreaterThan(LIMIT); // grafnya sendiri sudah melewati batas
    expect(commandLineLength('ffmpeg.exe', inline)).toBeGreaterThan(LIMIT);
    expect(() => assertCommandFits('ffmpeg.exe', inline, 'win32')).toThrow(/terlalu panjang untuk Windows \(\d+ karakter/);

    const file = join(tmp, 'composite.txt');
    const viaFile = await graphToFile(inline, file);
    expect(commandLineLength('ffmpeg.exe', viaFile)).toBeLessThan(4000);
    expect(() => assertCommandFits('ffmpeg.exe', viaFile, 'win32')).not.toThrow();
    expect(readFileSync(file, 'utf-8')).toBe(graphOf(inline));
    expect(viaFile).not.toContain('-filter_complex');
  });

  it('build base 250 potongan: inline > 32.766 karakter, lewat file < 4.000', async () => {
    const segs: Seg[] = Array.from({ length: 250 }, (_, i) => [i * 2 + 0.123, i * 2 + 1.789]);
    const edit: EditJson = { src: 'D:\\footage\\mentah.mp4', segs };
    const [encode] = buildBaseCommands(edit, 'D:\\proyek');
    const inline = ['-v', 'error', '-y', '-nostats', '-progress', 'pipe:1', ...encode];
    expect(commandLineLength('ffmpeg.exe', inline)).toBeGreaterThan(LIMIT);
    expect(() => assertCommandFits('ffmpeg.exe', inline, 'win32')).toThrow(/terlalu panjang untuk Windows/);

    const file = join(tmp, 'base.txt');
    const viaFile = await graphToFile(inline, file);
    expect(commandLineLength('ffmpeg.exe', viaFile)).toBeLessThan(4000);
    expect(readFileSync(file, 'utf-8')).toBe(inline[inline.indexOf('-filter_complex') + 1]);
  });

  it('runProcess: pesan jelas (bukan ENAMETOOLONG) kalau baris perintah kepanjangan di Windows', async () => {
    expect(WIN_CMDLINE_MAX).toBeLessThan(32_767);
    expect(() => assertCommandFits('ffmpeg.exe', ['x'.repeat(WIN_CMDLINE_MAX)], 'linux')).not.toThrow(); // POSIX: batasnya jauh lebih besar
    expect(() => assertCommandFits('C:\\bin\\ffmpeg.exe', ['x'.repeat(WIN_CMDLINE_MAX)], 'win32')).toThrow(/^Perintah ffmpeg\.exe terlalu panjang untuk Windows \(3\d{4} karakter, batas 32000\)/);
    if (process.platform === 'win32') await expect(runProcess('ffmpeg.exe', ['x'.repeat(WIN_CMDLINE_MAX)])).rejects.toThrow(/terlalu panjang untuk Windows/);
  });

  it('friendlyError: pesan batas baris perintah tampil sebagai kalimat yang bisa dipahami', () => {
    const msg = 'Perintah ffmpeg.exe terlalu panjang untuk Windows (33855 karakter, batas 32000): proyek ini terlalu kompleks untuk satu perintah. Laporkan sebagai bug.';
    expect(friendlyError(msg)).toMatch(/too complex for a single FFmpeg command \(33855 characters/);
    expect(friendlyError('spawn ENAMETOOLONG')).toMatch(/too complex for a single FFmpeg command/);
    expect(friendlyError('assets/base.mp4 belum ada (jalankan Auto Edit dulu)')).toBe('Run Auto Edit first.'); // pemetaan lama tetap
    expect(friendlyError('lain-lain')).toBe('lain-lain');
  });

  // ffmpeg nyata: `-/opsi <file>` baru ada di ffmpeg 7.0. Lewati kalau ffmpeg tidak ada / lebih lama.
  const FFMPEG = process.env.REEL_FFMPEG || 'ffmpeg';
  const ver = spawnSync(FFMPEG, ['-version'], { encoding: 'utf-8' });
  const found = !ver.error && ver.status === 0;
  const major = found ? /ffmpeg version n?(\d+)\./i.exec(ver.stdout)?.[1] : undefined;
  const ffOk = found && (major === undefined || Number(major) >= 7); // tanpa nomor (build git N-xxxx) dianggap baru

  it.skipIf(!ffOk)('ffmpeg nyata: -/filter_complex dan -/vf dibaca dari file (ukuran PNG keluaran membuktikan)', async () => {
    const png = (flagArgs: string[], name: string) => {
      const out = join(tmp, name);
      const r = spawnSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=128x128:r=10:d=1', ...flagArgs, '-frames:v', '1', out], { encoding: 'utf-8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      const b = readFileSync(out); // IHDR: lebar di byte 16, tinggi di byte 20
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    const fc = await graphToFile(['-filter_complex', '[0:v]scale=64:48[v]', '-map', '[v]'], join(tmp, 'smoke-fc.txt'));
    expect(fc[0]).toBe('-/filter_complex');
    expect(png(fc, 'fc.png')).toEqual([64, 48]);
    const vf = await graphToFile(['-vf', 'scale=32:24'], join(tmp, 'smoke-vf.txt'));
    expect(png(vf, 'vf.png')).toEqual([32, 24]);
  });

  it.skipIf(!ffOk)('ffmpeg nyata: graf kamera 60 dtk (puluhan KB) diterima lewat file', async () => {
    const g = graphOf(compositeArgs(longSpec()));
    expect(g.length).toBeGreaterThan(LIMIT);
    const args = await graphToFile(
      [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=gray:s=1080x1920:r=30:d=2',
        '-f', 'lavfi', '-i', 'color=c=black@0:s=1080x1920:r=30:d=2,format=rgba',
        '-filter_complex', g, '-map', '[v]', '-t', '1', '-f', 'null', '-',
      ],
      join(tmp, 'smoke-long.txt'),
    );
    expect(commandLineLength(FFMPEG, args)).toBeLessThan(4000);
    const r = spawnSync(FFMPEG, args, { encoding: 'utf-8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe.skipIf(process.platform === 'win32')('pembatalan proses', () => {
  it('membunuh proses beserta turunannya', async () => {
    // durasi unik supaya pgrep tidak tertukar dengan proses lain
    const a = 3000 + (process.pid % 500);
    const b = a + 1;
    const ac = new AbortController();
    const p = runProcess('sh', ['-c', `sleep ${a} & sleep ${b}; wait`], { signal: ac.signal });
    const alive = () => spawnSync('pgrep', ['-f', `^sleep (${a}|${b})$`], { encoding: 'utf-8' }).stdout.trim().split('\n').filter(Boolean);
    // tunggu kedua anak benar-benar jalan (di bawah beban CPU shell bisa lambat start)
    for (let i = 0; i < 100 && alive().length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect(alive().length).toBe(2);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    for (let i = 0; i < 60 && alive().length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(alive()).toEqual([]);
  });

  it('error berisi baris terakhir output', async () => {
    await expect(runProcess('sh', ['-c', 'echo satu; echo dua >&2; exit 3'])).rejects.toMatchObject({ code: 3, tail: 'satu\ndua' });
  });
});

describe('fallback encoder GPU ke CPU', () => {
  it('pasangan encoder CPU', () => {
    expect(softwareEncoder('h264_nvenc')).toBe('libx264');
    expect(softwareEncoder('hevc_nvenc')).toBe('libx265');
    expect(softwareEncoder('libx264')).toBeNull();
  });

  it('NVENC gagal di tengah export: diulang sekali dengan libx264', async () => {
    const tried: string[] = [];
    const fell: string[] = [];
    const used = await encodeWithFallback(
      'h264_nvenc',
      async (enc) => {
        tried.push(enc);
        if (enc === 'h264_nvenc') throw new Error('No CUDA-capable device is detected');
      },
      (from, to) => fell.push(`${from}>${to}`),
    );
    expect(used).toBe('libx264');
    expect(tried).toEqual(['h264_nvenc', 'libx264']);
    expect(fell).toEqual(['h264_nvenc>libx264']);
  });

  it('dibatalkan atau sudah CPU: tidak diulang', async () => {
    const tried: string[] = [];
    const cancel = async (enc: string) => {
      tried.push(enc);
      throw new CancelledError();
    };
    await expect(encodeWithFallback('hevc_nvenc', cancel)).rejects.toBeInstanceOf(CancelledError);
    await expect(encodeWithFallback('libx264', async () => Promise.reject(new Error('disk penuh')))).rejects.toThrow('disk penuh');
    expect(tried).toEqual(['hevc_nvenc']);
  });
});
