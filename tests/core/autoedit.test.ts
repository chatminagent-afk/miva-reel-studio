// Model edit (segs), retake, kata kunci Rules, captions turunan, dan pipeline Auto Edit (tanpa Whisper: kata acuan tes2).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cutRetakes, runAutoEdit } from '../../src/core/autoedit';
import { buildCompositionData, layoutCaptions } from '../../src/core/compose';
import {
  cutRange,
  editedToSrc,
  gaps,
  keepRange,
  keptWordIndices,
  normalizeSegs,
  setGapKept,
  setWordKept,
  srcToEdited,
  wordKept,
} from '../../src/core/edit';
import { ffmpeg } from '../../src/core/ffmpeg';
import { buildCaptions, derive, loadProject, saveProject } from '../../src/core/project';
import { detectRetakes, suggestKeywords } from '../../src/core/suggest';
import type { RawWord } from '../../src/core/types';

const ACUAN = join(__dirname, '..', 'fixtures', 'acuan-tes2');
const rawWords = (): RawWord[] => JSON.parse(readFileSync(join(ACUAN, 'words-raw.json'), 'utf-8'));
const W = (spec: [string, number, number][]): RawWord[] => spec.map(([w, s, e]) => ({ w, s, e, e_ref: e }));

describe('segs', () => {
  it('normalize, cut, keep', () => {
    expect(normalizeSegs([[2, 3], [0, 1], [0.9, 1.5], [5, 5.02]])).toEqual([[0, 1.5], [2, 3]]);
    expect(cutRange([[0, 10]], 2, 3)).toEqual([[0, 2], [3, 10]]);
    expect(cutRange([[0, 1], [2, 3]], 0.5, 2.5)).toEqual([[0, 0.5], [2.5, 3]]);
    expect(keepRange([[0, 2], [3, 10]], 1.9, 3.1)).toEqual([[0, 10]]);
  });

  it('waktu mentah <-> waktu edit (potong + percepat)', () => {
    const segs: [number, number][] = [[1, 3], [5, 6]];
    expect(srcToEdited(segs, 1.25, 2)).toBeCloseTo(0.8);
    expect(srcToEdited(segs, 1.25, 4)).toBeNull();
    expect(srcToEdited(segs, 1.25, 5.5)).toBeCloseTo(2);
    expect(editedToSrc(segs, 1.25, 2)).toEqual({ src: 5.5, seg: 1 });
    expect(editedToSrc(segs, 1, 0)).toEqual({ src: 1, seg: 0 });
    for (const t of [1.2, 2.9, 5.01, 5.9]) expect(editedToSrc(segs, 1.25, srcToEdited(segs, 1.25, t)!).src).toBeCloseTo(t);
  });

  it('coret kata lalu pulihkan: kata lain tidak tersentuh', () => {
    const words = W([['satu', 1, 1.4], ['dua', 1.5, 1.9], ['tiga', 2, 2.4]]);
    const segs: [number, number][] = [[0.94, 2.48]];
    const cut = setWordKept(segs, words, 1, false, 5);
    expect(words.map((w) => wordKept(cut, w))).toEqual([true, false, true]);
    const back = setWordKept(cut, words, 1, true, 5);
    expect(words.map((w) => wordKept(back, w))).toEqual([true, true, true]);
    expect(back).toEqual([[0.94, 2.48]]);
  });

  it('jeda panjang: terdeteksi, bisa disimpan untuk grafik lalu dibuang lagi', () => {
    const words = W([['a', 1, 1.4], ['b', 3, 3.4]]);
    const segs: [number, number][] = [[0.94, 1.48], [2.94, 3.48]];
    const [g] = gaps(segs, words);
    expect(g).toMatchObject({ after: 0, cut: true });
    const kept = setGapKept(segs, g, true);
    expect(gaps(kept, words)[0].cut).toBe(false);
    expect(kept).toEqual([[0.94, 3.48]]);
    expect(gaps(setGapKept(kept, g, false), words)[0].cut).toBe(true);
  });
});

describe('retake', () => {
  it('frasa >= 2 kata diulang: percobaan pertama dibuang', () => {
    const w = W([['harus', 1, 1.3], ['bayar,', 1.3, 1.7], ['harus', 2.2, 2.5], ['bayar', 2.5, 2.9], ['langganan', 3, 3.6]]);
    const r = detectRetakes(w);
    expect(r).toEqual([{ words: [0, 1], from: 1, to: 2.2, text: 'harus bayar,' }]);
    const segs = cutRetakes([[0.94, 3.68]], w, r);
    expect(w.map((x) => wordKept(segs, x))).toEqual([false, false, true, true, true]);
  });

  it('kata sela di antara tetap terdeteksi; pengulangan satu kata dan frasa jauh tidak', () => {
    expect(detectRetakes(W([['aku', 0, 0.2], ['mau', 0.2, 0.4], ['eh', 0.6, 0.8], ['aku', 1, 1.2], ['mau', 1.2, 1.4], ['coba', 1.4, 1.8]]))[0].words).toEqual([0, 1, 2]);
    expect(detectRetakes(W([['motion', 0, 0.4], ['motion', 0.5, 0.9], ['grafik', 1, 1.4]]))).toEqual([]);
    expect(detectRetakes(W([['kita', 0, 0.2], ['lihat', 0.2, 0.5], ['x', 1, 1.2], ['kita', 9, 9.2], ['lihat', 9.2, 9.5]]))).toEqual([]);
    // data nyata tes2: "Dia bisa kasih subtitle Terus bisa kasih motion" = struktur sejajar, bukan retake
    expect(detectRetakes(rawWords())).toEqual([]);
    // tanpa jeda dan tanpa kata sela: dianggap disengaja
    expect(detectRetakes(W([['pakai', 0, 0.3], ['ini', 0.3, 0.5], ['pakai', 0.55, 0.8], ['ini', 0.8, 1]]))).toEqual([]);
  });
});

describe('kata kunci Rules', () => {
  it('data nyata tes2: nama produk terpilih, berjarak, sekali per kata', () => {
    const fix = JSON.parse(readFileSync(join(ACUAN, 'edit.json'), 'utf-8')).fix;
    const words = rawWords().map((w) => ({ ...w, w: fix[w.w] ?? w.w }));
    // awal segmen Whisper tes2 (= kata berhuruf besar selain nama; dari transkrip benchmark)
    const NAMES = new Set(['CapCut,', 'Adobe', 'Premiere', 'Claude']);
    const sentenceStarts = words.flatMap((w, i) => (/^[A-Z]/.test(w.w) && !NAMES.has(w.w) ? [i] : []));
    const marks = suggestKeywords(words, { sentenceStarts });
    const texts = marks.map((m) => m.big.map((i) => words[i].w.replace(/[,.?]/g, '')).join(' '));
    // sama dengan 2 kata kunci pertama acuan buatan Steven; "Adobe Premiere" < 2,5 dtk dari CapCut, "Keren" = awal kalimat
    expect(texts).toEqual(['CapCut', 'Claude']);
    expect(words[marks[0].big[0]].s).toBe(9.12); // CapCut pertama ("tuh CapCut"), bukan pengulangannya
    expect(new Set(texts.map((t) => t.toLowerCase())).size).toBe(texts.length);
    const starts = marks.map((m) => words[m.big[0]].s);
    starts.forEach((s, i) => i && expect(s - starts[i - 1]).toBeGreaterThanOrEqual(2.5));
    expect(marks.filter((m) => m.hit === 'boom').length).toBeLessThanOrEqual(1);
  });

  it('nama dua kata digabung jadi satu kata kunci', () => {
    const w = W([['pakai', 0, 0.3], ['Adobe', 0.4, 0.8], ['Premiere', 0.8, 1.3], ['tiap', 1.4, 1.6], ['hari.', 1.6, 2]]);
    expect(suggestKeywords(w)).toEqual([{ big: [1, 2], anim: 'blur', hit: null }]);
  });

  it('angka + satuan jadi satu kata kunci, dapat boom', () => {
    const w = W([['cuma', 0, 0.3], ['15', 0.4, 0.7], ['juta', 0.7, 1], ['sebulan.', 1, 1.6]]);
    expect(suggestKeywords(w)[0]).toMatchObject({ big: [1, 2], hit: 'boom' });
  });
});

describe('captions turunan', () => {
  it('kata kunci menempel di kata mentah; dipotong = kembali jadi subtitle biasa', () => {
    const words = W([['Jadi', 0.5, 0.8], ['pakai', 0.9, 1.2], ['CapCut', 1.3, 1.8], ['tiap', 2.6, 2.9], ['bulan.', 3, 3.4]]);
    const doc = {
      edit: { src: 'x', segs: [[0.44, 3.48]] as [number, number][], speed: 1 },
      state: { words, keywords: [{ big: [2], anim: 'slam' as const, hit: null }] } as never,
    };
    let { captions, timing } = derive(doc);
    const key = captions.chunks.find((c) => c.big);
    expect(key?.big?.map((t) => timing.words[t].w)).toEqual(['CapCut']);
    doc.edit.segs = setWordKept(doc.edit.segs, words, 2, false, 5);
    ({ captions } = derive(doc));
    expect(captions.chunks.some((c) => c.big)).toBe(false);
    expect(() => layoutCaptions(derive(doc).timing, captions)).not.toThrow();
  });

  it('buildCaptions: big di luar kelompok kata kunci dibuang, pos tengah tidak ditulis', () => {
    const timing = { duration: 3, speed: 1, cuts: [], words: [{ w: 'a', s: 0, e: 0.2, seg: 0 }, { w: 'b', s: 0.3, e: 0.5, seg: 0 }] };
    expect(buildCaptions(timing, [4, 7], [{ big: [7], anim: 'blur', pos: 'c' }]).chunks[0]).toEqual({ w: [0, 1], anim: 'blur', big: [1], _teks: 'a b' });
  });
});

describe('Auto Edit (integrasi, tanpa Whisper)', () => {
  let work: string;
  let src: string;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'reel-autoedit-'));
    src = join(work, 'raw.mp4');
    // footage sintetis 37 dtk: semburan "suara" di posisi kata asli tes2 supaya energi pita suara cocok dengan kata
    const words = rawWords();
    const vol = words.map((w) => `between(t,${w.s},${w.e})`).join('+');
    await ffmpeg([
      '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=37.04',
      '-f', 'lavfi', '-i', 'anoisesrc=c=pink:r=48000:a=0.5:d=37.04',
      '-filter_complex', `[1:a]bandpass=f=1200:width_type=o:w=2,volume='0.003+0.6*gt(${vol},0)':eval=frame[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-shortest', src,
    ]);
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('proyek format skill + proxy 540p; bisa dimuat ulang dan dirender', async () => {
    const steps: number[] = [];
    const { doc, summary } = await runAutoEdit({
      src,
      root: work,
      ffmpeg: 'ffmpeg',
      whisper: { python: '', sidecar: '', site: '', modelDir: '' },
      wordsOverride: rawWords(),
      fix: { cloud: 'Claude', donton: 'nonton' },
      onProgress: (p) => steps.push(p.step),
    });
    expect([...new Set(steps)]).toEqual([1, 2, 3, 4, 5]);
    expect(doc.dir).toMatch(/\d{4}-\d{2}-\d{2}-raw$/);
    for (const f of ['edit.json', 'timing.json', 'captions.json', '.reel/state.json', 'assets/_proxy.mp4']) expect(existsSync(join(doc.dir, f))).toBe(true);
    const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(doc.dir, 'assets/_proxy.mp4')], { encoding: 'utf-8' }).trim();
    expect(dims).toBe('540,960');
    // hening awal (kamera dipasang, 4,7 dtk) dibuang; hasil jauh lebih pendek dari mentah
    expect(doc.edit.segs[0][0]).toBeGreaterThan(4);
    expect(summary.finalDuration).toBeLessThan(summary.rawDuration * 0.75);
    expect(summary.keywords).toBeGreaterThan(0);
    expect(doc.edit.fix).toEqual({ cloud: 'Claude', donton: 'nonton' });
    // semua kata acuan terpakai (tidak ada retake di tes2), dan timing memakai koreksi kamus
    const T = JSON.parse(readFileSync(join(doc.dir, 'timing.json'), 'utf-8'));
    expect(keptWordIndices(doc.edit.segs, doc.state.words).length).toBe(rawWords().length);
    expect(T.words.map((w: { w: string }) => w.w)).toContain('Claude');
    // komposisi bisa dibangun dari file skill (jalur export)
    const C = JSON.parse(readFileSync(join(doc.dir, 'captions.json'), 'utf-8'));
    expect(() => buildCompositionData(T, C, doc.edit)).not.toThrow();
    const again = await loadProject(doc.dir);
    expect(again.edit).toEqual(doc.edit);
    expect(again.state.words.length).toBe(rawWords().length);
    await saveProject(again);
    expect(JSON.parse(readFileSync(join(doc.dir, 'timing.json'), 'utf-8'))).toEqual(T);
  });
});
