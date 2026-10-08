// `edit.tail` (freeze frame akhir + hening untuk end card): port harus sama dengan build_base.py skill yang HIDUP
// (golden-tail dibuat tests/parity/gen_tail_golden.py), dan tanpa tail hasilnya harus identik dengan sebelumnya.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBaseCommands, buildBaseFilter } from '../../src/core/base';
import { baseKey } from '../../src/core/basecache';
import type { ProjectState } from '../../src/core/doc';
import { mapTiming, tailOf } from '../../src/core/timing';
import { sameDoc } from '../../src/core/versions';
import type { EditJson, RawWord } from '../../src/core/types';

const CASE = join(__dirname, '..', 'fixtures', 'cases', 'basic');
const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T;
const words = read<RawWord[]>(join(CASE, 'golden', 'words-raw.json'));
const edit0 = read<EditJson>(join(CASE, 'golden', 'edit.json'));
const editT = read<EditJson>(join(CASE, 'golden-tail', 'edit.json'));
const norm = (x: unknown) => JSON.parse(JSON.stringify(x));

describe('tail: paritas dengan build_base.py skill', () => {
  it('perintah ffmpeg identik (tpad di video, apad di audio)', () => {
    const golden = read<string[][]>(join(CASE, 'golden-tail', 'ffmpeg_cmds.json')).map((c) => c.slice(4));
    const ours = buildBaseCommands({ ...editT, src: '<SRC>' }, '<PROJ>').map((c) => c.map((x) => (x.startsWith('<PROJ>') ? x.replaceAll('\\', '/') : x)));
    expect(editT.tail).toBe(2.6);
    expect(ours).toEqual(golden);
  });

  it('timing.json identik: duration = isi + tail, kata tidak bergeser', () => {
    const golden = read<unknown>(join(CASE, 'golden-tail', 'timing.json'));
    const { timing } = mapTiming(editT, words);
    expect(norm(timing)).toEqual(norm(golden));
    expect(timing.duration).toBeCloseTo(mapTiming(edit0, words).timing.duration + 2.6, 3);
    expect(timing.words).toEqual(mapTiming(edit0, words).timing.words);
  });

  it('posisi filter: tpad sesudah grade sebelum format, apad sesudah aresample', () => {
    const f = buildBaseFilter({ ...edit0, tail: 2.6 });
    expect(f).toMatch(/vignette=angle=PI\/5:mode=forward,tpad=stop_mode=clone:stop_duration=2\.6,format=yuv420p\[vo\]/);
    expect(f).toMatch(/aresample=48000,apad=pad_dur=2\.6\[ao\]$/);
  });
});

describe('tail: tanpa tail hasilnya identik', () => {
  it('tail kosong, 0, negatif, atau bukan angka = filter dan timing seperti sebelumnya', () => {
    const base = buildBaseFilter(edit0);
    expect(base).not.toContain('tpad');
    expect(base).not.toContain('apad');
    for (const tail of [undefined, 0, -1, Number.NaN]) {
      const e = { ...edit0, tail } as EditJson;
      expect(buildBaseFilter(e)).toBe(base);
      expect(norm(mapTiming(e, words).timing)).toEqual(norm(mapTiming(edit0, words).timing));
    }
  });

  it('tailOf', () => {
    expect(tailOf({})).toBe(0);
    expect(tailOf({ tail: 2.5 })).toBe(2.5);
    expect(tailOf({ tail: -3 })).toBe(0);
  });

  it('baseKey: tail masuk kunci hanya kalau > 0 (kunci proyek lama tidak berubah)', () => {
    const k0 = baseKey({ ...edit0, src: 'tidak-ada.mp4' });
    expect(baseKey({ ...edit0, src: 'tidak-ada.mp4', tail: 0 })).toBe(k0);
    expect(JSON.parse(k0)).not.toHaveProperty('tail');
    const k1 = baseKey({ ...edit0, src: 'tidak-ada.mp4', tail: 2.5 });
    expect(k1).not.toBe(k0);
    expect(JSON.parse(k1).tail).toBe(2.5);
    expect(baseKey({ ...edit0, src: 'tidak-ada.mp4', tail: 3 })).not.toBe(k1);
  });
});

describe('versions: sameDoc membandingkan motion dan brief', () => {
  const state = (over: Partial<ProjectState> = {}): ProjectState =>
    ({ version: 1, name: 'x', source: 's', created: 'c', updated: 'u', duration: 10, words: [], keywords: [], retakes: [], floor: -50, keywordMode: 'rules', ...over }) as ProjectState;
  const item = { id: 'a', kind: 'statement', start: { word: 0 }, props: { line2: 'A', style: 'pill' } } as never;

  it('motion/brief berbeda = dokumen berbeda; kosong sama dengan tidak ada', () => {
    const e = { src: 'x', segs: [] } as EditJson;
    expect(sameDoc({ edit: e, state: state() }, { edit: e, state: state({ motion: [] }) })).toBe(true);
    expect(sameDoc({ edit: e, state: state() }, { edit: e, state: state({ motionBrief: '' }) })).toBe(true);
    expect(sameDoc({ edit: e, state: state() }, { edit: e, state: state({ motion: [item] }) })).toBe(false);
    expect(sameDoc({ edit: e, state: state({ motion: [item] }) }, { edit: e, state: state({ motion: [item] }) })).toBe(true);
    expect(sameDoc({ edit: e, state: state() }, { edit: e, state: state({ motionBrief: 'naskah' }) })).toBe(false);
    expect(sameDoc({ edit: e, state: state() }, { edit: { ...e, tail: 2.5 }, state: state() })).toBe(false);
  });
});
