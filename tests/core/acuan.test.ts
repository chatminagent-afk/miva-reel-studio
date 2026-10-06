// Regresi pada data nyata tes2.mp4 (proyek acuan 06/10, dibuat dengan skill asli).
// Tes potong hening butuh footage `samples/tes2.mp4` (tidak di-commit); sisanya jalan tanpa footage.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapTiming } from '../../src/core/base';
import { buildCompositionData, buildCues, layoutCaptions } from '../../src/core/compose';
import { analyzeAudio, proposeCuts } from '../../src/core/cut';

const DIR = join(__dirname, '..', 'fixtures', 'acuan-tes2');
const J = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf-8'));
const norm = (x: unknown) => JSON.parse(JSON.stringify(x));
const SAMPLE = join(__dirname, '..', '..', 'samples', 'tes2.mp4');

describe('acuan tes2 (data nyata)', () => {
  const edit = J('edit.json');
  const raw = J('words-raw.json');

  it.skipIf(!existsSync(SAMPLE))('potong hening dari footage asli = 8 potongan skill', async () => {
    const { edb, duration } = await analyzeAudio(SAMPLE);
    const { segs } = proposeCuts(raw, edb, duration);
    expect(segs.length).toBe(edit.segs.length);
    segs.forEach(([a, b], i) => {
      expect(Math.abs(a - edit.segs[i][0])).toBeLessThanOrEqual(0.0101);
      expect(Math.abs(b - edit.segs[i][1])).toBeLessThanOrEqual(0.0101);
    });
  });

  it('timing, data komposisi, dan SFX sama dengan skill', () => {
    expect(norm(mapTiming(edit, raw).timing)).toEqual(norm(J('timing.json')));
    const T = J('timing.json');
    const C = J('captions.json');
    expect(norm(buildCompositionData(T, C, edit))).toEqual(norm(J('data.json')));
    const lib = { features: J('sfxlib/_fitur.json'), catalog: J('sfxlib/catalog.json') };
    const { caps, keys } = layoutCaptions(T, C);
    expect(norm(buildCues(T, caps, keys, edit, lib).cues)).toEqual(norm(J('cues.json')));
  });
});
