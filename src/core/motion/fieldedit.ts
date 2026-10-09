// Penyunting field motion untuk UI (murni, tanpa DOM/React, jadi bisa dites di vitest).
//   getPath / propsPatch   baca dan tulis kunci bersarang ("left.title") sebagai patch tingkat atas untuk updateMotion
//   fieldEditor            teks <-> nilai props per FieldSpec; error ditampilkan inline dan nilai tidak diterapkan
//   editor ramah           baris teks untuk bentuk yang terlalu sulit sebagai JSON: langkah chat, node rantai, chip, notifikasi HP
//
// Format baris (satu item per baris, baris kosong diabaikan):
//   chat.steps    cus: Harga berapa?  |  bot: Untuk paket A...  |  human: ...  |  chip: LEAD | Saved | green  |  clear
//   chain.nodes   CUSTOMER | person  |  YOU | person | mint  |  | bubble (bubble pemisah tanpa label)
//   chips.items   LEAD | Saved | check | green     (label | sub | ikon | nada)
//   phone.notifs  WhatsApp | Harga berapa kak?     (app | teks)
import { ICON_NAMES } from './icons';
import { TONES } from './runtime';
import type { ChainNode, ChatFrom, ChatStep, ChipItem, FieldSpec, IconName, MotionKind, PhoneNotif, Tone } from './types';

export type Parsed<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (error: string): Parsed<never> => ({ ok: false, error });

export const TONE_NAMES = Object.keys(TONES) as Tone[];
export const CHIP_ICONS = ['check', 'warn', 'stop'] as const;
type ChipIcon = (typeof CHIP_ICONS)[number];

// ---------- kunci bersarang ----------

/** Nilai di `key` ("a.b.c") atau undefined bila jalurnya tidak ada. */
export function getPath(obj: unknown, key: string): unknown {
  let cur: unknown = obj;
  for (const k of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * Patch tingkat atas untuk `updateMotion` (gabung dangkal): menulis `value` di `key`, saudaranya di objek bersarang dipertahankan.
 * `value` undefined menghapus kunci itu (di tingkat atas: updateMotion menghapusnya; bersarang: dihapus dari salinan objeknya).
 */
export function propsPatch(props: unknown, key: string, value: unknown): Record<string, unknown> {
  const path = key.split('.');
  const setIn = (node: unknown, i: number): unknown => {
    if (i === path.length) return value;
    const base = node && typeof node === 'object' && !Array.isArray(node) ? { ...(node as Record<string, unknown>) } : {};
    const next = setIn(base[path[i]], i + 1);
    if (next === undefined) delete base[path[i]];
    else base[path[i]] = next;
    return base;
  };
  const top = path[0];
  return { [top]: setIn((props as Record<string, unknown> | undefined)?.[top], 1) };
}

// ---------- editor generik ----------

export interface FieldOption {
  value: string;
  label: string;
}
export interface FieldEditor {
  control: 'input' | 'number' | 'toggle' | 'select' | 'area';
  options?: FieldOption[];
  rows?: number;
  placeholder?: string;
  hint?: string;
  /** nilai props -> teks di kotak */
  toText(value: unknown): string;
  /** teks -> nilai props. `prev` = nilai sekarang (daftar kosong tetap undefined kalau kuncinya memang tidak ada) */
  fromText(text: string, prev: unknown): Parsed;
}

const strOf = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const splitLines = (t: string): string[] =>
  t
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

function numbersFromText(t: string): Parsed<number[]> {
  // "12 → 27 → 43", "12, 27, 43", "12 27 43" semuanya boleh
  const tokens = t
    .replace(/→|->|=>|>/g, ',')
    .split(/[\s,;]+/)
    .filter(Boolean);
  const out: number[] = [];
  for (const tok of tokens) {
    const n = Number(tok.replace(',', '.'));
    if (!Number.isFinite(n)) return bad(`"${tok}" is not a number`);
    out.push(n);
  }
  return ok(out);
}

function base(spec: FieldSpec): FieldEditor {
  const hint = spec.hint;
  switch (spec.type) {
    case 'text':
      return { control: 'input', hint, toText: strOf, fromText: (t) => ok(t) };
    case 'number':
      return {
        control: 'number',
        hint,
        toText: (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''),
        fromText: (t) => {
          if (!t.trim()) return ok(undefined);
          const n = Number(t.replace(',', '.'));
          return Number.isFinite(n) ? ok(n) : bad('Enter a number');
        },
      };
    case 'numbers':
      return {
        control: 'area',
        rows: 2,
        placeholder: '12, 27, 43',
        hint: hint ?? 'Numbers separated by commas (arrows work too)',
        toText: (v) => (Array.isArray(v) ? v.join(', ') : ''),
        fromText: (t, prev) => {
          const r = numbersFromText(t);
          if (!r.ok) return r;
          return r.value.length || prev !== undefined ? r : ok(undefined);
        },
      };
    case 'bool':
      return { control: 'toggle', hint, toText: (v) => (v ? 'true' : 'false'), fromText: (t) => ok(t === 'true') };
    case 'select': {
      const options = (spec.options ?? []).map((o) => ({ value: o, label: o }));
      return {
        control: 'select',
        options,
        hint,
        toText: strOf,
        fromText: (t) => (options.some((o) => o.value === t) ? ok(t) : bad(`Pick one of: ${options.map((o) => o.value).join(', ')}`)),
      };
    }
    case 'icon':
    case 'tone': {
      const names: string[] = spec.type === 'icon' ? (ICON_NAMES as string[]) : TONE_NAMES;
      const options = [{ value: '', label: '(default)' }, ...names.map((o) => ({ value: o, label: o }))];
      return {
        control: 'select',
        options,
        hint,
        toText: strOf,
        fromText: (t) => (t === '' ? ok(undefined) : names.includes(t) ? ok(t) : bad(`Pick one of: ${names.join(', ')}`)),
      };
    }
    case 'lines':
      return {
        control: 'area',
        rows: 4,
        hint: hint ?? 'One per line',
        toText: (v) => (Array.isArray(v) ? v.map(strOf).join('\n') : ''),
        fromText: (t, prev) => {
          const l = splitLines(t);
          return l.length || prev !== undefined ? ok(l) : ok(undefined);
        },
      };
    case 'json':
    default:
      return {
        control: 'area',
        rows: 8,
        hint,
        toText: (v) => (v === undefined ? '' : JSON.stringify(v, null, 2)),
        fromText: (t) => {
          if (!t.trim()) return ok(undefined);
          try {
            return ok(JSON.parse(t) as unknown);
          } catch (e) {
            return bad(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      };
  }
}

// ---------- editor ramah ----------

const lineErr = (n: number, msg: string) => bad(`Line ${n}: ${msg}`);
const tonesHint = TONE_NAMES.join(', ');

const FROM_ALIAS: Record<string, ChatFrom> = {
  cus: 'cus', customer: 'cus', user: 'cus',
  bot: 'bot', ai: 'bot', miva: 'bot',
  human: 'human', admin: 'human',
  chip: 'chip', clear: 'clear',
};

export function stepsToText(steps: unknown): string {
  if (!Array.isArray(steps)) return '';
  return (steps as ChatStep[])
    .map((s) => {
      if (s.from === 'clear') return 'clear';
      if (s.from === 'chip') {
        const parts = [s.text ?? ''];
        // sub yang kebetulan bernama nada tetap 3 kolom supaya tidak terbaca sebagai nada
        if (s.sub) parts.push(s.sub, ...(s.tone ? [s.tone] : TONE_NAMES.includes(s.sub as Tone) ? [''] : []));
        else if (s.tone) parts.push(s.tone);
        return `chip: ${parts.join(' | ')}`;
      }
      return `${s.from}: ${s.text ?? ''}`;
    })
    .join('\n');
}

export function textToSteps(text: string): Parsed<ChatStep[]> {
  const out: ChatStep[] = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line) continue;
    const m = /^([A-Za-z]+)\s*(?::\s*(.*))?$/.exec(line);
    const from = m ? FROM_ALIAS[m[1].toLowerCase()] : undefined;
    if (!m || !from) return lineErr(i + 1, 'start with cus:, bot:, human:, chip: or clear');
    const body = (m[2] ?? '').trim();
    if (from === 'clear') {
      out.push({ from: 'clear' });
      continue;
    }
    if (!body) return lineErr(i + 1, `"${m[1]}" needs some text after the colon`);
    if (from !== 'chip') {
      out.push({ from, text: body });
      continue;
    }
    const parts = body.split('|').map((s) => s.trim());
    if (parts.length > 3) return lineErr(i + 1, 'a chip is "LABEL | sub | tone"');
    const label = parts[0];
    if (!label) return lineErr(i + 1, 'the chip needs a label');
    let sub = '';
    let tone = '';
    if (parts.length === 2) {
      if (TONE_NAMES.includes(parts[1] as Tone)) tone = parts[1];
      else sub = parts[1];
    } else if (parts.length === 3) {
      sub = parts[1];
      tone = parts[2];
    }
    if (tone && !TONE_NAMES.includes(tone as Tone)) return lineErr(i + 1, `unknown tone "${tone}" (use ${tonesHint})`);
    out.push({ from: 'chip', text: label, ...(sub ? { sub } : {}), ...(tone ? { tone: tone as Tone } : {}) });
  }
  return out.length ? ok(out) : bad('Add at least one step');
}

export function nodesToText(nodes: unknown): string {
  if (!Array.isArray(nodes)) return '';
  return (nodes as ChainNode[])
    .map((n) => [n.label ?? '', n.icon, ...(n.tone ? [n.tone] : [])].join(' | ').trim())
    .join('\n');
}

export function textToNodes(text: string): Parsed<ChainNode[]> {
  const out: ChainNode[] = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length > 3) return lineErr(i + 1, 'a node is "LABEL | icon | tone"');
    const icon = parts[1] || 'person';
    if (!(ICON_NAMES as string[]).includes(icon)) return lineErr(i + 1, `unknown icon "${icon}" (use ${ICON_NAMES.join(', ')})`);
    const tone = parts[2] ?? '';
    if (tone && !TONE_NAMES.includes(tone as Tone)) return lineErr(i + 1, `unknown tone "${tone}" (use ${tonesHint})`);
    out.push({ label: parts[0], icon: icon as IconName, ...(tone ? { tone: tone as Tone } : {}) });
  }
  return out.length ? ok(out) : bad('Add at least one node');
}

export function chipsToText(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return (items as ChipItem[]).map((c) => [c.label, c.sub ?? '', c.icon, c.tone].join(' | ').replace(/ {2,}/g, ' ')).join('\n');
}

export function textToChips(text: string): Parsed<ChipItem[]> {
  const out: ChipItem[] = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length > 4) return lineErr(i + 1, 'a chip is "LABEL | sub | icon | tone"');
    if (!parts[0]) return lineErr(i + 1, 'the chip needs a label');
    const icon = parts[2] || 'check';
    if (!(CHIP_ICONS as readonly string[]).includes(icon)) return lineErr(i + 1, `unknown icon "${icon}" (use ${CHIP_ICONS.join(', ')})`);
    const tone = parts[3] || 'green';
    if (!TONE_NAMES.includes(tone as Tone)) return lineErr(i + 1, `unknown tone "${tone}" (use ${tonesHint})`);
    out.push({ label: parts[0], ...(parts[1] ? { sub: parts[1] } : {}), icon: icon as ChipIcon, tone: tone as Tone });
  }
  return out.length ? ok(out) : bad('Add at least one chip');
}

export function notifsToText(notifs: unknown): string {
  if (!Array.isArray(notifs)) return '';
  return (notifs as PhoneNotif[]).map((n) => `${n.app} | ${n.text}`).join('\n');
}

export function textToNotifs(text: string): Parsed<PhoneNotif[]> {
  const out: PhoneNotif[] = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line) continue;
    const cut = line.indexOf('|');
    const app = cut < 0 ? '' : line.slice(0, cut).trim();
    const msg = (cut < 0 ? line : line.slice(cut + 1)).trim();
    if (!msg) return lineErr(i + 1, 'the notification needs a text after "|"');
    out.push({ app: app || 'WhatsApp', text: msg });
  }
  return ok(out);
}

const FRIENDLY: Record<string, Omit<FieldEditor, 'control'> & { rows: number }> = {
  'chat.steps': {
    rows: 8,
    placeholder: 'cus: Harga berapa?\nbot: Untuk paket A, harganya...\nchip: LEAD | Saved | green\nclear',
    hint: 'One step per line: cus: text, bot: text, human: text, chip: LABEL | sub | tone, or clear (next case). One step = one beat.',
    toText: stepsToText,
    fromText: (t) => textToSteps(t),
  },
  'chain.nodes': {
    rows: 6,
    placeholder: 'CUSTOMER | person\n| bubble\nYOU | person | mint',
    hint: 'One node per line: LABEL | icon | tone (tone optional). A line "| bubble" is a small separator bubble.',
    toText: nodesToText,
    fromText: (t) => textToNodes(t),
  },
  'chain.morph': {
    rows: 6,
    placeholder: 'CUSTOMER | person\nMIVA | logo | cyan\nDONE | check | green',
    hint: 'Same format as the nodes. Leave empty for no morph.',
    toText: nodesToText,
    fromText: (t) => (t.trim() ? textToNodes(t) : ok(undefined)),
  },
  'chips.items': {
    rows: 4,
    placeholder: 'LEAD | Saved | check | green\nFOLLOW-UP | Scheduled | check | green',
    hint: 'One chip per line: LABEL | sub | icon | tone. Icons: check, warn, stop.',
    toText: chipsToText,
    fromText: (t) => textToChips(t),
  },
  'phone.notifs': {
    rows: 5,
    placeholder: 'WhatsApp | Harga berapa kak?\nWhatsApp | Masih buka?',
    hint: 'One notification per line: app | text. They arrive one per beat (4 visible at most).',
    toText: notifsToText,
    fromText: (t) => textToNotifs(t),
  },
};

/** Penyunting satu field komponen: bentuk ramah untuk langkah chat / node rantai / chip / notifikasi HP, selain itu menurut tipe field. */
export function fieldEditor(kind: MotionKind, spec: FieldSpec): FieldEditor {
  const f = FRIENDLY[`${kind}.${spec.key}`];
  if (f) return { control: 'area', ...f };
  return base(spec);
}
