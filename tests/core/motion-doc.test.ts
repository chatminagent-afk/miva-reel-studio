// Integrasi motion ke dokumen proyek: jangkar waktu, penggabungan overlay, SFX motion di cues, blur adegan (FFmpeg + preview).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCompositionData, buildCues, layoutCaptions } from '../../src/core/compose';
import { derive, type ProjectState } from '../../src/core/doc';
import { compositeArgs, SIZES, sceneBlurFilters, type CompositeSpec } from '../../src/core/export';
import { anchorTime, buildWordTimes, resolveMotion } from '../../src/core/motion/resolve';
import type { MotionItem, MotionSfx } from '../../src/core/motion/types';
import { anchorAt, mergeOverlay, motionOverlayFor, SCENE_BLUR_PX, sceneBlurAt, sceneBlurJs } from '../../src/core/motionDoc';
import { applySfxOff } from '../../src/core/sfxedit';
import { mapTiming } from '../../src/core/timing';
import type { EditJson, RawWord, Seg, SfxCatalog, SfxFeature } from '../../src/core/types';

const FIX = join(__dirname, '..', 'fixtures');
const J = <T>(...p: string[]): T => JSON.parse(readFileSync(join(FIX, ...p), 'utf-8')) as T;
const words3 = J<RawWord[]>('briefs', 'miva-3.words-raw.json');
const edit3 = J<EditJson>('briefs', 'miva-3.edit.json'); // 12 potongan, speed 1.25, tail 2.6

const stmt = (id: string, start: MotionItem['start'], over: Partial<MotionItem> = {}): MotionItem =>
  ({ id, kind: 'statement', start, props: { line2: 'Halo', style: 'pill' }, ...over }) as MotionItem;

describe('anchorAt: detik hasil edit -> jangkar kata -> detik yang sama', () => {
  const check = (words: RawWord[], segs: Seg[], speed: number, tail: number) => {
    const body = segs.reduce((a, [x, y]) => a + (y - x), 0) / speed;
    const wt = buildWordTimes(words, segs, speed);
    const dur = body + tail;
    const n = 400;
    for (let i = 0; i <= n; i++) {
      const t = (dur * i) / n;
      const a = anchorAt(t, words, segs, speed);
      expect(Math.abs(anchorTime(a, wt) - t), `t=${t}`).toBeLessThanOrEqual(0.001);
      // lewat resolveMotion juga kembali ke t (kecuali 0,5 dtk terakhir: item pendek digeser mundur supaya muat sebelum akhir)
      if (t <= dur - 0.5) {
        const back = resolveMotion([stmt('x', a, { dur: 0.5 })], words, segs, speed, dur)[0].t0;
        expect(Math.abs(back - t), `t=${t}`).toBeLessThanOrEqual(0.001);
      }
    }
  };

  it('miva-3 (speed 1,25, 12 potongan) termasuk di ekor sesudah kata terakhir', () => check(words3, edit3.segs, 1.25, 2.6));

  it('kata dipotong: tetap kembali ke t yang sama', () => {
    const segs: Seg[] = [edit3.segs[0], edit3.segs[2], edit3.segs[5], edit3.segs[8]];
    const wt = buildWordTimes(words3, segs, 1.25);
    expect(wt.s.some((x) => x === null)).toBe(true); // ada kata yang terbuang
    check(words3, segs, 1.25, 2.5);
  });

  it('speed 1 dan 1,25 sama-sama dijamin', () => {
    check(words3, edit3.segs, 1, 0);
    check(words3, edit3.segs, 1.25, 0);
  });

  it('memilih kata terpakai terdekat; t negatif dijepit ke 0; tanpa kata terpakai', () => {
    const a = anchorAt(5.0, words3, edit3.segs, 1.25);
    const wt = buildWordTimes(words3, edit3.segs, 1.25);
    const dists = wt.s.map((s) => (s === null ? Infinity : Math.abs(s - 5.0)));
    expect(a.word).toBe(dists.indexOf(Math.min(...dists)));
    expect(a.edge).toBe('s');
    expect(anchorAt(-3, words3, edit3.segs, 1.25).off).toBeGreaterThanOrEqual(-0.5);
    expect(anchorTime(anchorAt(-3, words3, edit3.segs, 1.25), wt)).toBeCloseTo(0, 2);
    const none = anchorAt(2.2, words3, [], 1.25);
    expect(anchorTime(none, buildWordTimes(words3, [], 1.25))).toBeCloseTo(2.2, 3);
  });
});

describe('motionOverlayFor / mergeOverlay', () => {
  const state = (motion?: MotionItem[]) => ({ words: words3, motion }) as Pick<ProjectState, 'words' | 'motion'>;
  const { timing } = mapTiming(edit3, words3);

  it('tanpa motion: overlay kosong dan overlay.* skill dikembalikan persis', () => {
    const r = motionOverlayFor(edit3, state(), timing);
    expect(r.resolved).toEqual([]);
    expect(r.overlay).toEqual({ html: '', css: '', js: '', sfx: [], scenes: [] });
    const hand = { css: '.a{}', html: '<div id="x"></div>', js: 'tl.set("#x",{x:1},0);' };
    expect(mergeOverlay(r.overlay, hand)).toEqual(hand);
    expect(mergeOverlay(r.overlay, {})).toEqual({ css: undefined, html: undefined, js: undefined });
  });

  it('item motion jadi overlay; duration = timing.duration (sudah termasuk tail) membatasi item di ekor', () => {
    const last = words3.length - 1;
    const items = [
      stmt('awal', { word: 0, edge: 's', off: -0.05 }, { dur: 2 }),
      stmt('ekor', { word: last, edge: 'e', off: 0.2 }, { dur: 2.4, scene: true }),
    ];
    const r = motionOverlayFor(edit3, state(items), timing);
    expect(r.resolved.map((x) => x.id)).toEqual(['awal', 'ekor']);
    expect(r.resolved[1].t0).toBeGreaterThan(timing.duration - 2.6 - 0.01); // jatuh di ekor
    expect(r.resolved[1].t1).toBeLessThanOrEqual(timing.duration + 1e-9);
    expect(r.overlay.html).toContain('mv-');
    expect(r.overlay.js.startsWith('(() =>')).toBe(true);
    expect(r.overlay.scenes).toHaveLength(1);
    expect(r.errors).toEqual([]);
  });

  it('urutan gabungan: motion dulu, overlay.* tulisan tangan sesudahnya (css/html/js)', () => {
    const m = { css: '.m{}', html: '<i id="m"></i>', js: '(() => {})();' };
    const h = { css: '.h{}', html: '<b id="h"></b>', js: 'tl.to("#h",{x:1},0);' };
    const r = mergeOverlay(m, h);
    for (const k of ['css', 'html', 'js'] as const) {
      expect(r[k]!.indexOf(m[k])).toBe(0);
      expect(r[k]!.indexOf(h[k])).toBeGreaterThan(m[k].length - 1);
    }
    expect(mergeOverlay(m, {})).toEqual(m);
    expect(mergeOverlay({ css: '', html: '', js: '' }, { css: ' ' })).toEqual({ css: ' ', html: undefined, js: undefined });
  });

  it('komposisi penuh: overlay motion + skill sama-sama ada di HTML akhir, tanpa URL luar', async () => {
    const { renderTemplate } = await import('../../src/core/compose');
    const { toOverlayTemplate, externalUrls } = await import('../../src/core/overlay');
    const { renderAssets, ACUAN } = await import('../tools/project');
    const { template, fontCss } = renderAssets();
    const data = J<never>('acuan-tes2', 'data.json');
    const hand = {
      css: readFileSync(join(ACUAN, 'overlay.css'), 'utf-8'),
      html: readFileSync(join(ACUAN, 'overlay.html'), 'utf-8'),
      js: readFileSync(join(ACUAN, 'overlay.js'), 'utf-8'),
    };
    const mo = motionOverlayFor(edit3, state([stmt('a', { word: 3, edge: 's' }, { dur: 2, scene: true })]), timing);
    const html = renderTemplate(toOverlayTemplate(template, fontCss), data, mergeOverlay(mo.overlay, hand));
    expect(html).toContain('id="mv-scrim"');
    expect(html.indexOf('mv-scrim')).toBeLessThan(html.indexOf(hand.html.trim().slice(0, 40)));
    expect(html).toContain(hand.js.trim().slice(0, 40));
    expect(externalUrls(html)).toEqual([]);
  });
});

describe('SFX motion di buildCues (preview = export)', () => {
  const lib = { features: J<Record<string, SfxFeature>>('sfxlib', '_fitur.json'), catalog: J<SfxCatalog>('sfxlib', 'catalog.json') };
  const A = join(FIX, 'acuan-tes2');
  const T = JSON.parse(readFileSync(join(A, 'timing.json'), 'utf-8'));
  const C = JSON.parse(readFileSync(join(A, 'captions.json'), 'utf-8'));
  const E = JSON.parse(readFileSync(join(A, 'edit.json'), 'utf-8')) as EditJson;
  const { caps, keys } = layoutCaptions(T, C);

  it('tanpa SFX motion: hasil identik dengan sebelumnya', () => {
    expect(buildCues(T, caps, keys, E, lib, []).cues).toEqual(buildCues(T, caps, keys, E, lib).cues);
  });

  it('cue motion: prio 3, ditandai m:1, align sejajarkan puncak, dur dan gain_db dihormati', () => {
    const base = buildCues(T, caps, keys, E, lib).cues;
    const motion: MotionSfx[] = [
      { t: 10.0, kat: 'whoosh', align: true, gain_db: -3 },
      { t: 11.0, kat: 'ketik', dur: 0.8 },
      { t: 12.0, kat: 'pop' },
      { t: 13.0, kat: 'tidak-ada-di-pustaka' },
    ];
    const out = buildCues(T, caps, keys, E, lib, motion).cues;
    const mine = out.sfx.filter((c) => c.m === 1);
    expect(mine.map((c) => c.kat)).toEqual(['whoosh', 'ketik', 'pop']); // kategori tak dikenal dilewati
    expect(mine.every((c) => c.prio === 3)).toBe(true);
    const wh = mine[0];
    const f = lib.features[wh.id];
    expect(wh.t).toBeCloseTo(10.0 - f.peak_at * f.dur, 3); // puncak jatuh di t
    expect(wh.gain_db).toBe(-3);
    expect(mine[1].dur).toBe(0.8);
    expect(mine[2].dur).toBeNull();
    // pilihan bunyi SFX otomatis tidak bergeser oleh SFX motion (ditambahkan paling akhir)
    const strip = (cs: typeof out.sfx) => cs.filter((c) => c.m !== 1).map((c) => `${c.t}|${c.id}`);
    const near = (t: number) => out.sfx.some((c) => c.m !== 1 && c.prio === 1 && Math.abs(c.t - t) < 0.3);
    expect(near(10) || near(11) || near(12)).toBe(false); // klik/ketik otomatis mengalah ke bunyi motion (aturan kepadatan)
    for (const s of strip(out.sfx)) expect(strip(base.sfx)).toContain(s);
  });

  it('sfx_off tidak membisukan SFX motion; SFX otomatis tetap bisa dibisukan', () => {
    const motion: MotionSfx[] = [{ t: 12.0, kat: 'pop' }];
    const full = buildCues(T, caps, keys, E, lib, motion).cues;
    const auto = full.sfx.find((c) => c.m !== 1)!;
    const edit = { ...E, sfx_off: [{ kat: 'pop', t: 12.0 }, { kat: auto.kat, t: auto.t }] } as EditJson;
    const after = applySfxOff(full, edit);
    expect(after.sfx.some((c) => c.m === 1 && c.kat === 'pop')).toBe(true);
    expect(after.sfx.some((c) => c.m !== 1 && c.kat === auto.kat && c.t === auto.t)).toBe(false);
  });

  it('derive + buildCompositionData tetap jalan dengan tail (durasi ikut bertambah)', () => {
    const doc = { edit: { ...edit3, tail: 2.6 }, state: { words: words3, keywords: [] } as unknown as ProjectState };
    const d1 = derive(doc);
    const d0 = derive({ ...doc, edit: { ...edit3, tail: 0 } });
    expect(d1.timing.duration).toBeCloseTo(d0.timing.duration + 2.6, 3);
    expect(buildCompositionData(d1.timing, d1.captions, doc.edit).duration).toBe(d1.timing.duration);
  });
});

describe('blur adegan', () => {
  it('sceneBlurAt: rampa 0,3 dtk masuk/keluar, penuh di tengah, 0 di luar; adegan pendek dijepit setengah', () => {
    const sc = [{ s: 2, e: 6 }];
    expect(sceneBlurAt(sc, 1.99)).toBe(0);
    expect(sceneBlurAt(sc, 2)).toBe(0);
    expect(sceneBlurAt(sc, 2.15)).toBeCloseTo(0.5, 6);
    expect(sceneBlurAt(sc, 2.3)).toBeCloseTo(1, 9);
    expect(sceneBlurAt(sc, 4)).toBe(1);
    expect(sceneBlurAt(sc, 5.85)).toBeCloseTo(0.5, 6);
    expect(sceneBlurAt(sc, 6.01)).toBe(0);
    expect(sceneBlurAt([{ s: 0, e: 0.4 }], 0.2)).toBe(1); // d = 0,2: puncak tepat di tengah
    expect(sceneBlurAt([{ s: 0, e: 0.4 }], 0.1)).toBeCloseTo(0.5, 6);
    expect(sceneBlurAt([], 3)).toBe(0);
  });

  it('sceneBlurJs: rampa di #aroll untuk render penuh (whip)', () => {
    expect(sceneBlurJs([])).toBe('');
    const js = sceneBlurJs([{ s: 2, e: 6 }]);
    expect(js).toContain(`blur(${SCENE_BLUR_PX}px)`);
    expect(js).toContain('tl.fromTo("#aroll"');
    expect(js).toContain('duration: 0.3');
    expect(js).toMatch(/, 5\.7\);$/m); // keluar mulai e - 0,3
    expect(js).not.toContain(String.fromCharCode(0x2014)); // tanpa em dash
  });
});

describe('compositeArgs dengan adegan', () => {
  const camera = J<{ camera: never }>('acuan-tes2', 'data.json').camera;
  const spec = (over: Partial<CompositeSpec> = {}): CompositeSpec => ({
    base: 'b.mp4',
    frames: 'f/frame_%06d.png',
    framesSize: SIZES['1080p'],
    audio: 'm.wav',
    output: 'o.mp4',
    size: SIZES['1080p'],
    fps: 30,
    duration: 20.856,
    camera,
    origin: '50% 38%',
    encoder: 'libx264',
    ...over,
  });
  const graph = (a: string[]) => a[a.indexOf('-filter_complex') + 1];

  it('tanpa adegan (undefined atau kosong): argumen persis seperti sebelumnya', () => {
    const none = compositeArgs(spec());
    expect(compositeArgs(spec({ scenes: [] }))).toEqual(none);
    expect(graph(none)).toMatch(/format=gbrp\[bg\];\[1:v\]format=gbrap\[ov\];\[bg\]\[ov\]overlay=format=gbrp:eof_action=pass,format=yuv420p\[v\]$/);
    expect(graph(none)).not.toContain('gblur');
  });

  it('satu adegan: cabang blur gblur + fade alpha 0,3 dtk, ditumpuk hanya di dalam rentang', () => {
    const g = graph(compositeArgs(spec({ scenes: [{ s: 2, e: 6.5 }] })));
    expect(g).toContain("[bg]split[bk0a][bk0b];");
    expect(g).toContain("gblur=sigma=14:planes=7:enable='between(t,2,6.5)'");
    expect(g).toContain('format=gbrap,fade=t=in:st=2:d=0.3:alpha=1,fade=t=out:st=6.2:d=0.3:alpha=1[bl0]');
    expect(g).toContain("[bk0a][bl0]overlay=format=gbrp:enable='between(t,2,6.5)'[bs1];");
    expect(g).toContain('[bs1][ov]overlay=format=gbrp:eof_action=pass,format=yuv420p[v]');
    expect(g).not.toMatch(/blend/);
    // blur ada SETELAH kamera + skala dan SEBELUM overlay
    expect(g.indexOf('perspective')).toBeLessThan(g.indexOf('gblur'));
    expect(g.indexOf('gblur')).toBeLessThan(g.indexOf('[1:v]'));
  });

  it('beberapa adegan dirantai berurutan waktu; adegan pendek (fade dijepit) dan terlalu pendek (dibuang)', () => {
    const g = graph(compositeArgs(spec({ scenes: [{ s: 10, e: 12 }, { s: 3, e: 3.4 }, { s: 15, e: 15.05 }] })));
    expect(g.indexOf("between(t,3,3.4)")).toBeLessThan(g.indexOf("between(t,10,12)"));
    expect(g).toContain('fade=t=in:st=3:d=0.2:alpha=1,fade=t=out:st=3.2:d=0.2:alpha=1');
    expect(g).not.toContain('15.05');
    expect(g).toContain('[bs1]split[bk1a][bk1b]');
    expect(g).toContain('[bs2][ov]overlay=');
  });

  it('sigma mengikuti lebar keluaran (14 px pada 1080)', () => {
    expect(sceneBlurFilters([{ s: 1, e: 3 }], 1080, 'bg').filters).toContain('sigma=14:');
    expect(sceneBlurFilters([{ s: 1, e: 3 }], 1440, 'bg').filters).toContain('sigma=18.667:');
    expect(sceneBlurFilters([{ s: 1, e: 3 }], 2160, 'bg').filters).toContain('sigma=28:');
    expect(sceneBlurFilters(undefined, 1080, 'bg')).toEqual({ filters: '', out: 'bg' });
    const g4k = graph(compositeArgs(spec({ size: SIZES['4k'], framesSize: SIZES['4k'], scenes: [{ s: 1, e: 3 }] })));
    expect(g4k.indexOf('scale=2160:3840')).toBeLessThan(g4k.indexOf('gblur')); // blur di resolusi akhir
  });
});
