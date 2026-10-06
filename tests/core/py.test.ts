// Pembulatan harus sama dengan Python (half-to-even pada nilai biner eksak).
import { describe, expect, it } from 'vitest';
import { percentile, pyFixed, pyFloatStr, pyRound } from '../../src/core/py';

describe('pyRound / pyFixed', () => {
  it.each([
    [0.125, 2, 0.12], // tepat setengah -> genap
    [0.375, 2, 0.38],
    [2.675, 2, 2.67], // 2.675 di biner = 2.67499999...
    [2.5, 0, 2],
    [3.5, 0, 4],
    [0.5, 0, 0],
    [1.5, 0, 2],
    [9.9999, 3, 10],
    [-1.2345, 3, -1.234],
    [-0.0004, 3, 0],
  ])('round(%f, %i) = %f', (x, n, want) => {
    expect(pyRound(x, n)).toBe(want);
  });

  it('format :.Nf seperti Python', () => {
    expect(pyFixed(1.005, 2)).toBe('1.00');
    expect(pyFixed(22.735, 2)).toBe('22.73');
    expect(pyFixed(0.125, 3)).toBe('0.125');
    expect(pyFixed(5, 2)).toBe('5.00');
  });

  it('str(float) seperti Python', () => {
    expect(pyFloatStr(2)).toBe('2.0');
    expect(pyFloatStr(1.25)).toBe('1.25');
    expect(pyFloatStr(0.84)).toBe('0.84');
  });

  it('percentile seperti numpy (linear)', () => {
    expect(percentile([1, 2, 3, 4], 20)).toBeCloseTo(1.6, 12);
    expect(percentile([5], 20)).toBe(5);
  });
});
