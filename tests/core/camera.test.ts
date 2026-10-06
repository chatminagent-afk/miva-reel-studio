// Ekspresi ffmpeg `perspective` harus menghasilkan jendela sumber yang sama dengan rumus kamera (cameraAt)
// di setiap frame. Regresi untuk bug 06/10: kurung pembagi hilang -> selisih sampai 183 px.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canComposeInFfmpeg, perspectiveFilter, sourceWindow } from '../../src/core/camera';

const D = JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'acuan-tes2', 'data.json'), 'utf-8'));

/** Evaluator kecil untuk subset bahasa ekspresi ffmpeg yang dipakai (if, gte, min, pow, cos, PI, in). `in` mulai dari 1. */
function evalFfmpegExpr(expr: string, inFrame: number): number {
  const js = expr
    .replace(/\bif\(/g, 'IF(')
    .replace(/\bgte\(/g, 'GTE(')
    .replace(/\bpow\(/g, 'Math.pow(')
    .replace(/\bcos\(/g, 'Math.cos(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bPI\b/g, 'Math.PI')
    .replace(/\bin\b/g, 'IN');
  return Function('IF', 'GTE', 'IN', `return ${js}`)((c: number, a: number, b: number) => (c ? a : b), (a: number, b: number) => (a >= b ? 1 : 0), inFrame);
}

describe('kamera FFmpeg', () => {
  const f = perspectiveFilter(D.camera, D.origin, 30);
  const opt = (k: string) => new RegExp(`${k}='([^']*)'`).exec(f)![1];

  it('data acuan bisa digabung di FFmpeg (tanpa whip)', () => {
    expect(canComposeInFfmpeg(D.camera)).toBe(true);
  });

  it('jendela sumber dari ekspresi = rumus kamera di semua frame (< 0,01 px)', () => {
    const frames = Math.round(D.duration * 30);
    for (let n = 0; n < frames; n++) {
      const w = sourceWindow(D.camera, D.origin, n / 30);
      expect(Math.abs(evalFfmpegExpr(opt('x0'), n + 1) - w.left)).toBeLessThan(0.01);
      expect(Math.abs(evalFfmpegExpr(opt('y0'), n + 1) - w.top)).toBeLessThan(0.01);
      expect(Math.abs(evalFfmpegExpr(opt('x3'), n + 1) - (w.left + w.width))).toBeLessThan(0.01);
      expect(Math.abs(evalFfmpegExpr(opt('y3'), n + 1) - (w.top + w.height))).toBeLessThan(0.01);
    }
  });

  it('jendela sumber tidak pernah keluar dari video (tanpa tepi hitam)', () => {
    for (let n = 0; n < Math.round(D.duration * 30); n++) {
      const w = sourceWindow(D.camera, D.origin, n / 30);
      expect(w.left).toBeGreaterThanOrEqual(-0.01);
      expect(w.top).toBeGreaterThanOrEqual(-0.01);
      expect(w.left + w.width).toBeLessThanOrEqual(1080.01);
      expect(w.top + w.height).toBeLessThanOrEqual(1920.01);
    }
  });
});
