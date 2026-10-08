// Operasi editor untuk motion (src/renderer/src/editor/ops.ts, murni): brief -> item, tambah/ubah/atur waktu/hapus, tail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectState } from '../../src/core/doc';
import { MOTION_COMPONENTS } from '../../src/core/motion';
import { resolveMotion } from '../../src/core/motion/resolve';
import type { MotionItem, MotionKind } from '../../src/core/motion/types';
import type { EditJson, RawWord } from '../../src/core/types';
import * as ops from '../../src/renderer/src/editor/ops';
import { computeDerived } from '../../src/renderer/src/editor/derived';

const DIR = join(__dirname, '..', 'fixtures', 'briefs');
const words = JSON.parse(readFileSync(join(DIR, 'miva-3.words-raw.json'), 'utf-8')) as RawWord[];
const edit3 = JSON.parse(readFileSync(join(DIR, 'miva-3.edit.json'), 'utf-8')) as EditJson;
const brief = readFileSync(join(DIR, 'miva-3.brief.txt'), 'utf-8');

const doc0 = (over: Partial<EditJson> = {}): ops.Doc => {
  const edit = { ...edit3, ...over } as EditJson;
  for (const k of Object.keys(over)) if ((over as Record<string, unknown>)[k] === undefined) delete (edit as Record<string, unknown>)[k];
  return {
    edit,
    state: { version: 1, name: 't', source: 's', created: 'c', updated: 'u', duration: 60, words, keywords: [], retakes: [], floor: -50, keywordMode: 'rules' } as ProjectState,
  };
};
const resolved = (d: ops.Doc) => resolveMotion(d.state.motion ?? [], words, d.edit.segs, Number(d.edit.speed ?? 1.25), ops.bodyDuration(d) + Number(d.edit.tail ?? 0));
const kinds = () => Object.keys(MOTION_COMPONENTS) as MotionKind[];

describe('setMotionBrief / setTail', () => {
  it('brief tersimpan apa adanya; kosong menghapus field', () => {
    const d = ops.setMotionBrief(doc0(), '  naskah\n[MOTION 01 - A]  ');
    expect(d.state.motionBrief).toBe('  naskah\n[MOTION 01 - A]  ');
    expect('motionBrief' in ops.setMotionBrief(d, '   ').state && ops.setMotionBrief(d, '   ').state.motionBrief).toBeFalsy();
  });

  it('tail: 0 menghapus kunci, dibulatkan 2 desimal, dijepit 0..10, tidak mengubah edit lain', () => {
    const d = ops.setTail(doc0({ tail: undefined }), 2.456);
    expect(d.edit.tail).toBe(2.46);
    expect(ops.setTail(d, 0).edit).not.toHaveProperty('tail');
    expect(ops.setTail(d, -4).edit).not.toHaveProperty('tail');
    expect(ops.setTail(d, 99).edit.tail).toBe(10);
    expect(ops.setTail(d, Number.NaN).edit).not.toHaveProperty('tail');
    expect(ops.setTail(d, 1).edit.segs).toBe(d.edit.segs);
  });
});

describe('generateMotion', () => {
  it('menerjemahkan brief miva-3: item origin rules, laporan tersimpan, urut waktu', () => {
    const d = ops.generateMotion(ops.setMotionBrief(doc0(), brief));
    const items = d.state.motion!;
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.every((m) => m.origin === 'rules')).toBe(true);
    expect(d.state.motionReport?.blocks.length).toBeGreaterThanOrEqual(8);
    const t0 = resolved(d).map((r) => r.t0);
    expect([...t0].sort((a, b) => a - b)).toEqual(t0);
  });

  it('brief ber-end card dan tail belum diisi: tail diset 2,5 dan peringatan laporan tidak basi', () => {
    const d0 = ops.setMotionBrief(doc0({ tail: undefined }), brief);
    expect(d0.edit.tail).toBeUndefined();
    const d = ops.generateMotion(d0);
    expect(d.state.motionReport!.needsTail).toBe(2.5);
    expect(d.edit.tail).toBe(2.5);
    expect(d.state.motionReport!.warnings.join('|')).not.toMatch(/butuh edit\.tail/);
  });

  it('tail yang sudah diisi tidak ditimpa', () => {
    const d = ops.generateMotion(ops.setMotionBrief(doc0({ tail: 4 }), brief));
    expect(d.edit.tail).toBe(4);
  });

  it('generate ulang mengganti item rules tapi mempertahankan item manual (dan tidak menumpuk)', () => {
    let d = ops.setMotionBrief(doc0(), brief);
    d = ops.generateMotion(d);
    const n = d.state.motion!.length;
    d = ops.addMotion(d, 'toasts', 5);
    const manualId = d.state.motion!.find((m) => m.origin === 'manual')!.id;
    // sunting item rules: tetap berasal dari rules sehingga ikut diganti
    const first = d.state.motion!.find((m) => m.origin === 'rules')!;
    d = ops.updateMotion(d, first.id, { label: 'EDIT SAYA' });
    const again = ops.generateMotion(d);
    expect(again.state.motion!.length).toBe(n + 1);
    expect(again.state.motion!.filter((m) => m.origin === 'manual').map((m) => m.id)).toEqual([manualId]);
    expect(again.state.motion!.some((m) => m.label === 'EDIT SAYA')).toBe(false);
    // kunci hasil sunting lewat origin manual: bertahan
    d = ops.updateMotion(d, first.id, { origin: 'manual' });
    const kept = ops.generateMotion(d);
    expect(kept.state.motion!.some((m) => m.label === 'EDIT SAYA')).toBe(true);
    // id unik
    const ids = kept.state.motion!.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('brief kosong: tidak ada item rules, manual tetap', () => {
    let d = ops.addMotion(doc0(), 'statement', 3);
    d = ops.generateMotion(d);
    expect(d.state.motion!.map((m) => m.origin)).toEqual(['manual']);
    expect(d.state.motionReport!.blocks).toEqual([]);
  });
});

describe('addMotion / updateMotion / removeMotion', () => {
  it('addMotion: bawaan komponen, adegan sesuai komponen, durasi dijepit, id unik, kembali ke detik yang diminta', () => {
    let d = doc0();
    for (const k of kinds()) {
      d = ops.addMotion(d, k, 6.25);
      const it = d.state.motion![d.state.motion!.length - 1];
      const c = MOTION_COMPONENTS[k]!;
      expect(it.kind).toBe(k);
      expect(it.origin).toBe('manual');
      expect(it.scene).toBe(c.sceneDefault);
      expect(it.dur).toBeGreaterThanOrEqual(c.minDur);
      expect(it.dur).toBeLessThanOrEqual(c.maxDur);
      expect(it.props).toEqual(c.defaults());
      const r = resolved(d).at(-1)!;
      expect(Math.abs(r.t0 - 6.25)).toBeLessThanOrEqual(0.001);
    }
    d = ops.addMotion(d, 'statement', 6.25);
    d = ops.addMotion(d, 'statement', 6.25);
    const ids = d.state.motion!.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('addMotion: waktu di ekor dijangkarkan ke kata terakhir; di luar rentang dijepit; komponen tak dikenal ditolak', () => {
    const d = doc0();
    const total = ops.bodyDuration(d) + 2.6;
    const inTail = ops.addMotion(d, 'statement', ops.bodyDuration(d) + 1);
    expect(Math.abs(resolved(inTail)[0].t0 - (ops.bodyDuration(d) + 1))).toBeLessThanOrEqual(0.001);
    const far = ops.addMotion(d, 'statement', 999);
    expect(resolved(far)[0].t1).toBeLessThanOrEqual(total + 1e-9);
    expect(() => ops.addMotion(d, 'bogus' as MotionKind, 1)).toThrow(/belum tersedia/);
  });

  it('updateMotion: props digabung dangkal, undefined menghapus kunci, review/label/scene/origin', () => {
    let d = ops.addMotion(doc0(), 'statement', 4);
    const id = d.state.motion![0].id;
    d = ops.updateMotion(d, id, { props: { line1: 'kecil', line2: 'BESAR' } });
    expect(d.state.motion![0].props).toMatchObject({ line1: 'kecil', line2: 'BESAR', style: expect.any(String) });
    d = ops.updateMotion(d, id, { props: { line1: undefined } });
    expect(d.state.motion![0].props).not.toHaveProperty('line1');
    d = ops.updateMotion(d, id, { review: true, label: 'MOTION 01', scene: false });
    expect(d.state.motion![0]).toMatchObject({ review: true, label: 'MOTION 01', scene: false });
    d = ops.updateMotion(d, id, { review: false, origin: 'rules' });
    expect(d.state.motion![0]).not.toHaveProperty('review');
    expect(d.state.motion![0].origin).toBe('rules');
    expect(ops.updateMotion(d, 'tidak-ada', { label: 'x' })).toEqual(d);
  });

  it('removeMotion', () => {
    let d = ops.addMotion(ops.addMotion(doc0(), 'statement', 2), 'toasts', 8);
    const [a, b] = d.state.motion!;
    d = ops.removeMotion(d, a.id);
    expect(d.state.motion!.map((m) => m.id)).toEqual([b.id]);
  });
});

describe('setMotionTimes', () => {
  it('detik hasil edit -> jangkar kata -> detik yang sama (dalam 1 ms), start dan end, dur dihapus', () => {
    let d = ops.addMotion(doc0(), 'statement', 2);
    const id = d.state.motion![0].id;
    for (const [t0, t1] of [[3.0, 6.0], [10.123, 12.9], [0, 1], [20.5, 24.25]]) {
      d = ops.setMotionTimes(d, id, t0, t1);
      const r = resolved(d)[0];
      expect(Math.abs(r.t0 - t0)).toBeLessThanOrEqual(0.001);
      expect(Math.abs(r.t1 - t1)).toBeLessThanOrEqual(0.001);
      expect(d.state.motion![0]).not.toHaveProperty('dur');
    }
  });

  it('dijepit ke [0, durasi + tail], panjang minimal 0,5 dtk', () => {
    let d = ops.addMotion(doc0(), 'statement', 2);
    const id = d.state.motion![0].id;
    const total = ops.bodyDuration(d) + 2.6;
    d = ops.setMotionTimes(d, id, total - 0.1, total + 5);
    let r = resolved(d)[0];
    expect(r.t1).toBeLessThanOrEqual(total + 0.001);
    expect(r.t1 - r.t0).toBeGreaterThanOrEqual(0.499);
    d = ops.setMotionTimes(d, id, 5, 5.01);
    r = resolved(d)[0];
    expect(r.t1 - r.t0).toBeGreaterThanOrEqual(0.499);
    d = ops.setMotionTimes(d, id, -5, 2);
    expect(resolved(d)[0].t0).toBeGreaterThanOrEqual(-0.001);
    expect(ops.setMotionTimes(d, 'tidak-ada', 1, 2)).toBe(d);
  });

  it('beats ikut: posisi relatif dipertahankan saat digeser, diskalakan saat durasi berubah', () => {
    let d = ops.addMotion(doc0(), 'counter', 4);
    const id = d.state.motion![0].id;
    d = ops.setMotionTimes(d, id, 4, 8); // 4 dtk
    const anchor = (t: number) => ({ ...ops.addMotion(d, 'statement', t).state.motion!.at(-1)!.start });
    d = { ...d, state: { ...d.state, motion: d.state.motion!.map((m) => ({ ...m, beats: [anchor(5), anchor(6), anchor(7)] }) as MotionItem) } };
    const before = resolved(d)[0].beatTimes;
    const moved = ops.setMotionTimes(d, id, 10, 14); // geser 6 dtk, durasi sama
    const mb = resolved(moved)[0].beatTimes;
    mb.forEach((t, i) => expect(Math.abs(t - (before[i] + 6))).toBeLessThanOrEqual(0.002));
    const scaled = ops.setMotionTimes(d, id, 4, 12); // durasi 4 -> 8 dtk: jarak beat dari awal berlipat dua
    const sb = resolved(scaled)[0].beatTimes;
    sb.forEach((t, i) => expect(Math.abs(t - (4 + (before[i] - 4) * 2))).toBeLessThanOrEqual(0.002));
  });
});

describe('derived: motion masuk turunan UI', () => {
  it('computeDerived memberi item bertanggal, overlay, adegan, tail dan SFX motion tidak di track SFX', () => {
    const d = ops.generateMotion(ops.setMotionBrief(doc0({ tail: undefined }), brief));
    const lib = {
      features: JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'sfxlib', '_fitur.json'), 'utf-8')),
      catalog: JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'sfxlib', 'catalog.json'), 'utf-8')),
    };
    const v = computeDerived(d, lib);
    expect(v.tail).toBe(2.5);
    expect(v.finalDuration).toBeCloseTo(v.bodyDuration + 2.5, 2);
    expect(v.motion.resolved).toHaveLength(d.state.motion!.length);
    expect(v.scenes).toBe(v.motion.overlay.scenes);
    expect(v.motion.overlay.html).toContain('mv-');
    expect(v.cues!.sfx.some((c) => c.m === 1)).toBe(true);
    expect(v.sfxSrc.some((c) => c.m === 1)).toBe(false);
    const none = computeDerived(ops.removeMotion(d, d.state.motion![0].id), lib);
    expect(none.motion.resolved).toHaveLength(d.state.motion!.length - 1);
    // tanpa motion sama sekali: overlay kosong
    const empty = computeDerived(doc0(), lib);
    expect(empty.motion.overlay.html).toBe('');
    expect(empty.cues!.sfx.some((c) => c.m === 1)).toBe(false);
  });
});
