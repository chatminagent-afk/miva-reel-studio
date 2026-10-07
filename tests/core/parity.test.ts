// Tes paritas: port TypeScript harus memberi hasil yang sama dengan script ASLI skill reel-edit.
// Golden dibuat oleh tests/parity/gen_golden.py (jalankan `npm run golden` setelah skill acuan berubah).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBaseCommands, mapTiming } from '../../src/core/base';
import { draftCaptions } from '../../src/core/captions';
import { buildCompositionData, buildCues, layoutCaptions } from '../../src/core/compose';
import { analyzeAudio, proposeCuts } from '../../src/core/cut';
import type { CaptionsJson, CuesJson, EditJson, RawWord, SfxCatalog, SfxFeature, TimingJson } from '../../src/core/types';

const FIX = join(__dirname, '..', 'fixtures');
const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T;
// -0 dan +0 dianggap sama (Python menulis -0.0, JSON JS menulis 0)
const norm = (x: unknown) => JSON.parse(JSON.stringify(x));

const lib = {
  features: read<Record<string, SfxFeature>>(join(FIX, 'sfxlib', '_fitur.json')),
  catalog: read<SfxCatalog>(join(FIX, 'sfxlib', 'catalog.json')),
};

const cases = readdirSync(join(FIX, 'cases')).filter((c) => existsSync(join(FIX, 'cases', c, 'golden', 'timing.json')));

describe.each(cases)('paritas skill reel-edit: %s', (name) => {
  const dir = join(FIX, 'cases', name);
  const g = (f: string) => join(dir, 'golden', f);
  const rawWords = read<RawWord[]>(g('words-raw.json'));
  const edit = read<EditJson>(g('edit.json'));
  const timing = read<TimingJson>(g('timing.json'));
  const captions = read<CaptionsJson>(g('captions.json'));

  it('potong hening: segs sama dengan transcribe.py (toleransi 10 ms)', async () => {
    const auto = read<EditJson>(g('edit_auto.json'));
    const whisper = rawWords.map(({ w, s, e, p }) => ({ w, s, e, p }));
    const { edb, duration } = await analyzeAudio(join(dir, 'audio.wav'));
    const res = proposeCuts(whisper, edb, duration);
    expect(res.segs.length).toBe(auto.segs.length);
    res.segs.forEach(([a, b], i) => {
      expect(Math.abs(a - auto.segs[i][0])).toBeLessThanOrEqual(0.0101);
      expect(Math.abs(b - auto.segs[i][1])).toBeLessThanOrEqual(0.0101);
    });
    // words-raw.json skill TIDAK menyimpan e_ref (ditulis sebelum e_ref dihitung), jadi e_ref divalidasi lewat segs di atas
    expect(rawWords.every((w) => w.e_ref === undefined)).toBe(true);
  });

  it('perintah ffmpeg build_base identik', () => {
    const golden = read<string[][]>(g('ffmpeg_cmds.json')).map((c) => c.slice(4)); // buang "ffmpeg -v error -y"
    // pemisah path mengikuti OS (Windows: \\); golden dibuat di Linux
    const ours = buildBaseCommands({ ...edit, src: '<SRC>' }, '<PROJ>').map((c) => c.map((x) => (x.startsWith('<PROJ>') ? x.replaceAll('\\', '/') : x)));
    expect(ours).toEqual(golden);
  });

  it('timing.json identik', () => {
    const { timing: ours, lost } = mapTiming(edit, rawWords);
    expect(norm(ours)).toEqual(norm(timing));
    expect(lost.length).toBe(rawWords.length - timing.words.length);
  });

  it('draf captions.json identik', () => {
    expect(norm(draftCaptions(timing))).toEqual(norm(read(g('captions_draft.json'))));
  });

  it('data komposisi (subtitle, kata kunci, kamera, insert) identik', () => {
    expect(norm(buildCompositionData(timing, captions, edit))).toEqual(norm(read(g('data.json'))));
  });

  it('cues.json (SFX otomatis + manual + aturan kepadatan) identik', () => {
    const { caps, keys } = layoutCaptions(timing, captions);
    const { cues } = buildCues(timing, caps, keys, edit, lib);
    expect(norm(cues)).toEqual(norm(read<CuesJson>(g('cues.json'))));
  });
});
