// Rules offline: isi satu blok brief -> draf item motion (jenis + props lengkap sesuai kontrak types.ts). Tahap 3 dari 4.
//
// Tanpa LLM dan tanpa jaringan. Sinyal yang dipakai: judul blok, kata kunci deskripsi ("notification", "split", "chat bubble"),
// struktur (kutipan, teks tebal, panah, daftar, urutan jam, deret angka) dan label pembicara. Satu blok boleh menghasilkan
// beberapa item (mis. counter + toasts). Blok yang tak dikenali jatuh ke statement pill dengan `review: true`.
import type {
  ChainNode,
  ChatStep,
  ChipItem,
  IconName,
  MotionKind,
  MotionPropsMap,
  Tone,
} from './types';
import { type BriefBlock, type BriefLine, stripEmoji } from './brief';

export type Phase = 'start' | 'late' | 'after' | 'tail';

export interface Draft<K extends MotionKind = MotionKind> {
  kind: K;
  props: MotionPropsMap[K];
  /** indeks baris pemicu di blok (urutan item) */
  at: number;
  phase: Phase;
  scene?: boolean;
  review?: boolean;
  /** durasi tampil yang diminta header ("PAUSE | 1.5 detik") */
  hold?: number;
  /** teks yang bisa ditambatkan ke kata yang diucapkan (beats) */
  beatQuotes?: string[];
  warn?: string[];
}

export interface RuleOptions {
  isLast: boolean;
  /** baris deskripsi dari ekor blok (tidak terjajar ke transkrip) */
  extra?: BriefLine[];
}

// ---------- kamus ----------

const EMOJI_INFO: Record<string, { icon: IconName; label: string }> = {
  '\u{1F4AC}': { icon: 'bubble', label: 'Chat' },
  '\u{1F4F1}': { icon: 'phone', label: 'HP' },
  '\u{1F4C8}': { icon: 'chart', label: 'Growth' },
  '\u{1F4CA}': { icon: 'chart', label: 'Report' },
  '\u{1F4E6}': { icon: 'box', label: 'Order' },
  '\u{1F465}': { icon: 'team', label: 'Team' },
  '\u{1F464}': { icon: 'person', label: 'Orang' },
  '✓': { icon: 'check', label: 'Done' },
  '✔': { icon: 'check', label: 'Done' },
  '✅': { icon: 'check', label: 'Done' },
  '\u{1F525}': { icon: 'bolt', label: 'Lead' },
  '❓': { icon: 'bubble', label: 'Tanya' },
  '\u{1F4CD}': { icon: 'chart', label: 'Source' },
  '\u{1F4CB}': { icon: 'team', label: 'Lead' },
  '\u{1F504}': { icon: 'calendar', label: 'Follow-up' },
  '\u{1F4B0}': { icon: 'money', label: 'Sales' },
  '\u{1F6D2}': { icon: 'cart', label: 'Cart' },
  '\u{1F4C5}': { icon: 'calendar', label: 'Jadwal' },
  '⏰': { icon: 'clock', label: 'Jam' },
  '⚠': { icon: 'warn', label: 'Peringatan' },
  '\u{1F634}': { icon: 'clock', label: 'Tidur' },
};

const ICON_RULES: [RegExp, IconName][] = [
  [/\bdata\b|insight|dashboard|report|source|traffic|growth|revenue|omzet|profit|statistik/i, 'chart'],
  [/miva|\bai\b|\bbot\b/i, 'logo'],
  [/\bbusiness\b|bisnis|\btoko\b|usaha|company/i, 'briefcase'],
  [/\binbox\b/i, 'inbox'],
  [/\bleads?\b|prospect|\bteam\b|\btim\b/i, 'team'],
  [/customer|pelanggan|buyer|pembeli|\byou\b|\bowner\b|\bkamu\b|\buser\b|human|admin|manusia|orang|person/i, 'person'],
  [/done|selesai|outcome|answered|saved|resolved|success|berhasil/i, 'check'],
  [/follow|jadwal|schedule|booking|calendar/i, 'calendar'],
  [/wait|24\s*\/\s*7|\bjam\b|clock|\btime\b|menunggu/i, 'clock'],
  [/question|faq|chat|message|pesan|tanya|reply|balas/i, 'bubble'],
  [/\bhp\b|phone|ponsel|whatsapp|\bwa\b/i, 'phone'],
  [/order|produk|product|stok|paket|\bbox\b/i, 'box'],
  [/money|uang|sales|harga|price|bayar/i, 'money'],
  [/\bcart\b|keranjang|checkout/i, 'cart'],
  [/alert|warn|miss|bocor|leak|error/i, 'warn'],
  [/\bstar\b|rating/i, 'star'],
  [/love|heart|trust/i, 'heart'],
  [/bolt|fast|cepat/i, 'bolt'],
];

/** Label simpul rantai untuk simpul yang hanya berisi emoji (gaya HURUF BESAR Inggris seperti rantai di skill). */
const NODE_LABEL: Record<string, string> = {
  '\u{1F4F1}': 'HP',
  '\u{1F4AC}': 'CHAT',
  '\u{1F4C8}': 'GROWTH',
  '\u{1F4CA}': 'DATA',
  '\u{1F4E6}': 'PRODUK',
  '\u{1F465}': 'TEAM',
  '\u{1F464}': 'USER',
  '✓': 'DONE',
  '✔': 'DONE',
  '✅': 'DONE',
  '\u{1F525}': 'LEAD',
  '❓': 'TANYA',
  '\u{1F4CD}': 'SOURCE',
  '\u{1F4CB}': 'LEAD',
  '\u{1F504}': 'FOLLOW-UP',
  '\u{1F4B0}': 'SALES',
  '\u{1F6D2}': 'CART',
  '\u{1F4C5}': 'JADWAL',
  '⏰': 'JAM',
  '⚠': 'WARN',
  '\u{1F634}': 'TIDUR',
};

/** Label simpul dari emoji; deretan 💬 (>= 3) berarti banyak chat = INBOX. */
export function emojiNodeLabel(emoji: string, count = 1): string {
  if (emoji === '\u{1F4AC}' && count >= 3) return 'INBOX';
  return NODE_LABEL[emoji] ?? (EMOJI_INFO[emoji] ? EMOJI_INFO[emoji].label.toUpperCase() : 'ITEM');
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

function emojiOf(s: string): string | null {
  for (const ch of s) if (EMOJI_INFO[ch]) return ch;
  return null;
}

function iconFor(label: string, emoji?: string | null): IconName {
  for (const [re, ic] of ICON_RULES) if (re.test(label)) return ic;
  if (emoji && EMOJI_INFO[emoji]) return EMOJI_INFO[emoji].icon;
  return 'bubble';
}

/** Lockup merek di bawah wordmark (bawaan komponen logo & end card). */
export const BRAND_SUB = 'AI AUTOMATION';

/** Wordmark: "MIVA AI" -> "MIVA" (kata AI ada di lockup, bukan di wordmark). */
export function wordmark(s: string): string {
  const t = s.trim();
  return /^miva\s+ai$/i.test(t) ? 'MIVA' : t;
}

const CTA_WORD = /^(comment|komen|komentar|dm|follow|save|simpan|share|bagikan|klik|click|tap|link|chat|chat in bio|link in bio|chat nomor di bio|try|coba|subscribe)\b/i;

// ---------- util ----------

const clean = (s: string) => stripEmoji(s).replace(/[:]+\s*$/, '').replace(/\s+/g, ' ').trim();
const lc = (s: string) => s.toLowerCase();

/** Rapikan spasi ujung kutipan layar. */
function trimDot(s: string): string {
  return s.replace(/\s+$/, '');
}

function mask(s: string): { text: string; quotes: string[] } {
  const quotes: string[] = [];
  const text = s.replace(/[“"«„][^“”"«»„]+?[”"»‟]/g, (m) => {
    quotes.push(m);
    return `\u0001${quotes.length - 1}\u0001`;
  });
  return { text, quotes };
}

const ARROW_SPLIT = /\s*(?:→|↓|↑|⇒|⇨|➜|➔|➡|⬇|⬆|-->|->|=>)\s*/;

/** Pecah teks di panah (di luar kutipan). */
function splitArrows(s: string): string[] {
  const m = mask(s);
  return m.text
    .split(ARROW_SPLIT)
    .map((p) => p.replace(/\u0001(\d+)\u0001/g, (_x, i) => m.quotes[+i]).trim())
    .filter((p) => p.length > 0);
}

const isArrowOnly = (l: BriefLine) => /^[\s→↓↑⇒⇨➜➔➡⬇⬆|>-]+$/.test(l.text) && l.arrow;

// ---------- konteks ----------

interface Ctx {
  b: BriefBlock;
  L: BriefLine[];
  used: boolean[];
  title: string;
  text: string;
  isLast: boolean;
  drafts: Draft[];
}

function push<K extends MotionKind>(c: Ctx, d: Draft<K>): void {
  c.drafts.push(d as Draft);
}

const unusedIdx = (c: Ctx) => c.L.map((_l, i) => i).filter((i) => !c.used[i]);

function markUsed(c: Ctx, ...idx: number[]): void {
  for (const i of idx) if (i >= 0 && i < c.used.length) c.used[i] = true;
}

/** Cue teks sebelum baris i: baris tak terpakai/terpakai terdekat di atas (maks 2) digabung. */
function cueBefore(c: Ctx, i: number): string {
  const parts: string[] = [];
  for (let k = i - 1; k >= 0 && k >= i - 2; k--) parts.unshift(c.L[k].text);
  return lc(parts.join(' '));
}

// ---------- aturan ----------

function ruleEndcard(c: Ctx): void {
  const { b, L } = c;
  let from = -1;
  if (b.type === 'endcard') from = 0;
  else {
    const i = L.findIndex((l) => /end\s*card/i.test(l.text) && !c.used[L.indexOf(l)]);
    if (i >= 0) from = i + (/end\s*card\s*:?\s*$/i.test(L[i].text) ? 1 : 0);
  }
  let viaLast = false;
  if (from < 0 && c.isLast) {
    const hasLogo = /\blogo\b/i.test(c.text);
    const hasBio = /\bbio\b/i.test(c.text);
    if ((hasLogo && hasBio) || /end frame|closing/i.test(c.text)) {
      from = Math.max(
        0,
        L.findIndex((l) => /end frame|logo|closing|teks besar|text besar/i.test(l.text)),
      );
      viaLast = true;
    }
  }
  if (from < 0) return;

  let title = '';
  let subtitle = '';
  let quoteTag = '';
  let cta = '';
  let pending = '';
  const touched: number[] = [];
  for (let i = from; i < L.length; i++) {
    const l = L[i];
    const q = l.quotes[0];
    const t = clean(l.text);
    if (!t) continue;
    // "Subtitle:" / "Small text:" memberi nilai di baris yang sama atau baris berikutnya
    const lm = /^(logo|sub(?:title|text)?|tagline|small text|teks kecil|cta)\s*:\s*(.*)$/i.exec(l.text.replace(/\*\*/g, '').trim());
    const assign = (key: string, val: string) => {
      const v = clean(val).replace(/[.]+$/, '');
      if (!v) return;
      if (key === 'logo') title = v;
      else if (key.startsWith('sub') || key === 'tagline') subtitle = v;
      else cta = v;
    };
    if (lm) {
      if (lm[2].trim()) assign(lm[1].toLowerCase(), lm[2]);
      else pending = lm[1].toLowerCase();
      touched.push(i);
      continue;
    }
    if (pending) {
      assign(pending, q ?? l.text.replace(/\*\*/g, ''));
      pending = '';
      touched.push(i);
      continue;
    }
    if (/\bbio\b/i.test(t) && !cta) {
      cta = clean(q ?? t.replace(/^.*?(chat nomor di bio|chat in bio)/i, '$1')).replace(/[.]+$/, '');
      if (/^(small text|cta|teks kecil)/i.test(cta)) cta = cta.replace(/^[^:]+:\s*/, '');
      touched.push(i);
    } else if (q && !quoteTag && !/\bbio\b/i.test(q)) {
      quoteTag = trimDot(q);
      touched.push(i);
    } else if (/\bmiva\b/i.test(t) && !title && t.length <= 24 && !/logo|muncul|end frame/i.test(t)) {
      title = t.replace(/^(logo)\s*:?\s*/i, '');
      touched.push(i);
    } else if (l.italic && !subtitle) {
      subtitle = t;
      touched.push(i);
    } else if (/^[A-Z][A-Za-z ]{6,60}$/.test(t) && /service|assistant|whatsapp|customer/i.test(t) && !subtitle && !t.endsWith(':')) {
      subtitle = t;
      touched.push(i);
    }
  }
  // wordmark "MIVA AI" -> "MIVA"; `sub` = lockup merek; subtitle/kutipan brief -> tagline
  const props: MotionPropsMap['endcard'] = { title: wordmark(title || 'MIVA'), sub: BRAND_SUB };
  const tag = subtitle || quoteTag;
  if (tag) props.tagline = tag;
  if (cta) props.cta = cta;
  // blok terakhir dengan kursor/tap -> pill CTA terpisah di depan end card
  if (viaLast && cta && /cursor|\btap\b|klik/i.test(c.text)) {
    push(c, { kind: 'cta', props: { pills: [cta.toUpperCase()], tap: true }, at: from, phase: 'start' });
  }
  push(c, { kind: 'endcard', props, at: 1000 + from, phase: 'tail' });
  markUsed(c, ...touched);
  // semua baris dari penanda end card ke bawah dianggap milik end card (bukan item lain)
  if (!viaLast) for (let i = from; i < L.length; i++) c.used[i] = true;
  else c.used.fill(true, from);
}

function ruleToggle(c: Ctx): void {
  const { L } = c;
  const xi = L.findIndex((l, i) => !c.used[i] && /[❌✗✘✕✖]/.test(l.text) && !/chat|reply/i.test(l.text));
  if (xi < 0) return;
  const oi = L.findIndex((l, i) => i > xi && !c.used[i] && /[✓✔✅]/.test(l.text));
  if (oi < 0) return;
  const from = clean(L[xi].text.replace(/[❌✗✘✕✖]/g, ''));
  const to = clean(L[oi].text.replace(/[✓✔✅]/g, ''));
  if (!from || !to) return;
  push(c, { kind: 'toggle', props: { from, to }, at: xi, phase: 'start' });
  markUsed(c, xi, oi);
  for (let i = xi + 1; i < oi; i++) if (!c.L[i].strong || /berubah|menjadi/i.test(c.L[i].text)) c.used[i] = true;
}

function ruleCta(c: Ctx): void {
  const { L } = c;
  const idx = unusedIdx(c);
  const titleCta = /\bcta\b/i.test(c.title);
  // label pendek (tebal/kapital) yang semuanya kosakata ajakan
  const cand = idx.filter((i) => {
    const l = L[i];
    if (l.quotes.length || l.speaker) return false;
    const t = clean(l.text);
    return (l.bold || l.caps) && t.length <= 24 && CTA_WORD.test(t) && !/^chat\s*$/i.test(t);
  });
  const hasFlowOfCta = cand.length >= 2 || (titleCta && cand.length >= 1);
  if (!hasFlowOfCta) return;
  const pills = cand.map((i) => clean(L[i].text));
  let tap = false;
  const first = cand[0];
  markUsed(c, ...cand);
  // heading penutup ("Kemudian fokus ke: ### TRY MIVA") jadi pill terakhir bertanda tap
  const last = cand[cand.length - 1];
  for (let i = last + 1; i < L.length; i++) {
    const l = L[i];
    if (c.used[i]) continue;
    if (l.arrow && isArrowOnly(l)) {
      c.used[i] = true;
      continue;
    }
    if ((l.heading || l.bold) && !l.colon && clean(l.text).length <= 24) {
      pills.push(clean(l.text));
      tap = true;
      c.used[i] = true;
      break;
    }
  }
  for (let i = first; i <= last; i++) if (isArrowOnly(L[i]) || /^(lalu|kemudian)\b/i.test(L[i].text)) c.used[i] = true;
  // pill penutup berupa heading ("### TRY MIVA") atau ajakan "coba" = kursor tap di pill terakhir
  if (L[cand[cand.length - 1]].heading || /^(try|coba)\b/i.test(pills[pills.length - 1]) || /\btap\b|kursor|cursor/i.test(c.text)) tap = true;
  push(c, { kind: 'cta', props: { pills, tap }, at: first, phase: 'start' });
}

function ruleSplit(c: Ctx): void {
  const { L } = c;
  const hasKiri = L.findIndex((l, i) => !c.used[i] && /^kiri\b/i.test(clean(l.text)));
  const pipeLine = L.findIndex((l, i) => !c.used[i] && l.bold && (l.text.match(/\|/g) ?? []).length === 1 && !l.quotes.length);
  const splitWord = /split|berdampingan|side by side/i.test(c.text);
  if (hasKiri < 0 && !(splitWord && pipeLine >= 0) && !/split screen/i.test(c.text)) return;
  if (hasKiri < 0 && pipeLine < 0 && !/split screen/i.test(c.text)) return;

  const side = (start: number, stopRe: RegExp): { title: string; items: string[]; end: number; emojiOnly: boolean } => {
    let title = '';
    const items: string[] = [];
    let emojiOnly = false;
    let end = start;
    for (let i = start + 1; i < L.length; i++) {
      const l = L[i];
      const t = clean(l.text);
      if (/^(kanan|kiri)\b/i.test(t) || stopRe.test(l.text)) break;
      if (/^(lalu|kemudian|muncul|tampilkan|setelah|selanjutnya|sisi|buat|tambahkan)\b/i.test(t)) break;
      if (!l.strong) break;
      end = i;
      if (!title && (l.bold || l.caps) && !l.quotes.length) {
        title = t;
        continue;
      }
      if (l.quotes.length) {
        for (const q of l.quotes) items.push(q);
        continue;
      }
      if (l.emoji && !t) {
        emojiOnly = true;
        continue;
      }
      if (t) items.push(t);
      else emojiOnly = true;
    }
    return { title, items, end, emojiOnly };
  };

  let left: { title: string; items: string[] } = { title: '', items: [] };
  let right: { title: string; items: string[] } = { title: '', items: [] };
  let flood = /menutupi|penuh|membanjir|membanjiri|flood|banjir/i.test(c.text);
  let at = hasKiri;
  const touched: number[] = [];
  if (hasKiri >= 0) {
    const kananIdx = L.findIndex((l, i) => i > hasKiri && !c.used[i] && /^kanan\b/i.test(clean(l.text)));
    const l1 = side(hasKiri, /^kanan\b/i);
    left = l1;
    for (let i = hasKiri; i <= l1.end; i++) touched.push(i);
    if (kananIdx >= 0) {
      const r1 = side(kananIdx, /^kiri\b/i);
      right = r1;
      for (let i = kananIdx; i <= r1.end; i++) touched.push(i);
      if (r1.emojiOnly && !r1.items.length) flood = flood || true;
    }
    // "Kiri: **A** ... Kanan: **B**" tanpa baris label terpisah
  } else if (pipeLine >= 0) {
    const parts = L[pipeLine].text.split('|').map((p) => p.trim());
    const mk = (p: string) => ({ title: clean(p) || p, items: [] as string[] });
    left = mk(parts[0]);
    right = mk(parts[1]);
    const em = (p: string) => emojiOf(p);
    const li = em(parts[0]);
    const ri = em(parts[1]);
    if (li) left.items.push(EMOJI_INFO[li].label);
    if (ri) right.items.push(EMOJI_INFO[ri].label);
    touched.push(pipeLine);
    at = pipeLine;
  } else {
    // "Split screen: **AI** + **HUMAN**"
    const si = L.findIndex((l, i) => !c.used[i] && /split screen/i.test(l.text));
    if (si < 0) return;
    let raw = L[si].raw;
    const nextLine = L[si + 1];
    if (nextLine && !c.used[si + 1] && nextLine.raw.includes('**')) raw += ' ' + nextLine.raw;
    const bolds = [...raw.matchAll(/\*\*(.+?)\*\*/g)].map((m) => clean(m[1])).filter(Boolean);
    if (bolds.length >= 2) {
      left = { title: bolds[0], items: [] };
      right = { title: bolds[1], items: [] };
      touched.push(si);
      if (nextLine && raw.includes(nextLine.raw)) touched.push(si + 1);
      at = si;
    } else return;
  }
  if (!left.title && !right.title) return;
  const tone = (t: string, dflt: Tone): Tone => (/robot|manual|lama|old|before|owner|tidur|business|chat/i.test(t) && dflt === 'dark' ? 'red' : dflt);
  const props: MotionPropsMap['split'] = {
    left: { title: left.title || 'KIRI', items: left.items, tone: tone(left.title, 'dark') === 'red' && !/business/i.test(left.title) ? 'red' : 'dark' },
    right: { title: right.title || 'KANAN', items: right.items, tone: /miva|ai|human|baru|new/i.test(right.title) ? 'mint' : 'dark' },
  };
  if (/miva/i.test(right.title)) props.right.tone = 'mint';
  if (flood) {
    props.flood = true;
    props.bubbles = ['Harga berapa?', 'Masih ready?', 'Bisa kirim hari ini?', 'Buka jam berapa?', 'Bisa booking?', 'Ongkir ke Bandung?'];
  }
  push(c, {
    kind: 'split',
    props,
    at,
    phase: 'start',
    scene: /split screen|screen/i.test(c.text),
    beatQuotes: [...left.items, ...right.items].filter((x) => x.length > 3),
  });
  markUsed(c, ...touched);
  const lastT = touched.length ? Math.max(...touched) : at;
  // "Sisi CHAT semakin penuh ..." dan sejenisnya masih bagian deskripsi split
  for (let i = lastT + 1; i < L.length; i++) {
    if (/^sisi\b/i.test(L[i].text)) c.used[i] = true;
    else break;
  }
}

function clockTokens(s: string): string[] {
  const re = /\b\d{1,2}[:.]\d{2}\b(?:\s*[\u2013\u2014-]\s*\d{1,2}[:.]\d{2}\b)?/g;
  return (s.match(re) ?? []).map((x) => x.replace(/\s+/g, ''));
}

const DAY_RE = /^(senin|selasa|rabu|kamis|jumat|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;

function rulePhone(c: Ctx): void {
  const { L } = c;
  const idx = unusedIdx(c).filter((i) => L[i].clock);
  if (!idx.length) return;
  let clocks: string[] = [];
  const touched: number[] = [];
  let at = idx[0];
  for (const i of idx) {
    const segs = splitArrows(L[i].text);
    const tokens = clockTokens(L[i].text);
    if (segs.length >= 2 && tokens.length >= 1) {
      // urutan segmen: jam atau nama hari
      const seq = segs
        .map((s) => {
          const ct = clockTokens(s);
          if (ct.length) return ct.join(' ');
          const w = clean(s);
          return DAY_RE.test(w) ? w.toUpperCase() : '';
        })
        .filter(Boolean);
      if (seq.length >= 2) {
        clocks = clocks.concat(seq);
        touched.push(i);
        continue;
      }
    }
    if (tokens.length >= 2) {
      clocks = clocks.concat(tokens);
      touched.push(i);
    }
  }
  if (clocks.length < 2) return;
  markUsed(c, ...touched);
  at = Math.min(at, ...touched);
  // status & notifikasi dari kutipan
  let status: string | undefined;
  const notifs: { app: string; text: string }[] = [];
  const leftover = unusedIdx(c);
  for (const i of leftover) {
    const l = L[i];
    if (!l.quotes.length) continue;
    // teks besar / keterangan bukan notifikasi: biarkan untuk aturan statement
    const own = (cueBefore(c, i) + ' ' + l.text.replace(/[“"][^”"]*[”"]/g, '')).toLowerCase();
    const isStatus = (q: string) => /replying|typing|menunggu|waiting|no reply|belum dibalas|…$|\.\.\.$/i.test(q);
    if (/teks besar|text besar|big text/.test(own) && !l.quotes.some(isStatus)) continue;
    for (const q of l.quotes) {
      if (isStatus(q) && !status) status = q;
      else notifs.push({ app: 'WhatsApp', text: q });
    }
    c.used[i] = true;
  }
  const defaults = [
    { app: 'WhatsApp', text: 'Kak, masih ready?' },
    { app: 'WhatsApp', text: 'Bisa kirim hari ini?' },
    { app: 'WhatsApp', text: 'Harga berapa?' },
    { app: 'WhatsApp', text: 'Kak, kok belum dibalas?' },
  ];
  const hours = clocks.map((x) => parseInt(x.split(/[:.]/)[0], 10)).filter((n) => !isNaN(n));
  const dayNight = hours.some((h) => h >= 6 && h <= 12) && hours.some((h) => h >= 18 || h <= 4);
  const props: MotionPropsMap['phone'] = { clocks, notifs: notifs.length ? notifs : defaults, dayNight };
  if (status) props.status = status;
  push(c, { kind: 'phone', props, at, phase: 'start', scene: true, beatQuotes: notifs.map((n) => n.text) });
}

interface CounterSeg {
  num: number;
  pre: string;
  post: string;
  pct: boolean;
}

function parseCounterSeg(seg: string): CounterSeg | null {
  const t = stripEmoji(seg.replace(/\*\*/g, '')).trim();
  if (CLOCKISH.test(t)) return null;
  const m = /^(?:([^\d]*?)\s*)?(\d+(?:[.,]\d+)?)\s*(%|\+)?(?:\s+(.*))?$/.exec(t);
  if (!m) return null;
  if (/^(detik|dtk|sec|s)\b/i.test(m[4] ?? '')) return null;
  return { num: parseFloat(m[2].replace(',', '.')), pre: (m[1] ?? '').trim(), post: (m[4] ?? '').trim(), pct: m[3] === '%' };
}

const CLOCKISH = /\d{1,2}[:.]\d{2}/;

function ruleCounter(c: Ctx): void {
  const { L } = c;
  const found: { i: number; segs: CounterSeg[] }[] = [];
  for (const i of unusedIdx(c)) {
    const l = L[i];
    if (!l.arrow || l.clock) continue;
    const parts = splitArrows(l.text);
    if (parts.length < 2) continue;
    const segs = parts.map(parseCounterSeg);
    const nums = segs.filter((s): s is CounterSeg => !!s);
    if (nums.length >= 2 && nums.length >= parts.length - 1) found.push({ i, segs: nums });
  }
  if (found.length) {
    const f = found[0];
    const values = f.segs.map((s) => s.num);
    const pct = f.segs.some((s) => s.pct);
    let label = '';
    for (const s of [...f.segs].reverse()) {
      if (s.post) {
        label = s.post;
        break;
      }
    }
    if (!label) label = f.segs.find((s) => s.pre)?.pre ?? '';
    label = label.replace(/[:]+$/, '').trim();
    if (pct) label = (label ? label + ' ' : '') + '%';
    label = label.toUpperCase();
    push(c, { kind: 'counter', props: counterProps(label, values), at: f.i, phase: 'start' });
    markUsed(c, f.i);
    // "Inbox awal: 17 UNANSWERED" yang mendahului deret ikut terpakai
    for (const i of unusedIdx(c)) {
      const seg = parseCounterSeg(L[i].text);
      if (seg && i < f.i && seg.num === values[0] && L[i].bold) c.used[i] = true;
    }
    return;
  }
  // "Counter ... **“100 Chats”** muncul"
  for (const i of unusedIdx(c)) {
    const l = L[i];
    if (!/counter/i.test(l.text) && !(i > 0 && /counter/i.test(L[i - 1].text))) continue;
    const q = l.quotes[0] ?? '';
    const seg = parseCounterSeg(q);
    if (seg) {
      const label = (seg.post || seg.pre).toUpperCase();
      push(c, { kind: 'counter', props: counterProps(label, [seg.num]), at: i, phase: 'start' });
      markUsed(c, i);
      return;
    }
  }
}

function counterProps(label: string, values: number[]): MotionPropsMap['counter'] {
  const l = label.toLowerCase();
  let icon: IconName = 'bolt';
  if (/unread|message|chat|pesan/.test(l)) icon = 'phone';
  else if (/unanswered|inbox/.test(l)) icon = 'inbox';
  else if (/trust|percaya/.test(l)) icon = 'heart';
  else if (/lead/.test(l)) icon = 'team';
  else if (/view|like|follow/.test(l)) icon = 'star';
  const last = values[values.length - 1];
  let tone: Tone = 'mint';
  if (last === 0) tone = 'green';
  else if (/unread|unanswered|message|pesan|chat/.test(l)) tone = 'red';
  else if (last < values[0]) tone = 'amber';
  return { label, icon, tone, values };
}

// ---------- alur (chat / chain) ----------

interface FNode {
  label: string;
  emoji: string | null;
  quote?: string;
  check?: boolean;
  warn?: boolean;
  sub?: string;
  line: number;
  weak?: boolean;
  /** simpul hanya berisi emoji: label dari kamus, ikon dari emoji */
  emojiOnly?: boolean;
  count?: number;
}

interface Flow {
  nodes: FNode[];
  /** didahului penanda "menjadi/berubah" */
  morph: boolean;
}

const SPEAKER_FROM: [RegExp, 'cus' | 'bot' | 'human'][] = [
  [/^(customer|pelanggan|calon pembeli|calon klien|calon customer|pembeli|klien|user)$/i, 'cus'],
  [/^(miva(\s+ai)?|ai|bot|asisten)$/i, 'bot'],
  [/^(admin|human admin|human|penjual|bisnis owner|owner|manusia)$/i, 'human'],
];

function fromOf(label: string): 'cus' | 'bot' | 'human' | null {
  const t = clean(label).replace(/\s*✓.*$/, '');
  for (const [re, f] of SPEAKER_FROM) if (re.test(t)) return f;
  return null;
}

const ENTITIES = ['miva', 'admin', 'human', 'customer', 'pelanggan', 'owner', 'bot', 'lead', 'inbox', 'bisnis', 'business', 'you', 'kamu', 'hp'];

function entityOf(t: string): string | null {
  for (const e of ENTITIES) if (new RegExp('\\b' + e + '\\b', 'i').test(t)) return e.toUpperCase();
  return null;
}

/**
 * Label simpul dari satu segmen di antara panah. `strictLine` = baris tebal/kapital berisi label pendek (rantai resmi);
 * kalau tidak, baris dianggap kalimat naratif dan hanya teks tebal atau kata entitas (MIVA, CUSTOMER, ...) yang dipakai.
 */
function labelFromSegment(
  seg: string,
  strictLine: boolean,
): { label: string; weak: boolean; emojiOnly?: boolean; emoji?: string; count?: number } | null {
  const bold = [...seg.matchAll(/\*\*(.+?)\*\*/g)].map((m) => clean(m[1])).filter(Boolean);
  const t = clean(seg.replace(/\*\*/g, ''));
  if (!t) {
    // segmen berisi emoji saja (📱, 💬💬💬, 📈, ✓): label dari kamus
    const em = emojiOf(seg);
    if (!em) return null;
    const count = countChar(seg, em);
    return { label: emojiNodeLabel(em, count), weak: false, emojiOnly: true, emoji: em, count };
  }
  if (strictLine) return t.split(/\s+/).length <= 5 ? { label: t, weak: false } : null;
  if (bold.length) return { label: bold[0], weak: true };
  const ent = entityOf(t);
  if (ent) return { label: ent, weak: true };
  return null;
}

/** Bangun alur dari baris tak terpakai: simpul (label/emoji/kutipan/centang) yang disambung panah. */
function buildFlows(c: Ctx): { flows: Flow[]; usedLines: number[]; loop: boolean } {
  const { L } = c;
  const flows: Flow[] = [];
  const usedLines: number[] = [];
  let loop = false;
  let cur: FNode[] = [];
  let morphNext = false;
  let afterArrow = false;
  const close = () => {
    if (cur.length) flows.push({ nodes: cur, morph: morphNext });
    if (cur.length) morphNext = false;
    cur = [];
    afterArrow = false;
  };
  const addNode = (n: FNode) => {
    cur.push(n);
    afterArrow = false;
  };
  for (const i of unusedIdx(c)) {
    const l = L[i];
    const t = clean(l.text);
    // sela deskripsi yang memutus alur
    if (!l.strong || (l.colon && !l.bold && !l.quotes.length)) {
      if (/menjadi|berubah|jadi\b/i.test(l.text)) {
        close();
        morphNext = true;
        usedLines.push(i);
      } else if (!l.strong) {
        close();
      } else {
        close();
        if (/menjadi|berubah/i.test(l.text)) morphNext = true;
      }
      continue;
    }
    if (isArrowOnly(l)) {
      afterArrow = true;
      usedLines.push(i);
      continue;
    }
    // baris dengan panah di dalam teks
    if (l.arrow && !l.speaker) {
      // kalimat naratif dengan kutipan status ("... -> status “No reply” -> ...") bukan rantai: biarkan untuk chat
      if (l.quotes.length && /status|label|indicator/i.test(mask(l.text).text)) {
        close();
        continue;
      }
      const parts = splitArrows(l.raw.replace(/^\s*#+\s*/, '').replace(/^\s*[*•-]\s+(?!\*)/, ''));
      const strictLine = (l.bold || l.caps) && parts.every((p) => clean(p.replace(/\*\*/g, '')).split(/\s+/).length <= 5);
      const segs = parts.map((p) => ({ raw: p, lab: labelFromSegment(p, strictLine) }));
      // buang segmen berlabel sama dengan segmen sebelumnya (mis. "Human Admin" lalu "ADMIN")
      const ok = segs.filter((s, k) => {
        if (!s.lab) return false;
        const prev = segs.slice(0, k).reverse().find((x) => x.lab);
        if (prev && !strictLine && lc(prev.lab!.label).includes(lc(s.lab.label))) {
          s.lab = null;
          return false;
        }
        return true;
      });
      if (ok.length >= 2 && new Set(ok.map((s) => lc(s.lab!.label))).size === 1) {
        loop = true;
        usedLines.push(i);
        continue;
      }
      if (ok.length >= 2) {
        if (cur.length && !afterArrow) close();
        for (const s of segs) {
          if (!s.lab) continue;
          if (s.lab.emojiOnly) {
            addNode({ label: '', emoji: s.lab.emoji!, count: s.lab.count, emojiOnly: true, line: i, check: /[✓✔✅]/.test(s.raw) || undefined });
          } else {
            const em = emojiOf(s.raw);
            addNode({ label: s.lab.label, emoji: em, line: i, weak: s.lab.weak, check: /[✓✔✅]/.test(s.raw) || undefined });
          }
          afterArrow = true;
        }
        afterArrow = false;
        usedLines.push(i);
        continue;
      }
    }
    // centang / peringatan sesudah label tanpa panah -> atribut simpul sebelumnya
    const hasCheck = /[✓✔✅]/.test(l.text);
    const hasWarn = /[⚠❌✗]/.test(l.text);
    if (cur.length && !afterArrow && (hasCheck || hasWarn) && t.split(/\s+/).length <= 3 && !l.bold) {
      const last = cur[cur.length - 1];
      last.check = hasCheck || undefined;
      last.warn = hasWarn || undefined;
      const sub = clean(l.text.replace(/[✓✔✅⚠❌]/g, ''));
      if (sub) last.sub = sub;
      usedLines.push(i);
      continue;
    }
    // kutipan: menempel pada simpul sebelumnya (tanpa panah) atau jadi simpul pesan
    if (l.quotes.length && !l.speaker) {
      const q = l.quotes[0];
      const emojiOnlyBefore = clean(l.text.replace(/[“"][^”"]*[”"]/g, '')) === '';
      if (cur.length && !afterArrow && !cur[cur.length - 1].quote && (emojiOnlyBefore || l.quoteOnly)) {
        cur[cur.length - 1].quote = q;
        usedLines.push(i);
        continue;
      }
      if (afterArrow && cur.length) {
        addNode({ label: '', emoji: emojiOf(l.text), quote: q, line: i });
        usedLines.push(i);
        continue;
      }
      // kutipan lepas di luar alur (teks besar, status, dll): biarkan untuk aturan lain
      close();
      continue;
    }
    if (l.speaker) {
      // "MIVA: “...”" ditangani aturan percakapan; di sini cukup putuskan alur
      close();
      continue;
    }
    // simpul label: tebal / kapital / emoji pendek
    if ((l.bold || l.caps || l.emoji || l.heading) && t.split(/\s+/).length <= 4) {
      // label berakhir titik dua ("Text kecil:") atau "Muncul: ISI" memutus alur, bukan simpul
      if (l.colon || /^[A-Za-z ]{2,20}:\s+\S/.test(t)) {
        close();
        continue;
      }
      const em = emojiOf(l.text);
      const lab = t;
      if (cur.length && !afterArrow) {
        // dua label tanpa panah: label baru memulai alur baru
        close();
      }
      const emojiOnly = !lab && !!em;
      addNode({
        label: lab,
        emoji: em,
        line: i,
        check: /[✓✔✅]/.test(l.text) || undefined,
        emojiOnly: emojiOnly || undefined,
        count: em ? countChar(l.text, em) : undefined,
      });
      usedLines.push(i);
      continue;
    }
    close();
  }
  close();
  return { flows, usedLines, loop };
}

const isHuman = (label: string) => /human|admin|penjual|owner/i.test(label);

function chainNode(n: FNode, c?: { miva?: boolean }): ChainNode {
  let label = n.label;
  if (!label && n.emoji) label = emojiNodeLabel(n.emoji, n.count ?? 1);
  if (!label && n.check) label = 'DONE';
  if (!label) label = '...';
  let icon: IconName;
  if (n.check && n.emojiOnly) icon = 'check';
  else if (n.emojiOnly && n.emoji && EMOJI_INFO[n.emoji]) icon = EMOJI_INFO[n.emoji].icon;
  else icon = n.check && !n.label ? 'check' : iconFor(label, n.emoji);
  const node: ChainNode = { label, icon };
  if (/^miva/i.test(label) || (c?.miva && icon === 'logo')) node.tone = 'mint';
  else if (icon === 'check') node.tone = 'green';
  return node;
}

function chatFromFlows(c: Ctx, flows: Flow[]): { events: { at: number; step: ChatStep }[]; usedFlow: number[] } {
  const events: { at: number; step: ChatStep }[] = [];
  const usedFlow: number[] = [];
  flows.forEach((f, fi) => {
    const hasQuote = f.nodes.some((n) => n.quote);
    if (!hasQuote) return;
    // alur dialog = ada pembicara dikenal, atau minimal dua simpul bersambung panah
    if (!f.nodes.some((n) => n.quote && fromOf(n.label)) && f.nodes.length < 2) return;
    usedFlow.push(fi);
    if (fi > 0 && events.length) events.push({ at: f.nodes[0].line - 0.5, step: { from: 'clear' } });
    for (const n of f.nodes) {
      const sp = fromOf(n.label);
      if (n.quote) {
        if (!sp && n.label && !n.emoji) continue; // label bukan pembicara
        const from = sp ?? (n.emoji === '\u{1F4AC}' || !n.label ? 'cus' : 'bot');
        events.push({ at: n.line, step: { from, text: n.quote } });
      } else if (n.check || n.warn) {
        const text = clean(n.label);
        const step: ChatStep = { from: 'chip', text, tone: n.warn ? 'amber' : 'green' };
        if (n.sub) step.sub = n.sub;
        else if (isHuman(text)) step.sub = 'Handover';
        events.push({ at: n.line, step });
      }
    }
  });
  return { events, usedFlow };
}

const STATUS_Q = /^(no reply|unanswered|needs human|human needed|read|seen|typing|offline|online)\b/i;

function ruleFlows(c: Ctx): void {
  const { L } = c;
  // 1) percakapan berlabel pembicara ("Customer: “...”")
  const events: { at: number; step: ChatStep }[] = [];
  const touched: number[] = [];
  for (const i of unusedIdx(c)) {
    const l = L[i];
    if (!l.speaker) continue;
    const from = fromOf(l.speaker);
    if (!from) continue;
    let q = l.quotes[0] ?? '';
    if (!q && l.speakerRest) q = clean(l.speakerRest.replace(/\*\*/g, ''));
    let extra = -1;
    if (!q) {
      // kutipan di baris berikutnya
      for (let k = i + 1; k < L.length && k <= i + 2; k++) {
        if (!c.used[k] && L[k].quotes.length && !L[k].speaker) {
          q = L[k].quotes[0];
          extra = k;
          break;
        }
        if (L[k].speaker) break;
      }
    }
    if (!q) continue;
    events.push({ at: i, step: { from, text: q } });
    touched.push(i);
    if (extra >= 0) touched.push(extra);
  }
  markUsed(c, ...touched);

  const { flows, usedLines, loop } = buildFlows(c);
  const chatFlows = chatFromFlows(c, flows);
  const dialogue = events.length > 0 || chatFlows.events.length > 0;
  const allEvents = [...events, ...chatFlows.events];

  // chain dari alur tanpa kutipan
  const chainFlows = flows.filter((_f, fi) => !chatFlows.usedFlow.includes(fi)).filter((f) => f.nodes.length >= 2);

  if (dialogue) {
    const chatLines = new Set<number>();
    flows.forEach((f, fi) => {
      if (chatFlows.usedFlow.includes(fi)) for (const n of f.nodes) chatLines.add(n.line);
    });
    // chip status: baris tebal berpenanda centang/peringatan yang belum terpakai, dan kutipan status
    for (const i of unusedIdx(c)) {
      const l = L[i];
      if (chatLines.has(i)) continue;
      const mark = /[✓✔⚠❌]/.test(l.text);
      const boldMark = /\*\*([^*]*[✓✔⚠❌][^*]*)\*\*/.exec(l.raw);
      const chipSrc = boldMark ? boldMark[1] : l.bold || l.caps ? l.text : '';
      if (chipSrc && mark && !l.arrow && clean(chipSrc).split(/\s+/).length <= 4) {
        const warn = /[⚠❌]/.test(chipSrc);
        allEvents.push({ at: i, step: { from: 'chip', text: clean(chipSrc.replace(/[✓✔✅⚠❌]/g, '')), tone: warn ? 'red' : 'green' } });
        touched.push(i);
      } else if (l.quotes.length === 1 && (STATUS_Q.test(l.quotes[0]) || /status|label|indicator/i.test(l.text))) {
        allEvents.push({ at: i, step: { from: 'chip', text: l.quotes[0], tone: 'amber' } });
        touched.push(i);
      }
    }
    markUsed(c, ...touched);
    allEvents.sort((a, b) => a.at - b.at);
    // chip peringatan wajib sesudah dialog; chip tanpa sub tetap valid
    const steps = allEvents.map((e) => e.step);
    const hasMiva = steps.some((s) => s.from === 'bot') || /miva/i.test(c.text);
    const props: MotionPropsMap['chat'] = {
      title: hasMiva ? 'MIVA AI' : 'WhatsApp Bisnis',
      status: 'online',
      logo: hasMiva,
      steps,
    };
    const at = allEvents[0].at;
    push(c, {
      kind: 'chat',
      props,
      at: Math.floor(at),
      phase: 'start',
      scene: true,
      beatQuotes: steps.filter((s) => s.from === 'cus' && s.text).map((s) => s.text!),
    });
    markUsed(c, ...usedLines.filter((i) => flows.some((f, fi) => chatFlows.usedFlow.includes(fi) && f.nodes.some((n) => n.line === i)) || true));
    // simpul alur rantai yang tersisa tetap bisa jadi chain kalau bukan ulangan pembicara
    const speakerSet = new Set(steps.map((s) => s.from));
    const restChains = chainFlows.filter((f) => !f.nodes.every((n) => fromOf(n.label) || /handover|miva|customer|admin|human/i.test(n.label)) && speakerSet.size > 0);
    if (!restChains.length) {
      return;
    }
  }
  if (!chainFlows.length) {
    if (loop && !dialogue) markUsed(c, ...usedLines);
    return;
  }

  // chain: alur pertama = nodes; alur berikutnya setelah penanda morph = morph
  const main = chainFlows[0];
  const morphF = chainFlows.slice(1).find((f) => f.morph);
  const weak = main.nodes.some((n) => n.weak);
  const nodes = main.nodes.map((n) => chainNode(n));
  const props: MotionPropsMap['chain'] = { nodes };
  if (morphF) props.morph = morphF.nodes.map((n) => chainNode(n));
  if (props.morph && props.morph.some((m) => /^miva/i.test(m.label))) {
    const alert = nodes.map((n, i) => (/^(you|kamu|owner|admin)$/i.test(n.label) ? i : -1)).filter((i) => i >= 0);
    if (alert.length) props.alert = alert;
  }
  // "semuanya tersambung ke: **MIVA AI**" -> simpul penutup
  const joinIdx = L.findIndex((l, i) => !c.used[i] && /tersambung ke|terhubung ke|menyambung ke|dihubungkan ke/i.test(l.text));
  if (joinIdx >= 0) {
    for (let k = joinIdx; k < L.length && k <= joinIdx + 2; k++) {
      const l = L[k];
      if (!c.used[k] && (l.bold || l.caps) && !l.colon) {
        props.nodes.push({ label: clean(l.text), icon: 'logo', tone: 'mint' });
        c.used[k] = true;
        break;
      }
    }
    c.used[joinIdx] = true;
  }
  // keterangan: kutipan setelah isyarat "teks"/"di bawahnya"
  const lastFlowLine = Math.max(...main.nodes.map((n) => n.line), ...(morphF ? morphF.nodes.map((n) => n.line) : [0]));
  for (const i of unusedIdx(c)) {
    if (i < lastFlowLine) continue;
    const l = L[i];
    const cue = cueBefore(c, i) + ' ' + lc(l.text);
    const captionCue = props.morph ? /tambahkan teks|di bawahnya|di bawah|teks:|text:|caption|tulisan/ : /tambahkan teks|di bawahnya|di bawah|caption/;
    const capText = l.quotes[0] ?? (l.heading || l.bold ? clean(l.text) : '');
    if (capText && captionCue.test(cue) && !/teks besar|text besar/.test(cue)) {
      props.caption = trimDot(capText);
      if (/miva/i.test(props.caption)) props.captionAccent = ['MIVA'];
      c.used[i] = true;
      break;
    }
  }
  push(c, {
    kind: 'chain',
    props,
    at: Math.min(...main.nodes.map((n) => n.line)),
    phase: 'start',
    review: weak,
  });
  markUsed(c, ...usedLines);
}

// ---------- bubbles / toasts / logo / chips / statement ----------

function ruleBubbles(c: Ctx): void {
  const { L } = c;
  const bubbleCue = /bubble|pertanyaan yang sama|chat masuk berturut|satu per satu/i.test(c.text);
  if (!bubbleCue) return;
  const idx = unusedIdx(c).filter((i) => L[i].quotes.length && !L[i].speaker && !L[i].arrow);
  const items: string[] = [];
  const touched: number[] = [];
  for (const i of idx) {
    // kutipan yang jelas milik aturan lain (status "Still replying...", teks besar) dilewati
    const cue = cueBefore(c, i);
    if (/teks besar|text besar|status|label/.test(cue)) continue;
    if (STATUS_Q.test(L[i].quotes[0]) || /…$/.test(L[i].quotes[0])) continue;
    for (const q of L[i].quotes) items.push(q);
    touched.push(i);
  }
  if (!items.length) return;
  const mode = /infinite|loop|ulangi|berulang|tanpa akhir/i.test(c.text)
    ? 'loop'
    : /tarik|berkumpul|gather/i.test(c.text)
      ? 'gather'
      : /membanjir|flood|banjir/i.test(c.text)
        ? 'flood'
        : 'stack';
  push(c, { kind: 'bubbles', props: { items, mode }, at: touched[0], phase: 'start', beatQuotes: items });
  markUsed(c, ...touched);
  // deret berulang "Harga berapa? -> Harga berapa?" dan kalimat penjelas loop ikut terpakai
  for (const i of unusedIdx(c)) {
    const l = L[i];
    if (l.arrow && !isArrowOnly(l)) {
      const parts = splitArrows(l.text);
      if (parts.length >= 2 && new Set(parts.map((p) => lc(clean(p)))).size === 1) c.used[i] = true;
    }
  }
}

function ruleToasts(c: Ctx): void {
  const { L } = c;
  const repeated = unusedIdx(c).filter((i) => L[i].bold && L[i].caps && !L[i].arrow && /new message|notif|pesan baru/i.test(L[i].text));
  const cue =
    repeated.length >= 2 ||
    (/(muncul|masuk|datang)\b.{0,40}notif|notif\w*\b.{0,40}(masuk|bertubi|berdatangan)|notification chat/i.test(c.text) &&
      !/freeze|berhenti/i.test(c.text.split('\n').filter((x) => /notif/i.test(x)).join(' ')));
  if (!cue) return;
  const hasOther = c.drafts.some((d) => d.kind === 'phone' || d.kind === 'chat' || d.kind === 'split');
  if (hasOther && repeated.length < 2) return;
  const items = repeated.map((i) => clean(L[i].text));
  const at = repeated.length ? repeated[0] : Math.max(0, L.findIndex((l) => /notif/i.test(l.text)));
  const shake = /bergetar|getar|vibrat|shake/i.test(c.text);
  push(c, {
    kind: 'toasts',
    props: {
      items: items.length ? items : ['New message', 'Harga berapa?', 'Masih ready?', 'Bisa kirim hari ini?'],
      icon: 'bubble',
      shake,
    },
    at,
    phase: 'start',
  });
  markUsed(c, ...repeated);
  for (const i of unusedIdx(c)) if (/notif/i.test(L[i].text) && !L[i].strong) c.used[i] = true;
  for (const i of unusedIdx(c)) if (/getar|bergetar/i.test(L[i].text) && !L[i].strong) c.used[i] = true;
}

function ruleLogo(c: Ctx): void {
  const { L } = c;
  const idx = L.findIndex((l, i) => !c.used[i] && (/\blogo\b/i.test(l.text) || /\breveal\b/i.test(l.text)));
  const titleLogo = /logo|reveal/i.test(c.title);
  if (idx < 0 && !titleLogo) return;
  const at = idx >= 0 ? idx : 0;
  // `sub` = lockup merek tetap; "Subtitle:" dari brief jadi `tagline`. Judul "MIVA AI" = wordmark, bukan sub.
  const props: MotionPropsMap['logo'] = { sub: BRAND_SUB };
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    const raw = lc(l.text);
    if (/^(sub(title|text)?|tagline)\s*:/.test(raw)) {
      const rest = clean(l.text.replace(/^(sub(title|text)?|tagline)\s*:\s*/i, ''));
      if (rest) {
        props.tagline = rest;
        c.used[i] = true;
      } else {
        // nilai di baris berikutnya
        for (let k = i + 1; k < L.length; k++) {
          if (!c.used[k] && (L[k].bold || L[k].caps || L[k].italic)) {
            props.tagline = clean(L[k].text);
            c.used[k] = true;
            break;
          }
        }
        c.used[i] = true;
      }
    }
  }
  if (/ditarik|tarik ke tengah|berkumpul|gather|collapse/i.test(c.text)) props.gather = true;
  push(c, { kind: 'logo', props, at, phase: 'start' });
  if (idx >= 0) c.used[idx] = true;
  // baris tebal/judul "MIVA AI" yang menyertai logo
  for (let i = Math.max(0, idx); i < Math.min(L.length, idx + 4); i++) {
    if (!c.used[i] && /^miva( ai)?$/i.test(clean(L[i].text))) c.used[i] = true;
  }
}

function chipItem(raw: string, forceTone?: Tone): ChipItem {
  const warn = /[⚠]/.test(raw);
  const stop = /[❌✗✘✕]/.test(raw);
  const ok = /[✓✔✅]/.test(raw);
  const label = clean(raw.replace(/[✓✔✅⚠❌✗]/g, '').replace(/\*\*/g, ''));
  const icon: ChipItem['icon'] = warn ? 'warn' : stop ? 'stop' : 'check';
  const tone: Tone = forceTone ?? (warn ? 'amber' : stop ? 'red' : ok ? 'green' : 'mint');
  return { label, icon, tone };
}

function ruleChips(c: Ctx): void {
  const { L } = c;
  const cands = unusedIdx(c);
  // (c) satu baris dengan beberapa tebal dipisah "|"
  for (const i of cands) {
    const l = L[i];
    const parts = l.text.split('|').map((p) => p.trim()).filter(Boolean);
    if (l.bold && parts.length >= 3 && !l.quotes.length) {
      push(c, { kind: 'chips', props: { items: parts.map((p) => chipItem(p, 'mint')) }, at: i, phase: 'start' });
      markUsed(c, i);
      return;
    }
  }
  // (a) daftar butir
  const bullets = cands.filter((i) => L[i].bullet && !L[i].quotes.length);
  // (b) baris tebal/kapital beruntun
  const bolds = cands.filter((i) => (L[i].bold || L[i].caps) && !L[i].arrow && !L[i].quotes.length && !L[i].colon && !L[i].speaker);
  let group: number[] = [];
  if (bullets.length >= 2) group = bullets;
  else {
    // kelompok beruntun terpanjang (selisih indeks <= 2)
    let best: number[] = [];
    let curG: number[] = [];
    for (const i of bolds) {
      if (curG.length && i - curG[curG.length - 1] > 2) {
        if (curG.length > best.length) best = curG;
        curG = [];
      }
      curG.push(i);
    }
    if (curG.length > best.length) best = curG;
    if (best.length >= 2) group = best;
  }
  if (group.length < 2) return;
  const items = group.map((i) => chipItem(L[i].text));
  if (items.some((x) => !x.label)) return;
  push(c, { kind: 'chips', props: { items }, at: group[0], phase: 'start' });
  markUsed(c, ...group);
}

function splitQuote(q: string): { line1?: string; line2: string } {
  const text = q.trim();
  // pisah di tanda baca dalam kalimat jika ada
  const m = /^(.+?[,;:…])\s+(.+)$/.exec(text);
  if (m && m[2].split(/\s+/).length >= 1 && m[1].split(/\s+/).length >= 1 && text.split(/\s+/).length >= 4) {
    return { line1: m[1], line2: m[2] };
  }
  const w = text.split(/\s+/);
  const n = w.length;
  if (n <= 2) return { line2: text };
  const take = n >= 7 ? 3 : n >= 4 ? 2 : 1;
  return { line1: w.slice(0, n - take).join(' '), line2: w.slice(n - take).join(' ') };
}

function ruleStatement(c: Ctx): void {
  const { L } = c;
  const flash = /pause|freeze/i.test(c.title) || /freeze|\bpause\b|tahan sebentar/i.test(c.text);
  const found: Draft[] = [];
  for (const i of unusedIdx(c)) {
    const l = L[i];
    const cue = cueBefore(c, i) + ' ' + lc(l.text.replace(/[“"][^”"]*[”"]/g, ''));
    const q = l.quotes[0];
    // coretan
    if (q && /cross-?out|coret|dicoret|strike/.test(cue)) {
      found.push({
        kind: 'statement',
        props: { line2: trimDot(q), style: 'pill', strike: [trimDot(q)] },
        at: i,
        phase: 'start',
      });
      c.used[i] = true;
      continue;
    }
    // teks besar
    if (q && (/teks besar|text besar|big text|tampilkan teks|muncul teks|munculkan teks|text sebagai|teks sebagai|tampilkan:|teks:|text:/.test(cue) || l.heading || (l.bold && l.quoteOnly && /closing|besar/.test(cue)))) {
      const sp = splitQuote(trimDot(q));
      const words = q.split(/\s+/).length;
      const style: 'serif' | 'pill' = words >= 3 ? 'serif' : 'pill';
      const props: MotionPropsMap['statement'] = style === 'serif' ? { line1: sp.line1, line2: sp.line2, style } : { line2: trimDot(q), style };
      if (!props.line1) delete props.line1;
      if (flash) props.flash = true;
      found.push({ kind: 'statement', props, at: i, phase: flash ? 'start' : 'start', scene: style === 'serif', hold: flash && c.b.dur ? c.b.dur[1] : undefined });
      c.used[i] = true;
      continue;
    }
    // "Muncul lingkaran: **24 / 7**"
    if ((l.bold || l.caps) && /lingkaran/.test(cue) && clean(l.text).length <= 12) {
      found.push({ kind: 'statement', props: { line2: clean(l.text), style: 'pill' }, at: i, phase: 'start' });
      c.used[i] = true;
    }
  }
  for (const d of found) push(c, d);
}

function ruleChatWeak(c: Ctx): void {
  if (c.drafts.some((d) => ['chat', 'chain', 'split', 'phone', 'chips', 'bubbles', 'cta', 'toggle', 'endcard', 'toasts'].includes(d.kind))) return;
  const { L } = c;
  const hit = /chat (customer )?masuk|customer chat|chat miva|mockup chat|contoh chat|chat whatsapp|satu chat masuk|pesan masuk|pop-?up chat/i.test(c.text);
  if (!hit) return;
  const steps: ChatStep[] = [
    { from: 'cus', text: 'Halo kak, masih ready?' },
    { from: 'bot', text: 'Halo kak! Masih ready, mau aku bantu proses?' },
  ];
  const statusIdx = unusedIdx(c).filter((i) => L[i].quotes.length === 1 && (STATUS_Q.test(L[i].quotes[0]) || /status|label|indicator/i.test(L[i].text)));
  for (const i of statusIdx) {
    steps.push({ from: 'chip', text: L[i].quotes[0], tone: 'amber' });
    c.used[i] = true;
  }
  const at = Math.max(0, L.findIndex((l) => /chat/i.test(l.text)));
  push(c, { kind: 'chat', props: { title: 'MIVA AI', status: 'online', logo: true, steps }, at, phase: 'start', scene: true, review: true });
}

function ruleFallback(c: Ctx): void {
  if (c.drafts.length) return;
  const { L } = c;
  if (!L.length) return;
  const pick =
    L.find((l) => l.bold && clean(l.text).length > 0)?.text ??
    L.find((l) => l.quotes.length)?.quotes[0] ??
    L.find((l) => l.strong)?.text ??
    L[0].text;
  const text = clean(pick).slice(0, 60) || c.title || 'MIVA';
  push(c, { kind: 'statement', props: { line2: text, style: 'pill' }, at: 0, phase: 'start', review: true, warn: ['blok tidak dikenali: dipakai statement terdekat'] });
}

// ---------- API ----------

const CO_START: [MotionKind, MotionKind][] = [
  ['counter', 'toasts'],
  ['counter', 'bubbles'],
  ['counter', 'chain'],
];

export function interpretBlock(block: BriefBlock, opts: RuleOptions): Draft[] {
  const L = [...block.lines, ...(opts.extra ?? [])];
  const c: Ctx = {
    b: block,
    L,
    used: L.map(() => false),
    title: block.title,
    text: L.map((l) => l.text).join('\n') + '\n' + block.title,
    isLast: opts.isLast,
    drafts: [],
  };
  // blok tanpa isi motion sama sekali (mis. seksi "TRANSISI" hanya VO) tidak menghasilkan item
  if (!L.length && block.type !== 'endcard') return [];

  ruleEndcard(c);
  if (!c.drafts.some((d) => d.kind === 'endcard') || L.some((_l, i) => !c.used[i])) {
    ruleToggle(c);
    ruleCta(c);
    ruleSplit(c);
    rulePhone(c);
    ruleCounter(c);
    ruleBubbles(c);
    ruleFlows(c);
    ruleToasts(c);
    ruleLogo(c);
    ruleChips(c);
    ruleStatement(c);
    ruleChatWeak(c);
  }
  ruleFallback(c);

  // urutkan menurut posisi di teks, lalu tentukan fase (item pertama mulai bersama blok, berikutnya menyusul)
  const ds = c.drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.phase === 'tail' ? 1 : 0) - (b.d.phase === 'tail' ? 1 : 0) || a.d.at - b.d.at || a.i - b.i)
    .map((x) => x.d);
  const first = ds.find((d) => d.phase !== 'tail');
  for (const d of ds) {
    if (d === first || d.phase === 'tail' || d.phase === 'after') continue;
    const pair = CO_START.some(([x, y]) => (first && first.kind === x && d.kind === y) || (first && first.kind === y && d.kind === x));
    if (!pair) d.phase = 'late';
  }
  // freeze + teks besar sesudah item lain: tampil tepat setelah kalimat selesai
  for (const d of ds) {
    if (d.kind === 'statement' && d !== first && (d.props as MotionPropsMap['statement']).flash) d.phase = 'after';
  }
  return ds;
}

