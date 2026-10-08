// Penerjemah brief motion (Rules offline): parser, penjajaran naskah, pemilihan komponen, dan akurasi terhadap
// grafik buatan skill /reel-edit di 6 proyek nyata (tests/fixtures/briefs/*). Tabel per fixture dicetak di output tes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alignLines, alignPhrase, normToken, tokenSim, tokenize } from '../../src/core/motion/align';
import { classifyLine, parseBrief, parseMotionHeader } from '../../src/core/motion/brief';
import { briefToMotion, resolveMotion } from '../../src/core/motion/resolve';
import type { MotionItem, MotionKind } from '../../src/core/motion/types';
import type { RawWord, Seg } from '../../src/core/types';

const DIR = join(__dirname, '..', 'fixtures', 'briefs');
const read = (f: string) => readFileSync(join(DIR, f), 'utf-8');
const J = <T>(f: string): T => JSON.parse(read(f)) as T;

// tanda hubung panjang/sedang ditulis lewat kode supaya sumber tes bebas karakter itu
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const LQ = String.fromCharCode(0x201c);
const RQ = String.fromCharCode(0x201d);
const ARROW = String.fromCharCode(0x2192);
const DOWN = String.fromCharCode(0x2193);

interface TruthItem {
  kind: MotionKind;
  start: number;
  end: number;
}
interface TruthBlock {
  n: number;
  title: string;
  items: TruthItem[];
  primary: MotionKind[];
  optional: MotionKind[];
  note?: string;
}
interface Truth {
  project: string;
  speed: number;
  duration: number;
  tail: number;
  blocks: TruthBlock[];
}
interface EditFx {
  src: string;
  segs: Seg[];
  speed: number;
  tail: number;
}

const PROJECTS = ['miva-1', 'miva-2', 'miva-3', 'miva-4', 'miva-5', 'miva-6'] as const;

interface Row {
  n: number;
  title: string;
  truth: string;
  got: string;
  primaryOk: boolean;
  exact: boolean;
  err: number | null;
  review: boolean;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function runProject(name: string) {
  const brief = read(`${name}.brief.txt`);
  const words = J<RawWord[]>(`${name}.words-raw.json`);
  const edit = J<EditFx>(`${name}.edit.json`);
  const truth = J<Truth>(`${name}.truth.json`);
  const duration = edit.segs.reduce((a, [x, y]) => a + (y - x), 0) / edit.speed;
  const { items, report } = briefToMotion(brief, words, edit.segs, edit.speed, duration, { tail: edit.tail });
  const res = resolveMotion(items, words, edit.segs, edit.speed, duration, edit.tail);
  const rows: Row[] = [];
  truth.blocks.forEach((tb, i) => {
    const rb = report.blocks[i];
    const mine = res.filter((r) => rb && rb.itemIds.includes(r.id));
    const gotKinds = [...new Set(mine.map((m) => m.kind))];
    const truthKinds = [...new Set(tb.items.map((x) => x.kind))];
    const exact = truthKinds.every((k) => gotKinds.includes(k)) && gotKinds.every((k) => truthKinds.includes(k) || tb.optional.includes(k));
    const primaryOk = tb.items.length === 0 ? mine.length === 0 : mine.length > 0 && tb.primary.includes(mine[0].kind);
    let err: number | null = null;
    if (tb.items.length) {
      const matched = mine.filter((m) => truthKinds.includes(m.kind));
      const pool = matched.length ? matched : mine;
      if (pool.length) err = Math.abs(Math.min(...pool.map((m) => m.t0)) - Math.min(...tb.items.map((x) => x.start)));
      else err = Infinity;
    }
    rows.push({
      n: tb.n,
      title: tb.title || (rb ? rb.title : ''),
      truth: truthKinds.join('+') || '-',
      got: mine.map((m) => m.kind).join('+') || '-',
      primaryOk,
      exact,
      err,
      review: mine.some((m) => m.review === true),
    });
  });
  return { rows, report, items, res, words, edit, truth };
}

function table(name: string, rows: Row[]): string {
  const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
  const lines = rows.map(
    (r) =>
      `${pad(String(r.n), 3)}${pad(r.title, 26)}${pad(r.truth, 22)}${pad(r.got, 22)}${r.primaryOk ? 'ok ' : 'XX '}${r.exact ? 'set ' : 'diff'} ${
        r.err === null ? '   -' : r.err === Infinity ? ' inf' : r.err.toFixed(2).padStart(5)
      }${r.review ? '  review' : ''}`,
  );
  return `\n=== ${name} ===\nblk title                     truth                 got                   prim set   err(s)\n${lines.join('\n')}`;
}

describe('motion brief: akurasi pada brief nyata (miva-1..6)', () => {
  const results = new Map<string, ReturnType<typeof runProject>>();
  for (const p of PROJECTS) results.set(p, runProject(p));

  it('cetak tabel per fixture + ringkasan', () => {
    let out = '';
    let prim = 0;
    let tot = 0;
    const summary: string[] = [];
    for (const p of PROJECTS) {
      const { rows } = results.get(p)!;
      out += table(p, rows);
      const errs = rows.filter((r) => r.err !== null && isFinite(r.err!)).map((r) => r.err!);
      const pOk = rows.filter((r) => r.primaryOk).length;
      prim += pOk;
      tot += rows.length;
      summary.push(
        `${p}: blok=${rows.length} primer=${pOk}/${rows.length} set=${rows.filter((r) => r.exact).length}/${rows.length} err median=${median(errs).toFixed(2)} maks=${Math.max(...errs).toFixed(2)} <=1s: ${errs.filter((e) => e <= 1).length}/${errs.length}`,
      );
    }
    console.log(out + '\n\nRINGKASAN\n' + summary.join('\n') + `\nSEMUA: primer ${prim}/${tot} = ${((100 * prim) / tot).toFixed(1)}%`);
    expect(tot).toBeGreaterThan(0);
  });

  it('jumlah blok sama dengan kebenaran dasar', () => {
    for (const p of PROJECTS) {
      const { report, truth } = results.get(p)!;
      expect(report.blocks.length, p).toBe(truth.blocks.length);
    }
  });

  it('miva-3: semua blok jenis tepat, >= 80% blok mulai <= 1,0 dtk dari skill', () => {
    const { rows } = results.get('miva-3')!;
    const bad = rows.filter((r) => !r.exact).map((r) => `${r.n}:${r.truth}!=${r.got}`);
    expect(bad).toEqual([]);
    const errs = rows.map((r) => r.err as number);
    const within = errs.filter((e) => e <= 1.0).length;
    expect(within / errs.length).toBeGreaterThanOrEqual(0.8);
  });

  it('miva-3: blok per jenis sesuai pemetaan skill (M01 counter+toasts ... end card)', () => {
    const { report } = results.get('miva-3')!;
    const kinds = report.blocks.map((b) => [...new Set(b.kinds)].sort().join('+'));
    expect(kinds).toEqual([
      'counter+toasts',
      'split',
      'bubbles',
      'phone',
      'statement',
      'chain',
      'logo',
      'chat',
      'chain+endcard',
    ]);
  });

  it('akurasi jenis primer >= 80% di seluruh fixture', () => {
    let ok = 0;
    let tot = 0;
    for (const p of PROJECTS) {
      for (const r of results.get(p)!.rows) {
        tot++;
        if (r.primaryOk) ok++;
      }
    }
    expect(ok / tot).toBeGreaterThanOrEqual(0.8);
  });

  it('format mimotion/range (miva-2..6): primer >= 80% per proyek, median galat mulai <= 0,6 dtk', () => {
    for (const p of ['miva-2', 'miva-3', 'miva-4', 'miva-5', 'miva-6']) {
      const { rows } = results.get(p)!;
      expect(rows.filter((r) => r.primaryOk).length / rows.length, p).toBeGreaterThanOrEqual(0.8);
      const errs = rows.filter((r) => r.err !== null && isFinite(r.err!)).map((r) => r.err!);
      expect(median(errs), p).toBeLessThanOrEqual(0.6);
    }
  });

  it('item punya id unik, label tanpa em dash, origin rules, props lengkap', () => {
    for (const p of PROJECTS) {
      const { items } = results.get(p)!;
      const ids = new Set<string>();
      for (const it of items) {
        expect(ids.has(it.id), `${p} ${it.id}`).toBe(false);
        ids.add(it.id);
        expect(it.origin).toBe('rules');
        expect(it.label ?? '').not.toContain(EM);
        expect(it.note ?? '').toBeTypeOf('string');
        expect(it.start.word).toBeGreaterThanOrEqual(0);
        expect(it.props).toBeTruthy();
      }
    }
  });

  it('tidak ada tumpang tindih grafik besar antar-blok yang berbeda (kecuali end card)', () => {
    for (const p of PROJECTS) {
      const { res, report } = results.get(p)!;
      const blockOf = (id: string) => report.blocks.findIndex((b) => b.itemIds.includes(id));
      for (let i = 0; i < res.length; i++) {
        for (let j = i + 1; j < res.length; j++) {
          const a = res[i];
          const b = res[j];
          if (blockOf(a.id) === blockOf(b.id)) continue;
          const ov = Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0);
          expect(ov, `${p}: ${a.id} x ${b.id}`).toBeLessThanOrEqual(0.06);
        }
      }
    }
  });

  it('end card: laporan meminta edit.tail ~2,5 dtk', () => {
    for (const p of PROJECTS) {
      const { report } = results.get(p)!;
      expect(report.needsTail, p).toBeGreaterThanOrEqual(2.4);
    }
  });

  it('miva-3: nilai & teks sesuai naskah', () => {
    const { items } = results.get('miva-3')!;
    const by = (id: string) => items.find((x) => x.id === id) as MotionItem;
    const counter = by('mt-01-counter').props as { values: number[]; label: string };
    expect(counter.values).toEqual([12, 27, 43]);
    expect(counter.label).toBe('UNREAD MESSAGES');
    const toasts = by('mt-01-toasts').props as { items: string[] };
    expect(toasts.items.length).toBe(4);
    const split = by('mt-02-split').props as { left: { title: string; items: string[] }; right: { title: string }; flood?: boolean };
    expect(split.left.title).toBe('BUSINESS');
    expect(split.left.items).toEqual(['Sales', 'Marketing', 'Team']);
    expect(split.right.title).toBe('CHAT');
    expect(split.flood).toBe(true);
    const bubbles = by('mt-03-bubbles') as MotionItem & { kind: 'bubbles' };
    expect(bubbles.props.items).toEqual(['Harga berapa?', 'Buka jam berapa?', 'Bisa booking?']);
    expect(bubbles.props.mode).toBe('loop');
    expect(bubbles.beats?.length).toBe(3);
    const phone = by('mt-04-phone').props as { clocks: string[]; status?: string; dayNight?: boolean };
    expect(phone.clocks).toEqual(['08:12', '12:47', '18:36', '22:51']);
    expect(phone.status).toBe(`Still replying${String.fromCharCode(0x2026)}`);
    expect(by('mt-04-phone').scene).toBe(true);
    const st = by('mt-05-statement') as MotionItem & { kind: 'statement' };
    expect(st.props.style).toBe('serif');
    expect(st.props.flash).toBe(true);
    expect(`${st.props.line1} ${st.props.line2}`).toBe('Mungkin bukan customer-nya.');
    // sinyal kuat (PAUSE + freeze + teks besar + kutipan): pilihan komponen yakin, tidak ditandai review
    expect(st.review).toBeUndefined();
    expect(st.scene).toBe(true);
    const chain = by('mt-06-chain').props as {
      nodes: { label: string; icon: string; tone?: string }[];
      morph?: { label: string; icon: string; tone?: string }[];
      caption?: string;
      alert?: number[];
    };
    expect(chain.nodes.map((n) => [n.label, n.icon])).toEqual([
      ['CUSTOMER', 'person'],
      ['INBOX', 'bubble'],
      ['YOU', 'person'],
      ['INBOX', 'bubble'],
      ['YOU', 'person'],
      ['INBOX', 'bubble'],
    ]);
    expect(chain.morph?.map((n) => n.label)).toEqual(['CUSTOMER', 'CHAT', 'MIVA', 'DONE']);
    // simpul centang = DONE (gaya HURUF BESAR Inggris), bukan "Selesai"
    expect(chain.morph?.[3]).toEqual({ label: 'DONE', icon: 'check', tone: 'green' });
    expect(chain.morph?.[2]).toMatchObject({ label: 'MIVA', icon: 'logo' });
    expect(chain.caption).toBe('Your system should work too.');
    expect(chain.alert).toEqual([2, 4]);
    const logo = by('mt-07-logo').props as { sub?: string; tagline?: string; gather?: boolean };
    // sub = lockup merek bawaan; "Subtitle:" dari brief = tagline
    expect(logo.sub).toBe('AI AUTOMATION');
    expect(logo.tagline).toBe('AI CUSTOMER SERVICE');
    expect(logo.gather).toBe(true);
    const chat = by('mt-08-chat') as MotionItem & { kind: 'chat' };
    expect(chat.props.logo).toBe(true);
    expect(chat.props.title).toBe('MIVA AI');
    expect(chat.scene).toBe(true);
    const froms = chat.props.steps.map((s) => s.from);
    expect(froms).toEqual(['cus', 'bot', 'chip', 'chip', 'clear', 'cus', 'bot', 'chip']);
    // MOTION 09: rantai inline beremoji + morph + keterangan dari heading ###
    const end9 = by('mt-09-chain').props as {
      nodes: { label: string; icon: string }[];
      morph?: { label: string; icon: string }[];
      caption?: string;
      captionAccent?: string[];
    };
    expect(end9.nodes).toEqual([
      { label: 'YOU', icon: 'person' },
      { label: 'HP', icon: 'phone' },
      { label: 'INBOX', icon: 'bubble' },
    ]);
    expect(end9.morph).toEqual([
      { label: 'YOU', icon: 'person' },
      { label: 'BUSINESS', icon: 'briefcase' },
      { label: 'GROWTH', icon: 'chart' },
    ]);
    expect(end9.caption).toBe('Let MIVA handle the inbox.');
    expect(end9.captionAccent).toEqual(['MIVA']);
    // end card: wordmark MIVA (tanpa "AI"), lockup tetap, subtitle brief = tagline
    expect(by('mt-09-endcard').props).toEqual({
      title: 'MIVA',
      sub: 'AI AUTOMATION',
      tagline: 'AI Customer Service',
      cta: 'Chat nomor di BIO',
    });
  });

  it('miva-3: tag <pasted_content> dan kutip pembungkus diabaikan di mana pun (dengan atau tanpa)', () => {
    const base = read('miva-3.brief.txt');
    expect(base).toContain('<pasted_content');
    const words = J<RawWord[]>('miva-3.words-raw.json');
    const edit = J<EditFx>('miva-3.edit.json');
    const dur = edit.segs.reduce((a, [x, y]) => a + (y - x), 0) / edit.speed;
    const run = (t: string) => briefToMotion(t, words, edit.segs, edit.speed, dur, { tail: edit.tail }).items;
    const ref = JSON.stringify(run(base));
    // tanpa tag dan tanpa kutip pembungkus
    const bare = base
      .split('\n')
      .filter((l) => !/pasted_content/.test(l) && l.trim() !== '"')
      .join('\n')
      .replace(/^"(?=\u201c)/m, '');
    expect(JSON.stringify(run(bare))).toBe(ref);
    // tag menempel di baris yang sama + kutip penutup menempel di baris terakhir
    const glued = base.replace('<pasted_content id="030b">\n', '<pasted_content id="030b">').replace('**Chat nomor di BIO**\n"\n</pasted_content id="030b">', '**Chat nomor di BIO**"</pasted_content id="030b">');
    expect(JSON.stringify(run(glued))).toBe(ref);
    // tag ganda / berulang di tengah teks
    const noisy = base.replace('**[MOTION 05', '</pasted_content id="x">\n"\n<pasted_content id="y">\n**[MOTION 05');
    expect(JSON.stringify(run(noisy))).toBe(ref);
    const p = parseBrief(base);
    const all = [...p.preamble, ...p.blocks.flatMap((b) => [...b.lines, ...b.tail])].map((l) => l.raw).join('\n');
    expect(all).not.toMatch(/pasted_content/);
    expect(all.split('\n').filter((l) => l.trim() === '"').length).toBe(0);
  });
});

describe('motion brief: parser', () => {
  it('header MOTION dengan em dash, en dash, hyphen, titik dua, durasi', () => {
    const variants = [
      `**[MOTION 01 ${EM} HOOK | 2 detik]**`,
      `**[MOTION 01 ${EN} HOOK | 2 detik]**`,
      '**[MOTION 01 - HOOK | 2 detik]**',
      '**[MOTION 01: HOOK | 2 detik]**',
      '[MOTION 01 - HOOK | 2 detik]',
      '### [MOTION 01 - HOOK | 2 detik]',
      '**MOTION 01 - HOOK | 2 detik**',
    ];
    for (const v of variants) {
      const h = parseMotionHeader(v);
      expect(h, v).not.toBeNull();
      expect(h!.type).toBe('motion');
      expect(h!.num).toBe(1);
      expect(h!.title).toBe('HOOK');
      expect(h!.dur).toEqual([2, 2]);
    }
  });

  it('header tanpa judul, rentang durasi, PAUSE | 1.5 detik, END CARD', () => {
    expect(parseMotionHeader(`**[MOTION 02 ${EM} 2 detik]**`)).toMatchObject({ num: 2, title: '', dur: [2, 2] });
    expect(parseMotionHeader(`**[MOTION 04 ${EM} 2${EN}3 detik]**`)).toMatchObject({ num: 4, title: '', dur: [2, 3] });
    expect(parseMotionHeader(`**[MOTION 05 ${EM} PAUSE | 1.5 detik]**`)).toMatchObject({ num: 5, title: 'PAUSE', dur: [1.5, 1.5] });
    expect(parseMotionHeader(`**[MOTION 06 ${EM} PUNCHLINE | 2${EN}3 detik]**`)).toMatchObject({ title: 'PUNCHLINE', dur: [2, 3] });
    expect(parseMotionHeader(`**[END CARD ${EM} 1.5 detik]**`)).toMatchObject({ type: 'endcard', title: 'END CARD', dur: [1.5, 1.5] });
    expect(parseMotionHeader(`**[MOTION 03 ${EM} MIVA REVEAL | 2 detik]**`)).toMatchObject({ title: 'MIVA REVEAL' });
  });

  it('header rentang waktu [0-3s] dan bukan-header', () => {
    expect(parseMotionHeader(`**[0${EN}3s]**`)).toMatchObject({ type: 'range', rangeSec: [0, 3] });
    expect(parseMotionHeader('[12-16 detik]')).toMatchObject({ type: 'range', rangeSec: [12, 16] });
    expect(parseMotionHeader('Talking head tetap terlihat.')).toBeNull();
    expect(parseMotionHeader('**NEW MESSAGE**')).toBeNull();
    expect(parseMotionHeader('Motion: tampilan WhatsApp')).toBeNull();
  });

  it('blok, naskah sebelum blok pertama dan ekor kandidat naskah', () => {
    const text = [
      `${LQ}Kalau kamu punya bisnis tapi masih pegang HP terus${RQ}`,
      '',
      `**[MOTION 01 ${EM} HOOK | 2 detik]**`,
      'Talking head tetap terlihat.',
      '**NEW MESSAGE**',
      '**NEW MESSAGE**',
      `Tambahkan counter:`,
      `**12 ${ARROW} 27 ${ARROW} 43 unread messages**`,
      'Mungkin kamu bukan lagi sibuk ngurus bisnis.',
      '',
      '**[MOTION 02 - 2 detik]**',
      'Visual split:',
      'Kiri:',
      '**BUSINESS**',
    ].join('\n');
    const p = parseBrief(text);
    expect(p.format).toBe('motion');
    expect(p.preamble.length).toBe(1);
    expect(p.blocks.length).toBe(2);
    expect(p.blocks[0].title).toBe('HOOK');
    expect(p.blocks[0].lines.map((l) => l.text)).toContain('NEW MESSAGE');
    expect(p.blocks[0].tail.map((l) => l.text)).toEqual(['Mungkin kamu bukan lagi sibuk ngurus bisnis.']);
    expect(p.blocks[1].num).toBe(2);
    expect(p.blocks[1].title).toBe('');
    expect(p.blocks[1].tail).toEqual([]);
  });

  it('klasifikasi baris: tebal, kutipan melengkung, panah, emoji, huruf besar, jam, label pembicara', () => {
    expect(classifyLine('**NEW MESSAGE**')).toMatchObject({ bold: true, caps: true, strong: true });
    expect(classifyLine(`${LQ}**Harga berapa?**${RQ}`).quotes).toEqual(['Harga berapa?']);
    expect(classifyLine(`**${LQ}Still replying...${RQ}**`)).toMatchObject({ quoteOnly: true, bold: true });
    expect(classifyLine(`${DOWN}`)).toMatchObject({ arrow: true });
    expect(classifyLine('\u{1F4E6} Sales').emoji).toBe(true);
    expect(classifyLine(`**08:12 ${ARROW} 12:47 ${ARROW} 18:36**`)).toMatchObject({ clock: true, arrow: true });
    expect(classifyLine('Customer:')).toMatchObject({ speaker: 'customer', colon: true });
    expect(classifyLine(`MIVA: ${LQ}Halo kak${RQ}`)).toMatchObject({ speaker: 'miva', speakerRest: `${LQ}Halo kak${RQ}` });
    // kalimat naskah biasa tidak dianggap isi motion
    for (const t of ['Mungkin kamu bukan lagi sibuk ngurus bisnis.', 'Ini alasan gue bikin MIVA.', 'Dan akhirnya, kamu nggak bisa benar-benar lepas dari HP.']) {
      expect(classifyLine(t).strong, t).toBe(false);
    }
  });

  it('format rentang [0-3s] dengan VO dan Motion', () => {
    const text = [
      `**[0${EN}3s]**`,
      `\u{1F399}️ **VO:** ${LQ}Customer kamu nggak peduli kalau jam kerja kamu udah selesai.${RQ}`,
      '',
      '\u{1F3AC} **Motion:**',
      'Jam berubah cepat:',
      `**23:00 ${ARROW} 01:00 ${ARROW} SUNDAY**`,
      '---',
      `**[3${EN}7s]**`,
      '\u{1F399}️ **VO:**',
      `${LQ}Satu.`,
      `Dua.${RQ}`,
      '\u{1F3AC} **Motion:**',
      `Text besar: **${LQ}Halo${RQ}**`,
    ].join('\n');
    const p = parseBrief(text);
    expect(p.format).toBe('range');
    expect(p.blocks.length).toBe(2);
    expect(p.blocks[0].rangeSec).toEqual([0, 3]);
    expect(p.blocks[0].script).toEqual(['Customer kamu nggak peduli kalau jam kerja kamu udah selesai.']);
    expect(p.blocks[0].lines.map((l) => l.text).join('|')).toContain('SUNDAY');
    expect(p.blocks[1].script).toEqual(['Satu.', 'Dua.']);
    expect(p.blocks[1].lines.length).toBe(1);
  });

  it('format seksi ### dengan VO, label pembicara, dan kutipan lanjutan VO', () => {
    const p = parseBrief(read('miva-1.brief.txt'));
    expect(p.format).toBe('section');
    expect(p.blocks.length).toBe(11);
    expect(p.blocks[0].title).toBe('HOOK');
    expect(p.blocks[0].script[0]).toContain('males kalau dibales');
    const popup = p.blocks[1];
    expect(popup.lines.filter((l) => l.speaker).map((l) => l.speaker)).toEqual(['calon pembeli', 'bisnis owner']);
    expect(popup.script).toEqual(['Pertanyaannya cuma satu kalimat…', 'Jawabannya satu paragraf.']);
    expect(p.blocks[8].script.length).toBe(3);
  });

  it('noise tempelan (@path, /reel-edit, pasted_content, kutip pembungkus) tidak jadi isi', () => {
    const p = parseBrief(read('miva-3.brief.txt'));
    expect(p.format).toBe('motion');
    expect(p.blocks.length).toBe(9);
    expect(p.preamble.map((l) => l.text).join(' ')).not.toMatch(/reel-edit|pasted_content|MP4/);
    expect(p.preamble.length).toBe(1);
  });

  it('brief chatbot-bertele (skrip sama dengan miva-1) terbaca sebagai 11 seksi', () => {
    const a = parseBrief(read('chatbot-bertele.brief.txt'));
    const b = parseBrief(read('miva-1.brief.txt'));
    expect(a.blocks.map((x) => x.title)).toEqual(b.blocks.map((x) => x.title));
  });

  it('teks tanpa blok: format plain, tanpa item, ada peringatan', () => {
    const { items, report } = briefToMotion('Halo ini naskah biasa tanpa blok motion.', [{ w: 'halo', s: 0, e: 0.3 }], [[0, 2]], 1, 2);
    expect(items).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(0);
  });
});

describe('motion brief: penjajaran fuzzy', () => {
  const words = (s: string): RawWord[] => s.split(' ').map((w, i) => ({ w, s: i * 0.3, e: i * 0.3 + 0.25 }));

  it('normalisasi varian Indonesia', () => {
    expect(normToken('Ngurus,')).toBe(normToken('urus'));
    expect(normToken('nggak')).toBe(normToken('gak'));
    expect(normToken('Ga')).toBe(normToken('nggak'));
    expect(normToken('saja')).toBe(normToken('aja'));
    expect(normToken('MiFA.')).toBe('miva');
    expect(tokenize('inbox-nya, benar-benar')).toEqual(['inboxnya', 'benar', 'benar']);
    expect(tokenSim('bisnisnya', 'bisnis')).toBeGreaterThan(0.8);
    expect(tokenSim('bales', 'balas')).toBeGreaterThanOrEqual(0.8);
    expect(tokenSim('ke', 'di')).toBe(0);
  });

  it('baris improvisasi tetap terjajar, urutan monoton, baris deskripsi tidak', () => {
    const w = words('Kalau kamu punya bisnis tapi masih harus pegang HP terus buat balas customer mungkin kamu bukan lagi sibuk urus bisnis tapi malah sibuk urus inbox');
    const lines = [
      'Kalau kamu punya bisnis tapi masih harus pegang HP terus buat balas customer…',
      'Tahan sebentar sebelum punchline berikutnya.',
      'Mungkin kamu bukan lagi sibuk ngurus bisnis.',
      'Tapi sibuk ngurusin inbox.',
    ];
    const a = alignLines(lines, w);
    expect(a[0]).not.toBeNull();
    expect(a[0]!.from).toBe(0);
    expect(a[0]!.to).toBe(12);
    expect(a[1]).toBeNull();
    expect(a[2]).not.toBeNull();
    expect(a[2]!.from).toBe(13);
    expect(a[3]).not.toBeNull();
    expect(a[3]!.from).toBeGreaterThan(a[2]!.to);
  });

  it('kutipan layar yang tidak diucapkan tidak menempel ke kata acak', () => {
    const w = words('itu artinya sistem customer service kamu belum bisa kerja sendiri');
    expect(alignPhrase('Mungkin bukan customer-nya.', w, 0, w.length - 1)).toBeNull();
    const w2 = words('harganya berapa buka jam berapa bisa booking');
    expect(alignPhrase('Harga berapa?', w2, 0, 6)?.from).toBe(0);
    expect(alignPhrase('Buka jam berapa?', w2, 0, 6)?.from).toBe(2);
  });
});
