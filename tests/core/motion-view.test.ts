// Model tampilan motion (src/renderer/src/editor/motionView.ts): daftar urut waktu, laporan Generate, pemetaan sumbu timeline
// (termasuk ekor), lajur blok bertumpuk, snapping, dan hitungan seret. Plus patch `silent` di updateMotion.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectState } from '../../src/core/doc';
import type { EditJson, RawWord, Seg } from '../../src/core/types';
import { computeDerived } from '../../src/renderer/src/editor/derived';
import {
  assignLanes,
  axisToEdited,
  dragAxis,
  dragToTimes,
  editedToAxis,
  mmss,
  motionRows,
  MOTION_MIN,
  nearest,
  reportView,
  type Axis,
} from '../../src/renderer/src/editor/motionView';
import * as ops from '../../src/renderer/src/editor/ops';

const DIR = join(__dirname, '..', 'fixtures', 'briefs');
const words = JSON.parse(readFileSync(join(DIR, 'miva-3.words-raw.json'), 'utf-8')) as RawWord[];
const edit3 = JSON.parse(readFileSync(join(DIR, 'miva-3.edit.json'), 'utf-8')) as EditJson;
const brief = readFileSync(join(DIR, 'miva-3.brief.txt'), 'utf-8');
const doc0 = (): ops.Doc => ({
  edit: { ...edit3 },
  state: { version: 1, name: 't', source: 's', created: 'c', updated: 'u', duration: 60, words, keywords: [], retakes: [], floor: -50, keywordMode: 'rules' } as ProjectState,
});

describe('mmss', () => {
  it('mm:ss.s', () => {
    expect(mmss(0)).toBe('00:00.0');
    expect(mmss(3.44)).toBe('00:03.4');
    expect(mmss(65.26)).toBe('01:05.3');
    expect(mmss(-2)).toBe('00:00.0');
  });
});

describe('daftar dan laporan dari hasil Generate miva-3', () => {
  const d = ops.generateMotion(ops.setMotionBrief(doc0(), brief));
  const dv = computeDerived(d, null);
  const rows = motionRows(dv.motion.resolved);

  it('motionRows urut waktu mulai dan memuat judul komponen, jenis, badge', () => {
    expect(rows.length).toBe(d.state.motion!.length);
    expect(rows.map((r) => r.t0)).toEqual([...rows.map((r) => r.t0)].sort((a, b) => a - b));
    expect(rows.every((r) => r.title && r.name && r.t1 > r.t0)).toBe(true);
    expect(rows.at(-1)!.kind).toBe('endcard');
    expect(rows.every((r) => !r.manual)).toBe(true);
  });

  it('reportView: 9 blok, jumlah motion dari laporan, review dihitung dari item yang masih bertanda', () => {
    const v = reportView(d.state.motionReport, d.state.motion, dv.tail)!;
    expect(v.empty).toBe(false);
    expect(v.blocks).toBe(9);
    expect(v.created).toBe(d.state.motion!.length);
    expect(v.review).toBe(d.state.motion!.filter((m) => m.review).length);
    expect(v.guessed).toBe(d.state.motionReport!.blocks.filter((b) => b.timingGuessed).length);
    expect(v.notes.join(' ')).toMatch(/End card: the video holds its last frame for/);
    // tandai sudah dicek menurunkan hitungan review
    const first = d.state.motion!.find((m) => m.review);
    if (first) {
      const d2 = ops.updateMotion(d, first.id, { review: false });
      expect(reportView(d2.state.motionReport, d2.state.motion, dv.tail)!.review).toBe(v.review - 1);
    }
  });

  it('brief tanpa blok: empty, tanpa laporan: null', () => {
    const e = ops.generateMotion(ops.setMotionBrief(doc0(), 'cuma naskah biasa tanpa blok'));
    const v = reportView(e.state.motionReport, e.state.motion, 0)!;
    expect(v.empty).toBe(true);
    expect(v.blocks).toBe(0);
    expect(reportView(undefined, [], 0)).toBeNull();
  });

  it('end card tanpa tail: catatan meminta end hold', () => {
    const v = reportView(d.state.motionReport, d.state.motion, 0)!;
    expect(v.notes.join(' ')).toMatch(/needs an end hold/);
  });
});

describe('updateMotion: silent', () => {
  it('true menyalakan, false menghapus kunci, tidak mengubah item lain', () => {
    let d = ops.addMotion(ops.addMotion(doc0(), 'statement', 1), 'cta', 5);
    const [a, b] = d.state.motion!;
    d = ops.updateMotion(d, a.id, { silent: true });
    expect(d.state.motion![0].silent).toBe(true);
    expect(d.state.motion![1]).toEqual(b);
    d = ops.updateMotion(d, a.id, { silent: false });
    expect(d.state.motion![0]).not.toHaveProperty('silent');
  });
});

describe('sumbu timeline', () => {
  // dua potongan: footage mentah 2..6 dan 8..12, kecepatan 2 -> badan 4 dtk (4/2 + 4/2), mentah 15 dtk, ekor 2,5
  const segs: Seg[] = [
    [2, 6],
    [8, 12],
  ];
  const ax: Axis = { segs, speed: 2, body: 4, raw: 15 };

  it('editedToAxis: badan lewat potongan, ekor menyambung sesudah footage mentah', () => {
    expect(editedToAxis(ax, 0)).toBeCloseTo(2);
    expect(editedToAxis(ax, 1)).toBeCloseTo(4);
    expect(editedToAxis(ax, 2)).toBeCloseTo(6);
    expect(editedToAxis(ax, 3)).toBeCloseTo(10);
    expect(editedToAxis(ax, 4)).toBeCloseTo(12);
    expect(editedToAxis(ax, 5)).toBeCloseTo(15 + 1 * 2); // 1 dtk di ekor = speed dtk sumbu
    expect(editedToAxis(ax, 6.5)).toBeCloseTo(15 + 2.5 * 2);
  });

  it('axisToEdited adalah kebalikannya; bagian terbuang jatuh ke awal bagian terpakai berikutnya', () => {
    for (const te of [0, 0.4, 1, 1.9, 2, 2.6, 3.9, 4, 4.5, 6.5]) expect(axisToEdited(ax, editedToAxis(ax, te))).toBeCloseTo(te, 6);
    expect(axisToEdited(ax, 7)).toBeCloseTo(2); // di hasil edit = awal potongan ke-2
    expect(axisToEdited(ax, 13.5)).toBeCloseTo(4); // sesudah potongan terakhir, sebelum ekor
    expect(axisToEdited(ax, 0.5)).toBeCloseTo(0); // sebelum potongan pertama
  });
});

describe('lajur blok bertumpuk', () => {
  it('blok yang bersinggungan tidak berbagi lajur, yang menyambung memakai ulang lajur 0', () => {
    const r = [
      { id: 'a', t0: 0, t1: 3 },
      { id: 'b', t0: 0.5, t1: 3 },
      { id: 'c', t0: 3, t1: 5 },
      { id: 'd', t0: 3.2, t1: 6 },
      { id: 'e', t0: 3.4, t1: 4 },
    ];
    const { lanes, count } = assignLanes(r);
    expect(Object.fromEntries(lanes)).toEqual({ a: 0, b: 1, c: 0, d: 1, e: 2 });
    expect(count).toBe(3);
    expect(assignLanes([]).count).toBe(1);
  });
});

describe('snapping dan hitungan seret', () => {
  it('nearest memilih titik terdekat dalam ambang atau null', () => {
    expect(nearest(5.04, [1, 5, 5.2], 0.1)).toBe(5);
    expect(nearest(5.15, [1, 5, 5.2], 0.1)).toBe(5.2);
    expect(nearest(7, [1, 5], 0.1)).toBeNull();
    expect(nearest(1, [], 1)).toBeNull();
  });

  it('dragAxis: move menjaga panjang dan menempel ke titik snap terdekat (awal atau akhir)', () => {
    // blok 10..12 digeser +1,03: awal 11,03 dekat 11 -> geser tepat 1
    const a = dragAxis('move', 10, 12, 1.03, [11, 20], 0.06);
    expect(a.a0).toBeCloseTo(11);
    expect(a.a1).toBeCloseTo(13);
    // akhir 13,02 dekat 13,0 yang lebih dekat dibanding awal -> akhir menempel
    const b = dragAxis('move', 10, 12, 1.02, [13, 11.1], 0.06);
    expect(b.a1).toBeCloseTo(13);
    expect(b.a1 - b.a0).toBeCloseTo(2);
    // tanpa titik dekat: geser apa adanya
    const c = dragAxis('move', 10, 12, 0.5, [30], 0.06);
    expect(c).toEqual({ a0: 10.5, a1: 12.5 });
  });

  it('dragAxis: resize hanya mengubah satu tepi', () => {
    expect(dragAxis('left', 10, 12, -0.5, [], 0.1)).toEqual({ a0: 9.5, a1: 12 });
    expect(dragAxis('right', 10, 12, 0.5, [12.48], 0.1)).toEqual({ a0: 10, a1: 12.48 });
  });

  it('dragToTimes: move menjaga durasi (detik hasil edit) dan dijepit ke [0, total]', () => {
    const ax: Axis = { segs: [[0, 20]], speed: 1.25, body: 16, raw: 20 };
    const total = 18.5; // ekor 2,5
    const orig = { t0: 2, t1: 4.5 };
    const m = dragToTimes('move', ax, total, orig, { a0: 3, a1: 5.5 }); // awal 2 dtk = 2,5 sumbu; +0,5 sumbu = +0,4 dtk hasil edit
    expect(m.t0).toBeCloseTo(2.4);
    expect(m.t1 - m.t0).toBeCloseTo(2.5);
    const far = dragToTimes('move', ax, total, orig, { a0: 500, a1: 502.5 });
    expect(far.t1).toBeCloseTo(total);
    expect(far.t0).toBeCloseTo(total - 2.5);
    const neg = dragToTimes('move', ax, total, orig, { a0: -9, a1: -6.5 });
    expect(neg.t0).toBe(0);
  });

  it('dragToTimes: resize menjaga tepi lain dan panjang minimal', () => {
    const ax: Axis = { segs: [[0, 20]], speed: 1.25, body: 16, raw: 20 };
    const orig = { t0: 2, t1: 4.5 };
    const l = dragToTimes('left', ax, 18.5, orig, { a0: 100, a1: 0 });
    expect(l.t1).toBe(4.5);
    expect(l.t0).toBeCloseTo(4.5 - MOTION_MIN);
    const r = dragToTimes('right', ax, 18.5, orig, { a0: 0, a1: -10 });
    expect(r.t0).toBe(2);
    expect(r.t1).toBeCloseTo(2 + MOTION_MIN);
    const r2 = dragToTimes('right', ax, 18.5, orig, { a0: 0, a1: 21 }); // ke dalam ekor
    expect(r2.t1).toBeCloseTo(16 + (21 - 20) / 1.25);
    // hasil dipakai setMotionTimes: tidak melanggar batas
    let d = ops.addMotion(doc0(), 'statement', 1);
    const id = d.state.motion![0].id;
    d = ops.setMotionTimes(d, id, r.t0, r.t1);
    expect(computeDerived(d, null).motion.resolved[0].t1 - computeDerived(d, null).motion.resolved[0].t0).toBeGreaterThanOrEqual(MOTION_MIN - 0.002);
  });
});
