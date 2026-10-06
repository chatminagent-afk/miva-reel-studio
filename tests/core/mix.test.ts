// Paritas mixer: port TypeScript vs mix.py asli (ringkasan PCM _mix.wav di golden/mix_stats.json).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mix } from '../../src/core/mix';
import type { CuesJson } from '../../src/core/types';

const FIX = join(__dirname, '..', 'fixtures');
const cases = readdirSync(join(FIX, 'cases')).filter((c) => existsSync(join(FIX, 'cases', c, 'golden', 'mix_stats.json')));

function pcmStats(path: string) {
  const b = readFileSync(path);
  const x = new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length));
  const frames = x.length / 2;
  const sumAbs = [0, 0];
  let maxAbs = 0;
  const sparse: number[][] = [];
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      const v = x[i * 2 + c];
      sumAbs[c] += Math.abs(v);
      maxAbs = Math.max(maxAbs, Math.abs(v));
    }
    if (i % 997 === 0) sparse.push([x[i * 2], x[i * 2 + 1]]);
  }
  return { frames, sumAbs, maxAbs, sparse };
}

describe.each(cases)('paritas mix.py: %s', (name) => {
  it('PCM _mix.wav sama (toleransi 1 LSB) dan loudness sama', async () => {
    const dir = join(FIX, 'cases', name);
    const golden = JSON.parse(readFileSync(join(dir, 'golden', 'mix_stats.json'), 'utf-8'));
    const cues = JSON.parse(readFileSync(join(dir, 'golden', 'cues.json'), 'utf-8')) as CuesJson;
    const proj = mkdtempSync(join(tmpdir(), 'mix-'));
    try {
      mkdirSync(join(proj, 'assets'));
      mkdirSync(join(proj, 'renders'));
      copyFileSync(join(dir, 'audio.wav'), join(proj, 'assets', 'voice.wav'));
      const rep = await mix(proj, cues, { sfxPath: (id) => join(FIX, 'sfxlib', `${id}.wav`) });
      const s = pcmStats(join(proj, 'renders', '_mix.wav'));
      expect(s.frames).toBe(golden.frames);
      expect(Math.abs(s.maxAbs - golden.max_abs)).toBeLessThanOrEqual(1);
      s.sparse.forEach(([l, r], i) => {
        expect(Math.abs(l - golden.sparse[i][0])).toBeLessThanOrEqual(1);
        expect(Math.abs(r - golden.sparse[i][1])).toBeLessThanOrEqual(1);
      });
      // selisih total maksimal 1 LSB per sampel di sedikit sampel
      for (let c = 0; c < 2; c++) expect(Math.abs(s.sumAbs[c] - golden.sum_abs[c])).toBeLessThanOrEqual(golden.frames * 0.001);
      const m = /mix (-?[\d.]+) LUFS, puncak (-?[\d.]+) dBFS/.exec(golden.report)!;
      expect(rep.mixLufs.toFixed(1)).toBe(Number(m[1]).toFixed(1));
      expect(rep.mixPeak.toFixed(1)).toBe(Number(m[2]).toFixed(1));
      expect(rep.sfxCount).toBe(cues.sfx.length);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});
