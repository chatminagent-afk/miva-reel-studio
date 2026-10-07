// Unit: komposisi overlay offline, parser progress HyperFrames, argumen ffmpeg penggabung, pembatalan proses.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/core/compose';
import { compositeArgs, encodeFramesArgs, encoderArgs, SIZES, type CompositeSpec } from '../../src/core/export';
import { hfRenderArgs, hyperframesEnv, parseHfLine, type RenderRuntime } from '../../src/core/hyperframes';
import { externalUrls, toFullTemplate, toOverlayTemplate } from '../../src/core/overlay';
import { CancelledError, runProcess } from '../../src/core/proc';
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
    expect((html.match(/@font-face/g) ?? []).length).toBe(42);
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
    expect((full.match(/@font-face/g) ?? []).length).toBe(42);
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
