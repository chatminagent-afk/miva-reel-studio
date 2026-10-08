// Komponen motion (render): JS valid & bebas konstruksi tak deterministik, id berawalan dan unik, SFX memakai kategori
// pustaka bawaan, dan perakit buildMotionOverlay (satu IIFE, adegan tergabung, kind belum ada dilewati).
// JS dijalankan terhadap tl/document tiruan: tiap fromTo wajib immediateRender:false (seek-safe), semua id yang diacu ada di HTML.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMotionOverlay, getComponent, implementedKinds, MOTION_COMPONENTS } from '../../src/core/motion';
import { icon, ICON_NAMES } from '../../src/core/motion/icons';
import { RUNTIME_JS } from '../../src/core/motion/runtime';
import type { MotionKind, ResolvedMotion } from '../../src/core/motion/types';

const CATALOG = JSON.parse(readFileSync(join(__dirname, '..', '..', 'resources', 'sfx-default', 'catalog.json'), 'utf-8')) as {
  pilihan: Record<string, string[]>;
};
const KATEGORI = Object.keys(CATALOG.pilihan);

function mk(kind: MotionKind, id: string, t0 = 2, t1 = 6, extra: Partial<ResolvedMotion> = {}): ResolvedMotion {
  const comp = getComponent(kind)!;
  return { id, kind, start: { word: 0 }, props: comp.defaults(), t0, t1, beatTimes: [], ...extra } as ResolvedMotion;
}

const KINDS = implementedKinds();
const ALL_KINDS: MotionKind[] = ['statement', 'chat', 'chain', 'chips', 'counter', 'toasts', 'phone', 'split', 'bubbles', 'logo', 'endcard', 'toggle', 'cta'];
const BANNED = [/tl\.call/, /Math\.random/, /\bDate\b/, /setTimeout/, /setInterval/, /requestAnimationFrame/, /http/i, /<script/i];

const ids = (html: string) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);

interface Call {
  m: 'fromTo' | 'to' | 'set';
  target: unknown;
  from?: Record<string, unknown>;
  vars: Record<string, unknown>;
  pos: number;
}

/**
 * Jalankan JS motion terhadap tl/document tiruan; kembalikan semua panggilan tween dan id yang diminta lewat getElementById.
 * `js` = satu komponen (butuh helper runtime, dipasang di depan) atau seluruh IIFE hasil buildMotionOverlay (`full`).
 * `target` direkam sebagai selector string, atau '#id' bila target elemen tiruan (hasil getElementById).
 */
function run(js: string, full = false, dur = 30): { calls: Call[]; requested: Set<string> } {
  const calls: Call[] = [];
  const requested = new Set<string>();
  const norm = (t: unknown): unknown => (Array.isArray(t) ? t.map(norm) : t && typeof t === 'object' ? '#' + (t as { id: string }).id : t);
  const tl = {
    fromTo: (target: unknown, from: Record<string, unknown>, vars: Record<string, unknown>, pos: number) => (calls.push({ m: 'fromTo', target: norm(target), from, vars, pos }), tl),
    to: (target: unknown, vars: Record<string, unknown>, pos: number) => (calls.push({ m: 'to', target: norm(target), vars, pos }), tl),
    set: (target: unknown, vars: Record<string, unknown>, pos: number) => (calls.push({ m: 'set', target: norm(target), vars, pos }), tl),
  };
  const el = (id: string) => ({ id, querySelectorAll: (q: string) => Array.from({ length: q === 'b' ? 3 : 25 }, (_, i) => ({ id: `${id}/${q}/${i}` })) });
  const document = { getElementById: (id: string) => (requested.add(id), el(id)) };
  new Function('tl', 'document', 'D', 'DUR', full ? js : `${RUNTIME_JS}\n{\n${js}\n}`)(tl, document, {}, dur);
  return { calls, requested };
}

/** id yang diacu selector string ("#a .b", ["#a", "#c"]) */
function selectorIds(target: unknown): string[] {
  const list = Array.isArray(target) ? target : [target];
  return list.flatMap((t) => (typeof t === 'string' ? [...t.matchAll(/#([\w-]+)/g)].map((m) => m[1]) : []));
}

describe('registry', () => {
  it('semua 13 kind terdaftar, tiap kind punya metadata lengkap', () => {
    expect([...KINDS].sort()).toEqual([...ALL_KINDS].sort());
    for (const k of KINDS) {
      const c = MOTION_COMPONENTS[k]!;
      expect(c.kind).toBe(k);
      expect(c.title.length).toBeGreaterThan(2);
      expect(c.fields.length).toBeGreaterThan(0);
      expect(c.minDur).toBeGreaterThan(0);
      expect(c.maxDur).toBeGreaterThan(c.minDur);
      expect(['top', 'scene', 'full']).toContain(c.zone);
      expect(typeof c.sceneDefault).toBe('boolean');
      expect(() => JSON.stringify(c.defaults())).not.toThrow();
      // bawaan harus bisa di-serialisasi bolak-balik (disimpan di state proyek)
      expect(JSON.parse(JSON.stringify(c.defaults()))).toEqual(c.defaults());
    }
  });

  it('semua IconName punya SVG inline tanpa URL', () => {
    expect(ICON_NAMES.length).toBe(18);
    for (const n of ICON_NAMES) {
      const s = icon(n);
      expect(s.startsWith('<svg')).toBe(true);
      expect(s).not.toMatch(/http/i);
    }
  });
});

describe.each(KINDS)('komponen %s', (kind) => {
  const comp = getComponent(kind)!;
  const a = comp.build(mk(kind, 'one'));
  const b = comp.build(mk(kind, 'two'));

  it('JS valid dan bebas konstruksi tak deterministik / jaringan', () => {
    expect(() => new Function('tl', 'document', 'D', 'DUR', a.js)).not.toThrow();
    for (const rx of BANNED) {
      expect(a.js, `js ${rx}`).not.toMatch(rx);
      expect(a.html, `html ${rx}`).not.toMatch(rx);
      expect(a.css, `css ${rx}`).not.toMatch(rx);
    }
    expect(a.html.length).toBeGreaterThan(50);
  });

  it('id berawalan mv-, unik dalam satu item, dan tidak tabrakan antar dua item sejenis', () => {
    const ia = ids(a.html);
    const ib = ids(b.html);
    expect(ia.length).toBeGreaterThan(0);
    for (const i of [...ia, ...ib]) expect(i.startsWith('mv-')).toBe(true);
    expect(new Set(ia).size).toBe(ia.length);
    expect(ia.filter((i) => ib.includes(i))).toEqual([]);
  });

  it('deterministik: dua kali build menghasilkan keluaran identik', () => {
    const again = comp.build(mk(kind, 'one'));
    expect(again).toEqual(a);
  });

  it('dijalankan: fromTo immediateRender:false, waktu terbatas, semua id yang diacu ada di HTML', () => {
    const { calls, requested } = run(a.js);
    expect(calls.length).toBeGreaterThan(2);
    const have = new Set(ids(a.html));
    for (const c of calls) {
      if (c.m === 'fromTo') expect(c.vars.immediateRender, `fromTo ${String(c.target)}`).toBe(false);
      expect(Number.isFinite(c.pos)).toBe(true);
      expect(c.pos).toBeGreaterThanOrEqual(0);
      expect(c.pos).toBeLessThanOrEqual(6.01);
      for (const i of selectorIds(c.target)) if (!['flash', 'keys', 'caps'].includes(i)) expect(have.has(i), `selector #${i}`).toBe(true);
    }
    for (const i of requested) expect(have.has(i), `getElementById ${i}`).toBe(true);
  });

  it('SFX: kategori ada di pustaka bawaan, waktu di dalam item, gain tidak positif', () => {
    expect(a.sfx.length).toBeGreaterThan(0);
    for (const c of a.sfx) {
      expect(KATEGORI, `kategori ${c.kat}`).toContain(c.kat);
      expect(c.t).toBeGreaterThanOrEqual(2);
      expect(c.t).toBeLessThanOrEqual(6);
      if (c.gain_db !== undefined) expect(c.gain_db).toBeLessThanOrEqual(0);
    }
  });
});

describe('beatTimes', () => {
  it('toasts: tiap toast masuk tepat di beat-nya', () => {
    const beats = [2.1, 2.6, 3.0, 3.8, 4.1, 4.5];
    const b = getComponent('toasts')!.build(mk('toasts', 't', 2, 6, { beatTimes: beats }));
    const { calls } = run(b.js);
    const enter = calls.filter((c) => c.m === 'fromTo' && typeof c.target === 'string' && /-k\d$/.test(c.target as string) && 'x' in (c.from ?? {}));
    expect(enter.map((c) => c.pos)).toEqual(beats);
    expect(b.sfx.filter((c) => c.kat === 'pop').map((c) => c.t)).toEqual(beats);
  });

  it('counter: nilai berganti di beat; angka antara lewat tl.set display', () => {
    const b = getComponent('counter')!.build(mk('counter', 'c', 2, 6, { beatTimes: [3.0, 4.2] }));
    const { calls } = run(b.js);
    const sets = calls.filter((c) => c.m === 'set');
    expect(sets.length).toBeGreaterThanOrEqual(2 * 2 * 2); // minimal 2 langkah x (none+inline) per perubahan
    expect(Math.min(...sets.map((c) => c.pos))).toBeCloseTo(3.0, 5);
    expect(b.sfx.filter((c) => c.kat === 'tick').map((c) => c.t)).toEqual([3.0, 4.2]);
    // semua nilai muncul sebagai span berurutan 12 .. 27 .. 43
    const txt = [...b.html.matchAll(/class="mv-cnt-s"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
    expect(txt[0]).toBe(12);
    expect(txt).toContain(27);
    expect(txt[txt.length - 1]).toBe(43);
  });

  it('chat: bubble customer di beat, ketikan bot dimulai setelah titik mengetik', () => {
    const b = getComponent('chat')!.build(mk('chat', 'w', 2, 8, { beatTimes: [2.5, 3.2, 5.0, 5.5] }));
    const { calls } = run(b.js);
    const q = calls.find((c) => typeof c.target === 'string' && (c.target as string).endsWith('-s0') && c.m === 'fromTo');
    expect(q!.pos).toBe(2.5);
    const dots = calls.find((c) => typeof c.target === 'string' && (c.target as string).endsWith('-d1'));
    expect(dots!.pos).toBe(3.2);
    const ketik = b.sfx.find((c) => c.kat === 'ketik')!;
    expect(ketik.t).toBeGreaterThan(3.2);
    expect(ketik.t).toBeLessThan(5.0);
  });

  it('chain: node masuk di beat; morph dan caption ikut beat berikutnya', () => {
    const beats = [2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 3.2, 3.9, 4.6];
    const b = getComponent('chain')!.build(mk('chain', 'h', 2, 7, { beatTimes: beats }));
    const { calls } = run(b.js);
    const pos = (needle: string) => calls.find((c) => typeof c.target === 'string' && (c.target as string).includes(needle))!.pos;
    expect(pos('-a0')).toBe(2.0);
    expect(pos('-a5')).toBe(2.5);
    expect(pos('-cap')).toBe(4.6);
    const morph = calls.find((c) => c.target === '#mv-h-a' && c.m === 'to');
    expect(morph!.pos).toBe(3.9);
  });
});

describe('statement', () => {
  const comp = getComponent('statement')!;
  it('strike & accent: markup tanpa menyentuh teks lain, HTML di-escape', () => {
    const b = comp.build(
      mk('statement', 's', 2, 6, { props: { line1: 'A <b> & B', line2: 'Standby 24/7 itu mahal', style: 'serif', accent: ['mahal'], strike: ['24/7'] } }),
    );
    expect(b.html).toContain('A &lt;b&gt; &amp; B');
    expect(b.html).toContain('class="mv-sk"');
    expect(b.html).toContain('mv-st-ac">mahal<');
    expect(b.js).toContain('clipPath'); // coretan lewat clip-path, bukan scaleX(0)
    expect(b.js).not.toMatch(/scaleX:\s*0/);
  });

  it('pill: satu kalimat, kata disorot jadi <em>', () => {
    const b = comp.build(mk('statement', 'p', 2, 6, { props: { line2: 'Your system should work too.', style: 'pill', accent: ['work too.'] } }));
    expect(b.html).toContain('<em>work too.</em>');
    expect(b.sfx.some((c) => c.kat === 'pop')).toBe(true);
  });

  it('flash: kilat putih + klik', () => {
    const b = comp.build(mk('statement', 'f', 2, 6, { props: { line2: 'Stop.', style: 'serif', flash: true } }));
    expect(b.js).toContain('mv.flash(');
    expect(b.sfx.some((c) => c.kat === 'klik')).toBe(true);
  });
});

describe('buildMotionOverlay', () => {
  const items = [
    mk('logo', 'lg', 12, 15),
    mk('chat', 'wf', 2, 8, { scene: true }),
    mk('counter', 'cn', 0.5, 3.5),
    mk('statement', 'st', 7.5, 10, { scene: true }),
    mk('chain', 'ch', 16, 21),
    mk('toasts', 'ts', 21.5, 25),
    mk('chips', 'cp', 26, 30),
  ];
  const o = buildMotionOverlay(items);

  it('satu IIFE, tanpa deklarasi global, tidak bentrok dengan overlay.js tulisan tangan', () => {
    expect(o.js.startsWith('(() => {')).toBe(true);
    expect(o.js.trimEnd().endsWith('})();')).toBe(true);
    // overlay.js skill dilampirkan SETELAH motion dan mendeklarasikan show/pop/hide/$/IN/M: tidak boleh SyntaxError
    const skill = 'const M = D.marks; const $ = (id) => document.getElementById(id); const IN = {}; function show() {} function pop() {} function hide() {} const mv = 1;';
    expect(() => new Function('tl', 'D', 'DUR', 'document', o.js + '\n' + skill)).not.toThrow();
    for (const rx of BANNED) expect(o.js).not.toMatch(rx);
    const { calls } = run(o.js, true);
    expect(calls.length).toBeGreaterThan(50);
  });

  it('CSS: runtime sekali, kind sekali, semua selector berawalan mv-', () => {
    expect(o.css.match(/\/\* ===== motion app/g)!.length).toBe(1);
    for (const k of ['statement', 'chat', 'chain', 'chips', 'counter', 'toasts', 'logo']) expect(o.css.match(new RegExp(`/\\* ${k} \\*/`, 'g'))!.length).toBe(1);
    // tiap aturan di awal baris hanya menarget kelas .mv-* atau :root (tidak menyentuh #scrim/#cnt/.card milik skill)
    const sel = [...o.css.matchAll(/^([^\s/@}][^{]*)\{/gm)].map((m) => m[1].trim());
    expect(sel.length).toBeGreaterThan(40);
    for (const s of sel) expect(s, `selector ${s}`).toMatch(/^(\.mv-|:root)/);
    expect(o.css).not.toMatch(/(^|\n)\s*#(scrim|cnt|flash)\b/);
  });

  it('HTML: id unik di seluruh dokumen, gradien logo sekali, satu scrim, urut waktu mulai', () => {
    const all = ids(o.html);
    expect(new Set(all).size).toBe(all.length);
    expect(o.html.match(/id="mv-logo-g"/g)!.length).toBe(1);
    expect(o.html.match(/id="mv-scrim"/g)!.length).toBe(1);
    const at = (id: string) => o.html.indexOf(`id="mv-${id}"`);
    expect(at('cn')).toBeGreaterThan(-1);
    expect(at('cn')).toBeLessThan(at('wf'));
    expect(at('wf')).toBeLessThan(at('lg'));
    expect(at('lg')).toBeLessThan(at('ch'));
  });

  it('adegan: chat (2-8) dan statement (7.5-10) bertumpuk jadi satu rentang; tween scrim sekali per rentang', () => {
    expect(o.scenes).toEqual([{ s: 2, e: 10 }]);
    const { calls } = run(o.js, true);
    const scrim = calls.filter((c) => c.target === '#mv-scrim');
    expect(scrim.map((c) => c.pos)).toEqual([2, 9.7]);
  });

  it('adegan terpisah tetap terpisah; jarak < 0.35 dtk digabung', () => {
    const sep = buildMotionOverlay([mk('chat', 'a', 2, 5, { scene: true }), mk('chat', 'b', 9, 12, { scene: true })]);
    expect(sep.scenes).toEqual([{ s: 2, e: 5 }, { s: 9, e: 12 }]);
    const near = buildMotionOverlay([mk('chat', 'a', 2, 5, { scene: true }), mk('statement', 'b', 5.2, 8, { scene: true })]);
    expect(near.scenes).toEqual([{ s: 2, e: 8 }]);
  });

  it('scene mengikuti sceneDefault komponen bila tidak diisi, dan scene:false menimpa', () => {
    expect(buildMotionOverlay([mk('chat', 'a', 2, 6)]).scenes).toEqual([{ s: 2, e: 6 }]); // chat: sceneDefault true
    expect(buildMotionOverlay([mk('chat', 'a', 2, 6, { scene: false })]).scenes).toEqual([]);
    expect(buildMotionOverlay([mk('statement', 'a', 2, 6)]).scenes).toEqual([]);
    expect(buildMotionOverlay([mk('statement', 'a', 2, 6)]).html).not.toContain('mv-scrim');
  });

  it('SFX gabungan terurut dan semua kategori valid', () => {
    expect(o.sfx.length).toBeGreaterThan(15);
    for (let i = 1; i < o.sfx.length; i++) expect(o.sfx[i].t).toBeGreaterThanOrEqual(o.sfx[i - 1].t);
    for (const c of o.sfx) expect(KATEGORI).toContain(c.kat);
  });

  it('kind yang belum ada dilewati tanpa error; daftar kosong = overlay kosong', () => {
    const phone = { id: 'p', kind: 'belum-ada', start: { word: 0 }, props: {}, t0: 1, t1: 4, beatTimes: [] } as unknown as ResolvedMotion;
    const empty = { html: '', css: '', js: '', sfx: [], scenes: [] };
    expect(buildMotionOverlay([phone])).toEqual(empty);
    expect(buildMotionOverlay([])).toEqual(empty);
    const mixed = buildMotionOverlay([phone, mk('toasts', 'x', 1, 4)]);
    expect(mixed.html).toContain('mv-x');
    expect(mixed.html).not.toContain('mv-p');
  });

  it('id item kembar dibuat unik; build yang gagal dilewati dan dilaporkan', () => {
    const dup = buildMotionOverlay([mk('toasts', 'same', 1, 4), mk('toasts', 'same', 5, 8)]);
    const all = ids(dup.html);
    expect(new Set(all).size).toBe(all.length);
    const bad = { ...mk('chain', 'bad', 1, 4), props: null } as unknown as ResolvedMotion;
    const errs: string[] = [];
    const ok = buildMotionOverlay([bad, mk('toasts', 'ok', 1, 4)], { onError: (it) => errs.push(it.id) });
    expect(errs).toEqual(['bad']);
    expect(ok.html).toContain('mv-ok');
    expect(ok.html).not.toContain('mv-bad');
  });

  it('deterministik: urutan input tidak mengubah keluaran', () => {
    expect(buildMotionOverlay([...items].reverse())).toEqual(o);
  });
});

// ---------- bagian 2: phone, split, bubbles, endcard, toggle, cta ----------

const posOf = (calls: Call[], needle: string, m?: Call['m']) =>
  calls.find((c) => typeof c.target === 'string' && (c.target as string).includes(needle) && (!m || c.m === m))?.pos;

describe('phone', () => {
  const comp = getComponent('phone')!;
  it('beat: notifikasi, lalu pergantian jam, lalu status; jam lewat tl.set display', () => {
    const beats = [2.4, 2.8, 3.2, 3.6, 4.0, 3.0, 3.3, 3.6, 4.2];
    const b = comp.build(mk('phone', 'ph', 2, 7, { beatTimes: beats }));
    const { calls } = run(b.js);
    for (let j = 0; j < 5; j++) expect(posOf(calls, `-n${j}`, 'fromTo')).toBe(beats[j]);
    const sets = calls.filter((c) => c.m === 'set');
    expect(sets.map((c) => c.pos).sort((a, c) => a - c)).toEqual([3.0, 3.0, 3.3, 3.3, 3.6, 3.6]);
    expect(posOf(calls, '-st', 'fromTo')).toBe(4.2);
    expect(b.sfx.filter((c) => c.kat === 'tick').map((c) => c.t)).toEqual([3.0, 3.3, 3.6]);
  });
  it('maks 4 notifikasi terlihat: yang tertua memudar saat notifikasi ke-5 masuk', () => {
    const b = comp.build(mk('phone', 'ph', 2, 8));
    const { calls } = run(b.js);
    const fade = calls.filter((c) => c.m === 'to' && c.target === '#mv-ph-n0' && c.vars.opacity === 0);
    expect(fade.length).toBe(1);
    expect(fade[0].pos).toBe(posOf(calls, '-n4', 'fromTo'));
    expect(calls.some((c) => c.target === '#mv-ph-n1' && c.vars.opacity === 0)).toBe(false);
  });
  it('dayNight menambah lapisan malam; tanpa dayNight tidak', () => {
    expect(comp.build(mk('phone', 'a', 2, 7)).html).toContain('mv-ph-night');
    const noDn = comp.build(mk('phone', 'b', 2, 7, { props: { clocks: ['08:12', '09:00'], notifs: [{ app: 'WhatsApp', text: 'x' }], dayNight: false } }));
    expect(noDn.html).not.toContain('mv-ph-night');
  });
  it('tanpa status dan tanpa jam tambahan tetap jalan', () => {
    const b = comp.build(mk('phone', 'c', 2, 5, { props: { clocks: ['08:12'], notifs: [{ app: 'IG', text: 'Halo' }] } }));
    expect(b.html).not.toContain('mv-ph-st');
    expect(() => run(b.js)).not.toThrow();
  });
});

describe('split', () => {
  const comp = getComponent('split')!;
  it('beat berurutan: kartu kiri, baris, kartu kanan, bubble kanan, awal banjir', () => {
    // 3 baris kiri + 4 bubble kanan: 1 + 3 + 1 + 4 + 1 = 10 beat
    const beats = [2.1, 2.3, 2.5, 2.7, 3.4, 3.6, 3.7, 3.8, 3.9, 4.3];
    const b = comp.build(mk('split', 'sp', 2, 8, { beatTimes: beats }));
    const { calls } = run(b.js);
    expect(calls.find((c) => c.target === '#mv-sp-l' && c.m === 'fromTo')!.pos).toBe(2.1);
    expect(posOf(calls, '-r0', 'fromTo')).toBe(2.3);
    expect(posOf(calls, '-r2', 'fromTo')).toBe(2.7);
    expect(calls.find((c) => c.target === '#mv-sp-r' && c.m === 'fromTo')!.pos).toBe(3.4);
    expect(posOf(calls, '-i3', 'fromTo')).toBe(3.9);
    expect(posOf(calls, '-f0', 'fromTo')).toBe(4.3);
    // kiri jadi abu-abu selama banjir, kanan bergaris merah
    expect(calls.some((c) => c.target === '#mv-sp-l' && c.m === 'to' && c.vars.filter === 'grayscale(1)')).toBe(true);
  });
  it('tanpa flood: tidak ada bubble banjir dan tidak ada grayscale', () => {
    const b = comp.build(mk('split', 'sp', 2, 8, { props: { left: { title: 'A', items: ['x'] }, right: { title: 'B', items: ['y'] }, flood: false } }));
    expect(b.html).not.toContain('-f0');
    expect(b.js).not.toContain('grayscale');
  });
  it('banjir lebih banyak dari slot tetap deterministik (PRNG berbenih)', () => {
    const many = { left: { title: 'A', items: [] }, right: { title: 'B', items: [] }, flood: true, bubbles: Array.from({ length: 30 }, (_, i) => `b${i}`) };
    const a = comp.build(mk('split', 'same', 2, 8, { props: many }));
    const b = comp.build(mk('split', 'same', 2, 8, { props: many }));
    expect(a).toEqual(b);
    expect(ids(a.html).filter((i) => /-f\d+$/.test(i)).length).toBe(30);
  });
});

describe('bubbles', () => {
  const comp = getComponent('bubbles')!;
  const props = (mode: 'stack' | 'loop' | 'gather' | 'flood', n = 3) => ({ mode, items: ['Harga berapa?', 'Buka jam berapa?', 'Bisa booking?', 'Ready kak?', 'Halo?'].slice(0, n) });
  it('stack: satu beat per item', () => {
    const b = comp.build(mk('bubbles', 'st', 2, 8, { props: props('stack', 4), beatTimes: [2.2, 2.9, 3.5, 4.4] }));
    const { calls } = run(b.js);
    expect([0, 1, 2, 3].map((k) => posOf(calls, `-q${k}`, 'fromTo'))).toEqual([2.2, 2.9, 3.5, 4.4]);
  });
  it('loop: 3 item masuk di beat, lalu sisa (diulang sampai 12) muncul dan bergulir + blur', () => {
    const b = comp.build(mk('bubbles', 'lp', 2, 8, { props: props('loop', 3), beatTimes: [2.2, 3.0, 3.8, 4.5] }));
    const { calls } = run(b.js);
    expect([0, 1, 2].map((k) => posOf(calls, `-q${k}`, 'fromTo'))).toEqual([2.2, 3.0, 3.8]);
    const set = calls.find((c) => c.m === 'set')!;
    expect(set.pos).toBe(4.5);
    expect((set.target as string[]).length).toBe(9);
    const scroll = calls.find((c) => c.target === '#mv-lp-ql')!;
    expect(scroll.pos).toBe(4.5);
    expect(scroll.vars.y).toBe(-118 * 9);
    expect(scroll.vars.filter).toBe('blur(3px)');
    expect(b.html).toContain('class="av"'); // avatar berhuruf
  });
  it('gather: bubble ditarik ke tengah (skala kecil, lalu hilang) mulai di beat[0]', () => {
    const b = comp.build(mk('bubbles', 'ga', 2, 8, { props: props('gather', 5), beatTimes: [3.0] }));
    const { calls } = run(b.js);
    const pull = calls.filter((c) => c.m === 'to' && typeof c.target === 'string' && /-b\d$/.test(c.target as string) && c.vars.scale === 0.3);
    expect(pull.length).toBe(5);
    expect(pull[0].pos).toBe(3.0);
    expect(b.sfx.some((c) => c.kat === 'whoosh' && c.t === 3.0)).toBe(true);
  });
  it('flood: pill muncul makin rapat dan keluar bersama', () => {
    const b = comp.build(mk('bubbles', 'fl', 2, 8, { props: props('flood', 5) }));
    const { calls } = run(b.js);
    const pops = [0, 1, 2, 3, 4].map((k) => posOf(calls, `-b${k}`, 'fromTo')!);
    for (let i = 1; i < pops.length; i++) expect(pops[i]).toBeGreaterThan(pops[i - 1]);
  });
  it('semua mode: item kosong tidak melempar', () => {
    for (const mode of ['stack', 'loop', 'gather', 'flood'] as const) expect(() => run(comp.build(mk('bubbles', 'e', 2, 6, { props: { mode, items: [] } })).js)).not.toThrow();
  });
});

describe('endcard', () => {
  const comp = getComponent('endcard')!;
  it('menyembunyikan #keys dan #caps di t0; di akhir video kartu tidak keluar', () => {
    const b = comp.build(mk('endcard', 'ec', 28, 31));
    const atEnd = run(b.js, false, 31);
    const hide = atEnd.calls.find((c) => Array.isArray(c.target) && (c.target as string[]).includes('#keys'))!;
    expect(hide.m).toBe('set');
    expect(hide.pos).toBe(28);
    expect(hide.vars.opacity).toBe(0);
    expect(atEnd.calls.filter((c) => c.target === '#mv-ec-e' && c.m === 'to')).toEqual([]);
    expect(atEnd.calls.filter((c) => c.m === 'set').length).toBe(1); // tidak ada pemulihan di akhir video
    // di tengah video: kartu keluar di t1-0.25 dan #keys/#caps dikembalikan di t1
    const mid = run(b.js, false, 60);
    expect(mid.calls.find((c) => c.target === '#mv-ec-e' && c.m === 'to')!.pos).toBe(30.75);
    const restore = mid.calls.filter((c) => c.m === 'set' && c.vars.opacity === 1);
    expect(restore.length).toBe(1);
    expect(restore[0].pos).toBe(31);
  });
  it('beat: wordmark, tagline, CTA; tanpa tagline/CTA elemennya tidak ada', () => {
    const b = comp.build(mk('endcard', 'ec', 28, 31, { beatTimes: [28.3, 28.9, 29.5] }));
    const { calls } = run(b.js, false, 31);
    expect(posOf(calls, '-w', 'fromTo')).toBe(28.3);
    expect(posOf(calls, '-s', 'fromTo')).toBe(28.42);
    expect(posOf(calls, '-g', 'fromTo')).toBe(28.9);
    expect(posOf(calls, '-c', 'fromTo')).toBe(29.5);
    const lean = comp.build(mk('endcard', 'ec2', 28, 31, { props: { title: 'MIVA' } }));
    expect(lean.html).not.toContain('mv-end-tag');
    expect(lean.html).not.toContain('mv-end-cta');
  });
});

describe('toggle', () => {
  const comp = getComponent('toggle')!;
  it('beat: coretan A lalu B masuk; A keluar saat B masuk; coretan lewat clip-path', () => {
    const b = comp.build(mk('toggle', 'tg', 2, 7, { beatTimes: [3.1, 4.2] }));
    const { calls } = run(b.js);
    expect(posOf(calls, '-x', 'fromTo')).toBe(3.1);
    expect(posOf(calls, '-bar', 'fromTo')).toBe(3.15);
    expect(calls.find((c) => c.target === '#mv-tg-b')!.pos).toBe(4.2);
    expect(calls.find((c) => c.target === '#mv-tg-a' && c.m === 'to')!.pos).toBe(4.1);
    expect(b.js).toContain('clipPath');
    expect(b.js).not.toMatch(/scaleX:\s*0/);
    expect(b.sfx.some((c) => c.kat === 'ding')).toBe(true);
  });
});

describe('cta', () => {
  const comp = getComponent('cta')!;
  it('beat: satu per pill lalu ketukan; kursor tiba sebelum ketuk, cincin menyebar', () => {
    const b = comp.build(mk('cta', 'ct', 2, 8, { beatTimes: [2.2, 2.9, 3.6, 5.0] }));
    const { calls } = run(b.js);
    expect([0, 1, 2].map((k) => posOf(calls, `-p${k}`, 'fromTo'))).toEqual([2.2, 2.9, 3.6]);
    expect(posOf(calls, '-d0', 'fromTo')).toBe(2.78);
    const cur = calls.filter((c) => c.target === '#mv-ct-cur');
    expect(cur[0].pos).toBe(4.55);
    expect(cur[1].pos).toBe(5.0);
    expect(posOf(calls, '-rip', 'fromTo')).toBe(5.0);
    expect(b.sfx.some((c) => c.kat === 'klik' && c.t === 5.0)).toBe(true);
  });
  it('tanpa tap: tidak ada kursor dan semua pill putih; dengan tap pill terakhir jadi tombol utama', () => {
    const b = comp.build(mk('cta', 'ct', 2, 6, { props: { pills: ['A', 'B'], tap: false } }));
    expect(b.html).not.toContain('mv-cta-cur');
    expect(b.html).not.toContain('mv-cta-p last');
    expect(b.html).not.toContain('class="rip"');
    const t = comp.build(mk('cta', 'ct', 2, 6, { props: { pills: ['A', 'B'], tap: true } }));
    expect(t.html).toContain('mv-cta-p last');
    expect(t.html).toContain('mv-cta-cur');
  });
});

describe('semua 13 kind dalam satu overlay (urut, dua adegan bertumpuk)', () => {
  // ~47 dtk: tiap kind sendiri-sendiri, kecuali phone (adegan) yang bertumpuk dengan statement (adegan)
  const seq: [MotionKind, number, number, Partial<ResolvedMotion>?][] = [
    ['counter', 0.5, 3.5],
    ['toasts', 1, 4],
    ['split', 4.5, 9.5],
    ['bubbles', 10, 13, { props: { mode: 'loop', items: ['Harga berapa?', 'Buka jam berapa?'] } as never }],
    ['phone', 13.2, 18, { scene: true }],
    ['statement', 17.5, 20, { scene: true }],
    ['chain', 20.5, 25],
    ['logo', 25.2, 28],
    ['chat', 28.5, 34, { scene: true }],
    ['chips', 34.5, 37],
    ['toggle', 37.2, 40],
    ['cta', 40.2, 43],
    ['endcard', 43.5, 47],
  ];
  const items = seq.map(([k, a, b, x], i) => mk(k, `k${i}`, a, b, x));
  const o = buildMotionOverlay(items, {
    onError: (it, e) => {
      throw new Error(`${it.kind}: ${String(e)}`);
    },
  });

  it('ke-13 kind ada di HTML, satu IIFE, id unik, lolos lint', () => {
    expect(new Set(items.map((i) => i.kind)).size).toBe(13);
    const all = ids(o.html);
    expect(new Set(all).size).toBe(all.length);
    for (const i of items) expect(o.html, `kind ${i.kind}`).toContain(`id="mv-${i.id}"`);
    expect(o.js.startsWith('(() => {')).toBe(true);
    expect(o.js.trimEnd().endsWith('})();')).toBe(true);
    for (const rx of BANNED) expect(o.js).not.toMatch(rx);
    const { calls, requested } = run(o.js, true, 47);
    const have = new Set(all);
    for (const r of requested) expect(have.has(r), `getElementById ${r}`).toBe(true);
    for (const c of calls) {
      if (c.m === 'fromTo') expect(c.vars.immediateRender).toBe(false);
      for (const i of selectorIds(c.target)) if (!['flash', 'keys', 'caps'].includes(i)) expect(have.has(i), `selector #${i}`).toBe(true);
    }
  });

  it('adegan: phone (13.2-18) + statement (17.5-20) digabung; chat (28.5-34) terpisah', () => {
    expect(o.scenes).toEqual([{ s: 13.2, e: 20 }, { s: 28.5, e: 34 }]);
    const { calls } = run(o.js, true, 47);
    expect(calls.filter((c) => c.target === '#mv-scrim').map((c) => c.pos)).toEqual([13.2, 19.7, 28.5, 33.7]);
  });

  it('SFX semua kategori valid, urut, dan tiap kind menyumbang minimal satu cue', () => {
    for (const c of o.sfx) expect(KATEGORI).toContain(c.kat);
    for (let i = 1; i < o.sfx.length; i++) expect(o.sfx[i].t).toBeGreaterThanOrEqual(o.sfx[i - 1].t);
    for (const [k, a, b] of seq) expect(o.sfx.some((c) => c.t >= a - 0.01 && c.t <= b + 0.01), `sfx ${k}`).toBe(true);
  });

  it('CSS tiap kind sekali dan semua selector berawalan .mv-', () => {
    for (const k of ALL_KINDS) expect(o.css.match(new RegExp(`/\\* ${k} \\*/`, 'g'))!.length, k).toBe(1);
    const sel = [...o.css.matchAll(/^([^\s/@}][^{]*)\{/gm)].map((m) => m[1].trim());
    for (const s of sel) expect(s, `selector ${s}`).toMatch(/^(\.mv-|:root)/);
  });
});

