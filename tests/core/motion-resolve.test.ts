// resolveMotion / buildWordTimes: jangkar kata mentah -> detik hasil edit (kasus tepi) + briefToMotion pada brief sintetis.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapTiming } from '../../src/core/timing';
import { anchorTime, briefToMotion, buildWordTimes, resolveMotion } from '../../src/core/motion/resolve';
import type { MotionItem } from '../../src/core/motion/types';
import type { EditJson, RawWord, Seg } from '../../src/core/types';

const DIR = join(__dirname, '..', 'fixtures', 'briefs');
const J = <T>(f: string): T => JSON.parse(readFileSync(join(DIR, f), 'utf-8')) as T;

// 10 kata, tiap kata 0,4 dtk, jarak 0,5 dtk mulai di 1,0 dtk footage
const words: RawWord[] = Array.from({ length: 10 }, (_v, i) => ({ w: `k${i}`, s: 1 + i * 0.5, e: 1.4 + i * 0.5 }));
// seg: [1,3] (kata 0-3), potong [3,4.9) (kata 4,5,6 hilang: s+0.05 jatuh di jeda), lalu [5,7] (kata 8,9; kata 7 mulai 4.5? lihat bawah)
const segs: Seg[] = [
  [1, 3],
  [5, 7],
];

function item(partial: Partial<MotionItem> & { start: MotionItem['start'] }): MotionItem {
  return { id: 'x', kind: 'statement', props: { line2: 'A', style: 'pill' }, ...partial } as MotionItem;
}

describe('buildWordTimes / anchorTime', () => {
  it('sama dengan mapTiming (src/core/timing.ts) pada data nyata miva-3', () => {
    const w = J<RawWord[]>('miva-3.words-raw.json');
    const edit = J<{ src: string; segs: Seg[]; speed: number }>('miva-3.edit.json');
    const wt = buildWordTimes(w, edit.segs, edit.speed);
    const { timing } = mapTiming(edit as EditJson, w);
    // semua kata miva-3 terpakai: urutan timing = urutan kata mentah
    expect(timing.words.length).toBe(w.length);
    timing.words.forEach((t, i) => {
      expect(wt.s[i]).not.toBeNull();
      expect(Math.abs((wt.s[i] as number) - t.s)).toBeLessThan(0.0011);
      expect(Math.abs((wt.e[i] as number) - t.e)).toBeLessThan(0.0011);
    });
  });

  it('kata terpotong: awal menempel ke awal kata terpakai berikutnya, akhir juga', () => {
    const wt = buildWordTimes(words, segs, 1);
    // kata 0..3 di seg 1 (s=1.0,1.5,2.0,2.5); kata 4 (s=3.0) jatuh di jeda
    expect(wt.s[4]).toBeNull();
    const next = wt.next[4];
    expect(next).toBeGreaterThan(4);
    const startOfNext = wt.s[next] as number;
    expect(anchorTime({ word: 4, edge: 's' }, wt)).toBeCloseTo(startOfNext, 5);
    expect(anchorTime({ word: 4, edge: 'e' }, wt)).toBeCloseTo(startOfNext, 5);
    expect(anchorTime({ word: 4, edge: 's', off: -0.1 }, wt)).toBeCloseTo(startOfNext - 0.1, 5);
  });

  it('kata terpotong tanpa kata terpakai sesudahnya: menempel ke akhir kata terpakai sebelumnya', () => {
    const only: Seg[] = [[1, 2.5]]; // hanya kata 0-2 terpakai (s+0.05 <= 2.5)
    const wt = buildWordTimes(words, only, 1);
    const lastKept = wt.prev[9];
    expect(lastKept).toBeGreaterThanOrEqual(0);
    expect(anchorTime({ word: 9, edge: 's' }, wt)).toBeCloseTo(wt.e[lastKept] as number, 5);
  });

  it('tanpa kata sama sekali: 0 + offset, tidak melempar', () => {
    const wt = buildWordTimes([], [[0, 1]], 1);
    expect(anchorTime({ word: 3, off: 0.2 }, wt)).toBeCloseTo(0.2, 5);
  });

  it('indeks di luar rentang dijepit ke kata pertama/terakhir', () => {
    const wt = buildWordTimes(words, [[1, 7]], 1);
    expect(anchorTime({ word: -5 }, wt)).toBeCloseTo(0, 5);
    expect(anchorTime({ word: 99, edge: 'e' }, wt)).toBeCloseTo(wt.e[9] as number, 5);
  });
});

describe('resolveMotion', () => {
  const all: Seg[] = [[0, 10]];

  it('kecepatan 1.0: waktu hasil edit = footage - awal seg', () => {
    const r = resolveMotion([item({ start: { word: 2, edge: 's' }, end: { word: 3, edge: 'e' } })], words, all, 1, 10);
    expect(r[0].t0).toBeCloseTo(2.0, 5); // kata 2 mulai di 2.0 s
    expect(r[0].t1).toBeCloseTo(2.9, 5); // kata 3 berakhir 2.5+0.4
    expect(r[0].beatTimes).toEqual([]);
  });

  it('kecepatan 1.1: dibagi 1.1 dan offset ditambahkan setelahnya', () => {
    const r = resolveMotion([item({ start: { word: 2, edge: 's', off: -0.05 }, end: { word: 3, edge: 'e' } })], words, all, 1.1, 10);
    expect(r[0].t0).toBeCloseTo(2.0 / 1.1 - 0.05, 5);
    expect(r[0].t1).toBeCloseTo(2.9 / 1.1, 5);
  });

  it('seg dengan potongan: waktu berikutnya bergeser sebesar bagian yang dibuang', () => {
    // seg [1,3] lalu [5,7]: kata 8 (s=5.0) = awal seg ke-2 = 2.0 dtk setelah awal edit
    const r = resolveMotion([item({ start: { word: 8, edge: 's' } })], words, segs, 1, 4);
    expect(r[0].t0).toBeCloseTo(2.0, 5);
  });

  it('item tidak pernah dibuang walau jangkarnya terpotong', () => {
    const its = [item({ id: 'a', start: { word: 4 } }), item({ id: 'b', start: { word: 5 }, end: { word: 6 } })];
    const r = resolveMotion(its, words, segs, 1, 4);
    expect(r.length).toBe(2);
    for (const x of r) expect(x.t1).toBeGreaterThan(x.t0);
  });

  it('t1 > t0 minimal 0,5 dtk walau end sebelum start atau sama', () => {
    const r = resolveMotion(
      [item({ id: 'a', start: { word: 5 }, end: { word: 2 } }), item({ id: 'b', start: { word: 2 }, end: { word: 2, edge: 's' } })],
      words,
      all,
      1,
      10,
    );
    for (const x of r) expect(x.t1 - x.t0).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it('tanpa end: pakai dur; tanpa dur: durasi bawaan per jenis', () => {
    const r = resolveMotion(
      [item({ id: 'a', start: { word: 1 }, dur: 1.25 }), item({ id: 'b', kind: 'chat', props: { title: 't', steps: [] }, start: { word: 1 } })],
      words,
      all,
      1,
      10,
    );
    expect(r[0].t1 - r[0].t0).toBeCloseTo(1.25, 5);
    expect(r[1].t1 - r[1].t0).toBeGreaterThan(3);
  });

  it('dijepit ke [0, duration + tail]', () => {
    const r = resolveMotion(
      [
        item({ id: 'neg', start: { word: 0, off: -5 }, end: { word: 1 } }),
        item({ id: 'late', start: { word: 9, edge: 'e', off: 5 }, dur: 3 }),
        item({ id: 'endcard', kind: 'endcard', props: { title: 'MIVA' }, start: { word: 9, edge: 'e', off: 0.1 }, dur: 2.5 }),
      ],
      words,
      all,
      1,
      6,
      2,
    );
    expect(r[0].t0).toBe(0);
    for (const x of r) {
      expect(x.t0).toBeGreaterThanOrEqual(0);
      expect(x.t1).toBeLessThanOrEqual(8 + 1e-9);
      expect(x.t1 - x.t0).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
    // end card di atas tail: mulai sesudah kata terakhir (6 dtk) dan terpotong di duration + tail
    expect(r[2].t0).toBeGreaterThan(5.9);
    expect(r[2].t1).toBeCloseTo(8, 5);
  });

  it('beats: terurut naik dan dijepit di dalam [t0, t1]', () => {
    const r = resolveMotion(
      [
        item({
          kind: 'bubbles',
          props: { items: ['a', 'b', 'c', 'd'], mode: 'stack' },
          start: { word: 2 },
          end: { word: 4, edge: 'e' },
          beats: [{ word: 4 }, { word: 0 }, { word: 9 }, { word: 3 }],
        }),
      ],
      words,
      all,
      1,
      10,
    );
    const x = r[0];
    expect(x.beatTimes.length).toBe(4);
    expect([...x.beatTimes].sort((a, b) => a - b)).toEqual(x.beatTimes);
    for (const b of x.beatTimes) {
      expect(b).toBeGreaterThanOrEqual(x.t0 - 1e-9);
      expect(b).toBeLessThanOrEqual(x.t1 + 1e-9);
    }
    expect(x.beatTimes[0]).toBeCloseTo(x.t0, 5); // kata 0 sebelum t0 -> dijepit ke t0
    expect(x.beatTimes[3]).toBeCloseTo(x.t1, 5); // kata 9 sesudah t1 -> dijepit ke t1
  });

  it('mempertahankan field item dan urutan masukan', () => {
    const its = [item({ id: 'z', start: { word: 5 }, label: 'L', note: 'N', scene: true, review: true }), item({ id: 'y', start: { word: 1 } })];
    const r = resolveMotion(its, words, all, 1, 10);
    expect(r.map((x) => x.id)).toEqual(['z', 'y']);
    expect(r[0]).toMatchObject({ label: 'L', note: 'N', scene: true, review: true });
  });
});

describe('briefToMotion pada brief sintetis', () => {
  const W = (s: string): RawWord[] => s.split(' ').map((w, i) => ({ w, s: i * 0.4, e: i * 0.4 + 0.35 }));
  const script =
    'kalau kamu punya bisnis tapi masih pegang hp terus buat balas customer mungkin bukan customernya tapi sistemnya belum bisa kerja sendiri ini alasan aku bikin miva';
  const ws = W(script);
  const dur = ws.length * 0.4;
  const BRIEF = [
    'Kalau kamu punya bisnis tapi masih pegang HP terus buat balas customer.',
    '**[MOTION 01 - HOOK | 2 detik]**',
    'Tambahkan counter:',
    '**5 -> 10 -> 20 unread messages**',
    'Mungkin bukan customernya.',
    '**[MOTION 02 - PAUSE | 1.5 detik]**',
    'Semua notification freeze.',
    'Tampilkan teks besar:',
    '**"Mungkin bukan customer-nya."**',
    'Tapi sistemnya belum bisa kerja sendiri.',
    '**[MOTION 03 - PUNCHLINE]**',
    '**CUSTOMER**',
    '↓',
    '**MIVA**',
    'Ini alasan aku bikin MIVA.',
    '**[END CARD - 2 detik]**',
    '**MIVA AI**',
    '**Chat nomor di BIO**',
  ].join('\n');

  it('urutan blok, jenis, label dengan tanda hubung biasa, dan end card butuh tail', () => {
    const { items, report } = briefToMotion(BRIEF, ws, [[0, dur]], 1, dur, { tail: 0 });
    expect(report.blocks.map((b) => b.kinds)).toEqual([['counter'], ['statement'], ['chain'], ['endcard']]);
    expect(items.map((i) => i.label)).toEqual(['MOTION 01 - HOOK', 'MOTION 02 - PAUSE', 'MOTION 03 - PUNCHLINE', 'END CARD']);
    expect(report.needsTail).toBeGreaterThanOrEqual(2.4);
    expect(report.warnings.join(' ')).toMatch(/edit\.tail/);
    expect(items.every((i) => i.origin === 'rules')).toBe(true);
    // tail sudah cukup: tidak ada peringatan tail
    const ok = briefToMotion(BRIEF, ws, [[0, dur]], 1, dur, { tail: 2.6 });
    expect(ok.report.warnings.join(' ')).not.toMatch(/edit\.tail/);
  });

  it('PAUSE menahan: blok berikutnya digeser supaya statement tampil >= 1,5 dtk, tanpa tumpang tindih', () => {
    const { items } = briefToMotion(BRIEF, ws, [[0, dur]], 1, dur);
    const res = resolveMotion(items, ws, [[0, dur]], 1, dur, 2.6);
    const st = res.find((r) => r.kind === 'statement')!;
    const chain = res.find((r) => r.kind === 'chain')!;
    expect(st.t1 - st.t0).toBeGreaterThanOrEqual(1.45);
    expect(chain.t0).toBeGreaterThanOrEqual(st.t1 - 0.06);
  });

  it('kata terpotong tidak membuang item: semua blok tetap punya waktu valid', () => {
    // buang tengah transkrip dari hasil edit
    const segsCut: Seg[] = [
      [0, 3],
      [6, dur],
    ];
    const { items } = briefToMotion(BRIEF, ws, segsCut, 1, 3 + (dur - 6));
    const res = resolveMotion(items, ws, segsCut, 1, 3 + (dur - 6), 2.6);
    expect(res.length).toBe(items.length);
    for (const r of res) {
      expect(r.t1).toBeGreaterThan(r.t0);
      expect(Number.isFinite(r.t0)).toBe(true);
    }
  });

  it('transkrip tidak cocok dengan naskah: waktu dibagi rata + peringatan + review', () => {
    const other = W('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua');
    const { items, report } = briefToMotion(BRIEF, other, [[0, 8]], 1, 8);
    expect(report.warnings.join(' ')).toMatch(/tidak cocok/);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.review === true)).toBe(true);
  });

  it('transkrip kosong tidak melempar', () => {
    const { items, report } = briefToMotion(BRIEF, [], [[0, 5]], 1, 5);
    expect(items.length).toBeGreaterThan(0);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('em dash di brief tidak bocor ke label/props/note', () => {
    const EM = String.fromCharCode(0x2014);
    const withEm = BRIEF.replace('MOTION 01 - HOOK', `MOTION 01 ${EM} HOOK`).replace('MOTION 03 - PUNCHLINE', `MOTION 03 ${EM} PUNCHLINE ${EM} PAUSE`);
    const { items } = briefToMotion(withEm, ws, [[0, dur]], 1, dur);
    for (const i of items) {
      expect(JSON.stringify(i)).not.toContain(EM);
    }
  });
});
