// Penyunting field motion (src/core/motion/fieldedit.ts): kunci bersarang, tipe field generik, editor baris ramah
// (langkah chat, node rantai, chip, notifikasi HP) dengan tes bolak-balik, termasuk data hasil penerjemah brief miva-3.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProjectState } from '../../src/core/doc';
import { MOTION_COMPONENTS } from '../../src/core/motion';
import {
  fieldEditor,
  getPath,
  nodesToText,
  notifsToText,
  propsPatch,
  stepsToText,
  textToChips,
  textToNodes,
  textToNotifs,
  textToSteps,
  chipsToText,
  TONE_NAMES,
} from '../../src/core/motion/fieldedit';
import type { ChatStep, FieldSpec, MotionKind } from '../../src/core/motion/types';
import type { EditJson, RawWord } from '../../src/core/types';
import * as ops from '../../src/renderer/src/editor/ops';

const DIR = join(__dirname, '..', 'fixtures', 'briefs');
const words = JSON.parse(readFileSync(join(DIR, 'miva-3.words-raw.json'), 'utf-8')) as RawWord[];
const edit3 = JSON.parse(readFileSync(join(DIR, 'miva-3.edit.json'), 'utf-8')) as EditJson;
const brief = readFileSync(join(DIR, 'miva-3.brief.txt'), 'utf-8');

const spec = (type: FieldSpec['type'], extra: Partial<FieldSpec> = {}): FieldSpec => ({ key: 'k', label: 'K', type, ...extra });
const ed = (type: FieldSpec['type'], extra: Partial<FieldSpec> = {}) => fieldEditor('statement', spec(type, extra));
const val = (r: { ok: boolean; value?: unknown; error?: string }) => (r.ok ? r.value : `ERR:${r.error}`);

describe('kunci bersarang', () => {
  const props = { left: { title: 'A', items: ['x'], tone: 'mint' }, flood: true };

  it('getPath membaca tingkat atas, bersarang, dan jalur yang tidak ada', () => {
    expect(getPath(props, 'flood')).toBe(true);
    expect(getPath(props, 'left.title')).toBe('A');
    expect(getPath(props, 'left.items')).toEqual(['x']);
    expect(getPath(props, 'right.title')).toBeUndefined();
    expect(getPath(props, 'flood.x')).toBeUndefined();
    expect(getPath(undefined, 'a.b')).toBeUndefined();
  });

  it('propsPatch bersarang mempertahankan saudara dan tidak mengubah objek asal', () => {
    const copy = JSON.parse(JSON.stringify(props));
    const patch = propsPatch(props, 'left.title', 'B');
    expect(patch).toEqual({ left: { title: 'B', items: ['x'], tone: 'mint' } });
    expect(props).toEqual(copy);
    expect(propsPatch(props, 'right.title', 'R')).toEqual({ right: { title: 'R' } });
  });

  it('nilai undefined menghapus kunci: bersarang hanya kunci itu, tingkat atas lewat patch undefined', () => {
    expect(propsPatch(props, 'left.tone', undefined)).toEqual({ left: { title: 'A', items: ['x'] } });
    expect(propsPatch(props, 'flood', undefined)).toEqual({ flood: undefined });
    expect(propsPatch(props, 'flood', false)).toEqual({ flood: false });
  });

  it('digabung lewat updateMotion (gabung dangkal) tepat seperti yang diharapkan UI', () => {
    const d: ops.Doc = {
      edit: edit3,
      state: { version: 1, name: 't', source: 's', created: 'c', updated: 'u', duration: 60, words, keywords: [], retakes: [], floor: -50, keywordMode: 'rules' } as ProjectState,
    };
    const a = ops.addMotion(d, 'split', 1);
    const id = a.state.motion![0].id;
    const b = ops.updateMotion(a, id, { props: propsPatch(a.state.motion![0].props, 'left.title', 'TOKO') });
    const p = b.state.motion![0].props as { left: { title: string; items: string[] }; right: { title: string } };
    expect(p.left.title).toBe('TOKO');
    expect(p.left.items).toEqual(['Sales', 'Marketing', 'Team']);
    expect(p.right.title).toBe('CHAT');
  });
});

describe('field generik', () => {
  it('text: apa adanya (spasi dipertahankan), kosong tetap string kosong', () => {
    expect(val(ed('text').fromText('  halo ', ''))).toBe('  halo ');
    expect(val(ed('text').fromText('', 'x'))).toBe('');
    expect(ed('text').toText(undefined)).toBe('');
  });

  it('number: kosong = undefined, koma desimal diterima, bukan angka = error', () => {
    const e = ed('number');
    expect(val(e.fromText('', 1))).toBeUndefined();
    expect(val(e.fromText('2,5', undefined))).toBe(2.5);
    expect(val(e.fromText('abc', 1))).toMatch(/^ERR:/);
    expect(e.toText(3)).toBe('3');
  });

  it('numbers: koma, spasi, titik koma, dan panah (12 -> 27 -> 43) semuanya diterima', () => {
    const e = ed('numbers');
    expect(val(e.fromText('12, 27, 43', undefined))).toEqual([12, 27, 43]);
    expect(val(e.fromText('12 → 27 → 43', undefined))).toEqual([12, 27, 43]);
    expect(val(e.fromText('12 -> 27 -> 43', undefined))).toEqual([12, 27, 43]);
    expect(val(e.fromText('2; 4;6', undefined))).toEqual([2, 4, 6]);
    expect(val(e.fromText('0, 1.5, -2', undefined))).toEqual([0, 1.5, -2]);
    expect(val(e.fromText('12, x, 3', undefined))).toBe('ERR:"x" is not a number');
    expect(e.toText([12, 27, 43])).toBe('12, 27, 43');
    // kosong: tetap undefined kalau kuncinya memang tidak ada, daftar kosong kalau sebelumnya ada
    expect(val(e.fromText('', undefined))).toBeUndefined();
    expect(val(e.fromText('', [2]))).toEqual([]);
  });

  it('lines: satu item per baris, baris kosong dan spasi tepi dibuang', () => {
    const e = ed('lines');
    expect(val(e.fromText(' a \n\nb\r\n  c', ['z']))).toEqual(['a', 'b', 'c']);
    expect(e.toText(['a', 'b'])).toBe('a\nb');
    expect(val(e.fromText('', undefined))).toBeUndefined();
    expect(val(e.fromText('', ['z']))).toEqual([]);
  });

  it('bool, select, icon, tone', () => {
    expect(val(ed('bool').fromText('true', false))).toBe(true);
    expect(val(ed('bool').fromText('false', true))).toBe(false);
    const sel = ed('select', { options: ['serif', 'pill'] });
    expect(val(sel.fromText('pill', 'serif'))).toBe('pill');
    expect(val(sel.fromText('x', 'serif'))).toMatch(/^ERR:Pick one of: serif, pill/);
    expect(sel.options!.map((o) => o.value)).toEqual(['serif', 'pill']);
    const icon = ed('icon');
    expect(icon.options!.length).toBe(19); // (default) + 18 ikon
    expect(val(icon.fromText('bolt', undefined))).toBe('bolt');
    expect(val(icon.fromText('', 'bolt'))).toBeUndefined();
    expect(val(icon.fromText('nope', undefined))).toMatch(/^ERR:/);
    const tone = ed('tone');
    expect(tone.options!.map((o) => o.value)).toEqual(['', ...TONE_NAMES]);
    expect(val(tone.fromText('gold', undefined))).toBe('gold');
    expect(val(tone.fromText('pink', undefined))).toMatch(/^ERR:/);
  });

  it('json: bolak-balik, kosong = undefined, JSON rusak = error', () => {
    const e = ed('json');
    const v = [{ a: 1, b: ['x'] }];
    expect(val(e.fromText(e.toText(v), undefined))).toEqual(v);
    expect(val(e.fromText('  ', v))).toBeUndefined();
    expect(String(val(e.fromText('[{"a":', undefined)))).toMatch(/^ERR:Invalid JSON/);
    expect(e.toText(undefined)).toBe('');
  });

  it('kontrol UI per tipe', () => {
    expect(ed('text').control).toBe('input');
    expect(ed('number').control).toBe('number');
    expect(ed('bool').control).toBe('toggle');
    for (const t of ['select', 'icon', 'tone'] as const) expect(ed(t, { options: ['a'] }).control).toBe('select');
    for (const t of ['lines', 'numbers', 'json'] as const) expect(ed(t).control).toBe('area');
  });
});

describe('editor ramah: langkah chat', () => {
  const steps: ChatStep[] = [
    { from: 'cus', text: 'Harga berapa?' },
    { from: 'bot', text: 'Untuk paket A, harganya…' },
    { from: 'human', text: 'Aku bantu teruskan ke admin ya.' },
    { from: 'chip', text: 'LEAD', sub: 'Saved', tone: 'green' },
    { from: 'chip', text: 'FOLLOW-UP', sub: 'Scheduled' },
    { from: 'chip', text: 'ESCALATED', tone: 'amber' },
    { from: 'chip', text: 'PLAIN' },
    { from: 'clear' },
    { from: 'cus', text: 'Pesanan saya bermasalah.' },
  ];

  it('teks yang ditampilkan sesuai format yang dijelaskan', () => {
    expect(stepsToText(steps)).toBe(
      ['cus: Harga berapa?', 'bot: Untuk paket A, harganya…', 'human: Aku bantu teruskan ke admin ya.', 'chip: LEAD | Saved | green', 'chip: FOLLOW-UP | Scheduled', 'chip: ESCALATED | amber', 'chip: PLAIN', 'clear', 'cus: Pesanan saya bermasalah.'].join('\n'),
    );
  });

  it('bolak-balik: nilai -> teks -> nilai sama persis, dan teks -> nilai -> teks stabil', () => {
    const text = stepsToText(steps);
    const back = textToSteps(text);
    expect(back).toEqual({ ok: true, value: steps });
    expect(stepsToText((back as { value: ChatStep[] }).value)).toBe(text);
  });

  it('sub yang kebetulan bernama nada tidak terbaca sebagai nada', () => {
    const s: ChatStep[] = [{ from: 'chip', text: 'X', sub: 'green' }];
    expect(textToSteps(stepsToText(s))).toEqual({ ok: true, value: s });
    const s2: ChatStep[] = [{ from: 'chip', text: 'X', sub: 'red', tone: 'amber' }];
    expect(textToSteps(stepsToText(s2))).toEqual({ ok: true, value: s2 });
  });

  it('alias, huruf besar, spasi, baris kosong, dan titik dua di dalam teks', () => {
    const r = textToSteps('  Customer :  Jam berapa: buka? \n\nADMIN: oke\nMIVA: siap\nCLEAR');
    expect(r).toEqual({
      ok: true,
      value: [{ from: 'cus', text: 'Jam berapa: buka?' }, { from: 'human', text: 'oke' }, { from: 'bot', text: 'siap' }, { from: 'clear' }],
    });
    // "|" di bubble biasa adalah teks, bukan pemisah
    expect(textToSteps('bot: a | b')).toEqual({ ok: true, value: [{ from: 'bot', text: 'a | b' }] });
  });

  it('error menyebut nomor baris dan tidak menerapkan apa pun', () => {
    expect(textToSteps('cus: ok\nhalo dunia')).toEqual({ ok: false, error: 'Line 2: start with cus:, bot:, human:, chip: or clear' });
    expect(textToSteps('cus:')).toMatchObject({ ok: false, error: expect.stringContaining('Line 1') });
    expect(textToSteps('chip: A | B | nope')).toMatchObject({ ok: false, error: expect.stringContaining('unknown tone "nope"') });
    expect(textToSteps('chip: A | B | green | x')).toMatchObject({ ok: false });
    expect(textToSteps('chip: | Saved')).toMatchObject({ ok: false, error: expect.stringContaining('needs a label') });
    expect(textToSteps('  \n ')).toEqual({ ok: false, error: 'Add at least one step' });
  });

  it('dipakai oleh fieldEditor untuk chat.steps (bukan JSON mentah)', () => {
    const f = MOTION_COMPONENTS.chat!.fields.find((x) => x.key === 'steps')!;
    expect(f.type).toBe('json'); // kontrak: field aslinya JSON
    const e = fieldEditor('chat', f);
    expect(e.control).toBe('area');
    expect(e.toText(steps)).toBe(stepsToText(steps));
    expect(e.hint).toMatch(/cus:/);
  });
});

describe('editor ramah: node rantai', () => {
  const nodes = [
    { label: 'CUSTOMER', icon: 'person' },
    { label: '', icon: 'bubble' },
    { label: 'YOU', icon: 'person', tone: 'mint' },
    { label: 'MIVA', icon: 'logo', tone: 'cyan' },
    { label: 'DONE', icon: 'check', tone: 'green' },
  ];

  it('format dan bolak-balik, bubble pemisah = "| bubble"', () => {
    expect(nodesToText(nodes)).toBe('CUSTOMER | person\n| bubble\nYOU | person | mint\nMIVA | logo | cyan\nDONE | check | green');
    expect(textToNodes(nodesToText(nodes))).toEqual({ ok: true, value: nodes });
  });

  it('hanya label = ikon person; ikon/nada salah = error dengan nomor baris', () => {
    expect(textToNodes('BOSS')).toEqual({ ok: true, value: [{ label: 'BOSS', icon: 'person' }] });
    expect(textToNodes('A | person\nB | rocket')).toMatchObject({ ok: false, error: expect.stringMatching(/^Line 2: unknown icon "rocket"/) });
    expect(textToNodes('A | person | pink')).toMatchObject({ ok: false, error: expect.stringContaining('unknown tone "pink"') });
    expect(textToNodes('A | b | c | d')).toMatchObject({ ok: false });
    expect(textToNodes('')).toEqual({ ok: false, error: 'Add at least one node' });
  });

  it('morph boleh kosong (= tanpa morph), nodes tidak', () => {
    const c = MOTION_COMPONENTS.chain!.fields;
    const morph = fieldEditor('chain', c.find((f) => f.key === 'morph')!);
    const nodesEd = fieldEditor('chain', c.find((f) => f.key === 'nodes')!);
    expect(morph.fromText('', [{ label: 'A', icon: 'person' }])).toEqual({ ok: true, value: undefined });
    expect(nodesEd.fromText('', nodes)).toMatchObject({ ok: false });
  });
});

describe('editor ramah: chip dan notifikasi HP', () => {
  const chips = [
    { label: 'LEAD', sub: 'Saved', icon: 'check', tone: 'green' },
    { label: 'FOLLOW-UP', icon: 'warn', tone: 'amber' },
    { label: 'BLOCKED', sub: 'Spam', icon: 'stop', tone: 'red' },
  ];

  it('chip: label | sub | ikon | nada, bolak-balik; kolom belakang boleh dihilangkan', () => {
    expect(chipsToText(chips)).toBe('LEAD | Saved | check | green\nFOLLOW-UP | | warn | amber\nBLOCKED | Spam | stop | red');
    expect(textToChips(chipsToText(chips))).toEqual({ ok: true, value: chips });
    expect(textToChips('DONE')).toEqual({ ok: true, value: [{ label: 'DONE', icon: 'check', tone: 'green' }] });
    expect(textToChips('DONE | ok')).toEqual({ ok: true, value: [{ label: 'DONE', sub: 'ok', icon: 'check', tone: 'green' }] });
  });

  it('chip: ikon dan nada divalidasi', () => {
    expect(textToChips('A | b | circle | green')).toMatchObject({ ok: false, error: expect.stringContaining('unknown icon "circle"') });
    expect(textToChips('A | b | check | pink')).toMatchObject({ ok: false, error: expect.stringContaining('unknown tone') });
    expect(textToChips('| b')).toMatchObject({ ok: false });
    expect(textToChips('')).toEqual({ ok: false, error: 'Add at least one chip' });
  });

  it('notifikasi: app | teks, tanpa "|" = WhatsApp, "|" kedua tetap bagian teks', () => {
    const n = [{ app: 'WhatsApp', text: 'Harga berapa kak?' }, { app: 'Instagram', text: 'a | b' }];
    expect(notifsToText(n)).toBe('WhatsApp | Harga berapa kak?\nInstagram | a | b');
    expect(textToNotifs(notifsToText(n))).toEqual({ ok: true, value: n });
    expect(textToNotifs('Masih buka?')).toEqual({ ok: true, value: [{ app: 'WhatsApp', text: 'Masih buka?' }] });
    expect(textToNotifs('| tanpa app')).toEqual({ ok: true, value: [{ app: 'WhatsApp', text: 'tanpa app' }] });
    expect(textToNotifs('WhatsApp |')).toMatchObject({ ok: false, error: expect.stringContaining('Line 1') });
    expect(textToNotifs('')).toEqual({ ok: true, value: [] });
  });
});

describe('semua komponen x semua field: bolak-balik tanpa kehilangan data', () => {
  const kinds = Object.keys(MOTION_COMPONENTS) as MotionKind[];

  it('13 komponen terdaftar dan tiap field punya penyunting yang masuk akal', () => {
    expect(kinds.length).toBe(13);
    for (const k of kinds) {
      const comp = MOTION_COMPONENTS[k]!;
      expect(comp.fields.length).toBeGreaterThan(0);
      for (const f of comp.fields) {
        const e = fieldEditor(k, f);
        expect(['input', 'number', 'toggle', 'select', 'area']).toContain(e.control);
        // tidak ada field JSON mentah yang tersisa untuk bentuk yang sulit
        if (f.type === 'json') expect(e.control, `${k}.${f.key} json`).toBe('area');
      }
    }
  });

  it('props bawaan: toText -> fromText menghasilkan nilai yang sama untuk setiap field', () => {
    for (const k of kinds) {
      const comp = MOTION_COMPONENTS[k]!;
      const props = comp.defaults();
      for (const f of comp.fields) {
        const e = fieldEditor(k, f);
        const v = getPath(props, f.key);
        const r = e.fromText(e.toText(v), v);
        expect(r.ok, `${k}.${f.key}`).toBe(true);
        // toggle yang belum diisi (undefined) sama dengan mati
        if (r.ok) expect(r.value, `${k}.${f.key}`).toEqual(f.type === 'bool' ? !!v : v);
      }
    }
  });

  it('props hasil penerjemah brief miva-3 (data nyata): bolak-balik utuh dan satu perubahan field tidak mengubah yang lain', () => {
    const doc: ops.Doc = {
      edit: edit3,
      state: { version: 1, name: 't', source: 's', created: 'c', updated: 'u', duration: 60, words, keywords: [], retakes: [], floor: -50, keywordMode: 'rules' } as ProjectState,
    };
    const d = ops.generateMotion(ops.setMotionBrief(doc, brief));
    const items = d.state.motion!;
    expect(items.length).toBeGreaterThanOrEqual(9);
    let checked = 0;
    for (const it of items) {
      const comp = MOTION_COMPONENTS[it.kind]!;
      for (const f of comp.fields) {
        const e = fieldEditor(it.kind, f);
        const v = getPath(it.props, f.key);
        const r = e.fromText(e.toText(v), v);
        expect(r.ok, `${it.id} ${f.key}`).toBe(true);
        if (r.ok) expect(r.value, `${it.id} ${f.key}`).toEqual(f.type === 'bool' ? !!v : v);
        checked++;
      }
      // ubah satu field dengan nilai yang sama lewat patch: props tidak berubah sama sekali
      const f0 = comp.fields[0];
      const same = ops.updateMotion(d, it.id, { props: propsPatch(it.props, f0.key, getPath(it.props, f0.key)) });
      expect(same.state.motion!.find((m) => m.id === it.id)!.props).toEqual(it.props);
    }
    expect(checked).toBeGreaterThan(30);
  });
});
