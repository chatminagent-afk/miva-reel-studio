// Parser teks brief motion (Rules offline, tanpa LLM). Tahap 1 dari 4: teks -> blok + baris terklasifikasi.
//
// Tiga bentuk brief yang dikenali (diambil dari 7 brief nyata Steven):
//  - 'motion'  : naskah diselingi blok `**[MOTION 01 - HOOK | 2 detik]**` (+ `[END CARD ...]`). Naskah yang diucapkan tepat
//                SEBELUM header = kalimat yang diilustrasikan blok itu.
//  - 'range'   : `**[0-3s]**` + `VO:` + `Motion:`; VO ada di dalam blok.
//  - 'section' : `### JUDUL` + `**VO:**` + `**Visual:**`; VO ada di dalam seksi.
// Pemisah judul bisa em dash, en dash, hyphen, atau titik dua; `**` markdown, kurung siku, kutip melengkung, emoji, panah
// (-> => ↓ dst) semuanya ditoleransi. Penjajaran ke transkrip (align.ts) memutuskan baris mana yang benar-benar naskah.

export type BriefFormat = 'motion' | 'range' | 'section' | 'plain';
export type BlockType = 'motion' | 'endcard' | 'range' | 'section';

export interface BriefLine {
  raw: string;
  /** teks tanpa markup markdown (bold, bullet, heading); kutip, emoji, panah dipertahankan */
  text: string;
  bold: boolean;
  italic: boolean;
  heading: boolean;
  bullet: boolean;
  /** isi tiap kutipan di baris (tanpa tanda kutip) */
  quotes: string[];
  /** seluruh baris = satu kutipan */
  quoteOnly: boolean;
  /** label pembicara di awal baris ("Customer:", "MIVA:") dan sisa teksnya */
  speaker: string | null;
  speakerRest: string;
  arrow: boolean;
  emoji: boolean;
  caps: boolean;
  clock: boolean;
  /** baris berakhir titik dua */
  colon: boolean;
  /** sinyal kuat bahwa baris ini isi motion (bukan kalimat naskah) */
  strong: boolean;
  /** mirip deskripsi visual (imperatif/orang ketiga), bukan ucapan orang pertama/kedua */
  descLike: boolean;
}

export interface BriefBlock {
  /** urutan blok di brief, mulai 0 */
  index: number;
  type: BlockType;
  /** baris header asli ('' kalau sintetis) */
  header: string;
  /** nomor dari header ("MOTION 03" -> 3) */
  num: number | null;
  /** judul tanpa durasi ("HOOK", "PAUSE", "0-3s", "POP-UP 1 - FASHION") */
  title: string;
  /** durasi dari header dalam detik: "2 detik" -> [2,2], "2-3 detik" -> [2,3] */
  dur: [number, number] | null;
  /** rentang waktu rencana untuk header `[0-3s]` */
  rangeSec: [number, number] | null;
  /** isi motion (baris yang pasti bukan naskah) */
  lines: BriefLine[];
  /**
   * Format 'motion': baris-baris sesudah isi motion terakhir = kandidat naskah milik blok BERIKUTNYA (diucapkan sebelum header
   * berikutnya). Boleh juga deskripsi tanpa penanda; align menentukan.
   */
  tail: BriefLine[];
  /** format 'range'/'section': baris VO di dalam blok */
  script: string[];
  /** teks mentah blok (header + isi) */
  raw: string;
}

export interface ParsedBrief {
  format: BriefFormat;
  /** kandidat naskah sebelum blok pertama (format 'motion'); pada format lain: baris di luar blok */
  preamble: BriefLine[];
  blocks: BriefBlock[];
}

// ---------- util teks ----------

const ARROW_RE = /(?:→|↓|↑|⇒|⇨|➜|➔|➡|⬇|⬆|↗|↘|-->|->|=>)/;
const ARROW_G = /(?:→|↓|↑|⇒|⇨|➜|➔|➡|⬇|⬆|↗|↘|-->|->|=>)/g;
const EMOJI_RE = /[\p{Extended_Pictographic}✓✔✗✘✕✖]/u;
const EMOJI_G = /[\p{Extended_Pictographic}\p{Emoji_Modifier}️‍⃣✓✔✗✘✕✖]/gu;
const QUOTE_RE = /[“"«„]([^“”"«»„]+?)[”"»‟]/g;
const CLOCK_RE = /\b\d{1,2}[:.]\d{2}\b/;
const DASHES = '\\-\\u2010-\\u2015\\u2212';

export const SPEAKER_RE = new RegExp(
  '^(?:chat\\s+)?(customer|pelanggan|calon pembeli|calon klien|calon customer|pembeli|klien|user|miva(?:\\s+ai)?|ai|bot|admin|human admin|human|penjual|bisnis owner|owner|manusia|asisten)\\s*:\\s*(.*)$',
  'i',
);

const DESC_RE =
  /\b(tampilkan|tambahkan|munculkan|muncul|tahan|visual|animasi|layar|screen|notification|notifikasi|talking head|chat bubble|freeze|kemudian|lalu|sisi|semua|overlay|transisi|zoom|kamera|bergetar|footage|teks besar|text besar|counter)\b/i;
const PRON_RE = /\b(aku|gue|gw|gua|kamu|kalian|saya|kita|lo|lu|anda|kakak|kak)\b/i;

/** Hapus markup markdown (heading, bullet, bold, italic) tanpa mengubah isi. */
export function stripMarkup(s: string): string {
  let t = s.trim();
  t = t.replace(/^#{1,6}\s*/, '');
  t = t.replace(/^[*•]\s+(?!\*)/, '').replace(/^-\s+/, '');
  t = t.replace(/\*\*/g, '').replace(/__/g, '');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/^\*+|\*+$/g, '');
  return t.trim();
}

/** Hapus emoji/penanda centang; rapikan spasi. */
export function stripEmoji(s: string): string {
  return s.replace(EMOJI_G, '').replace(/\s{2,}/g, ' ').trim();
}

export function hasEmoji(s: string): boolean {
  return EMOJI_RE.test(s);
}

/** Teks tanpa isi kutipan (untuk mendeteksi panah/huruf besar di luar kutipan). */
function outsideQuotes(s: string): string {
  return s.replace(QUOTE_RE, ' ');
}

export function extractQuotes(s: string): string[] {
  const out: string[] = [];
  const re = new RegExp(QUOTE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const q = m[1].replace(/\*\*/g, '').trim();
    if (q) out.push(q);
  }
  return out;
}

function boldRatio(raw: string): number {
  const body = raw.replace(/^\s*#{1,6}\s*/, '').replace(/^\s*[*•-]\s+(?!\*)/, '');
  const noSpace = body.replace(/\s/g, '');
  if (!noSpace) return 0;
  let inside = 0;
  const re = /\*\*(.+?)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) inside += m[1].replace(/\s/g, '').length;
  const marks = (body.match(/\*\*/g) ?? []).length * 2;
  return inside / Math.max(1, noSpace.length - marks);
}

function isCaps(s: string): boolean {
  const letters = stripEmoji(outsideQuotes(s)).match(/\p{L}/gu) ?? [];
  if (letters.length < 2) return false;
  const up = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
  return up / letters.length >= 0.85;
}

export function classifyLine(raw: string): BriefLine {
  const trimmed = raw.trim();
  const heading = /^#{1,6}\s/.test(trimmed);
  const bullet = /^([*•]|-)\s+\S/.test(trimmed);
  const text = stripMarkup(trimmed);
  const italic = /^\*[^*]+\*$/.test(trimmed) || /^_[^_]+_$/.test(trimmed);
  const bold = boldRatio(trimmed) >= 0.85;
  const quotes = extractQuotes(text);
  const qOnly = quotes.length === 1 && new RegExp('^[\\u201C"\\u00AB\\u201E].*[\\u201D"\\u00BB\\u201F][.!?\\u2026]*$').test(text);
  const sp = SPEAKER_RE.exec(stripEmoji(text));
  const out = outsideQuotes(text);
  const arrow = ARROW_RE.test(out);
  const emoji = hasEmoji(text);
  const caps = isCaps(text);
  const clock = CLOCK_RE.test(out);
  const colon = /:\s*$/.test(text.replace(/[”"»]\s*$/, ''));
  const strong =
    bold || italic || heading || bullet || quotes.length > 0 || arrow || emoji || caps || clock || colon || !!sp;
  const descLike = DESC_RE.test(text) && !PRON_RE.test(text);
  return {
    raw,
    text,
    bold,
    italic,
    heading,
    bullet,
    quotes,
    quoteOnly: qOnly,
    speaker: sp ? sp[1].toLowerCase().replace(/^chat\s+/, '') : null,
    speakerRest: sp ? sp[2].trim() : '',
    arrow,
    emoji,
    caps,
    clock,
    colon,
    strong,
    descLike,
  };
}

// ---------- header ----------

function parseDur(s: string): [number, number] | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:[-\u2013\u2014]\s*(\d+(?:[.,]\d+)?))?\s*(?:detik|dtk|sec|secs|seconds?|s)\b/i.exec(s);
  if (!m) return null;
  const a = parseFloat(m[1].replace(',', '.'));
  const b = m[2] ? parseFloat(m[2].replace(',', '.')) : a;
  return [a, b];
}

interface HeaderInfo {
  type: BlockType;
  num: number | null;
  title: string;
  dur: [number, number] | null;
  rangeSec: [number, number] | null;
}

const MOTION_HEAD = new RegExp(
  '^(MOTION|END\\s*CARD|ENDCARD)\\s*(\\d{1,3})?\\s*(?:[' + DASHES + ':.]+\\s*)?(.*)$',
  'i',
);
const RANGE_HEAD = new RegExp(
  '^(\\d+(?:[.,:]\\d+)?)\\s*[' + DASHES + ']\\s*(\\d+(?:[.,:]\\d+)?)\\s*(?:s|sec|detik|dtk|d)?$',
  'i',
);

function clockToSec(s: string): number {
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return parseInt(m, 10) * 60 + parseFloat(sec.replace(',', '.'));
  }
  return parseFloat(s.replace(',', '.'));
}

/** Header `[MOTION ..]` / `[END CARD ..]` / `[0-3s]`; null kalau baris bukan header. */
export function parseMotionHeader(line: string): HeaderInfo | null {
  let s = stripMarkup(line).trim();
  if (!s || s.length > 120) return null;
  const bracketed = /^\[.*\]$/.test(s);
  let inner: string;
  if (bracketed) inner = s.slice(1, -1).trim();
  else if (/^MOTION\s*\d+/i.test(s)) inner = s;
  else return null;
  const r = RANGE_HEAD.exec(inner);
  if (bracketed && r) {
    return {
      type: 'range',
      num: null,
      title: inner,
      dur: null,
      rangeSec: [clockToSec(r[1]), clockToSec(r[2])],
    };
  }
  const m = MOTION_HEAD.exec(inner);
  if (!m) return null;
  const isEnd = /^END/i.test(m[1]);
  const num = m[2] ? parseInt(m[2], 10) : null;
  const rest = m[3].trim();
  let title = '';
  let dur: [number, number] | null = null;
  if (rest) {
    const parts = rest.split('|').map((x) => x.trim()).filter(Boolean);
    for (const p of parts) {
      const d = parseDur(p);
      const onlyDur = d && /^[\d.,\s\u2013\u2014-]+\s*(detik|dtk|sec|secs|seconds?|s)\b\.?$/i.test(p);
      if (onlyDur) dur = dur ?? d;
      else if (!title) title = p.replace(new RegExp('^[' + DASHES + ':\\s]+|[' + DASHES + ':\\s]+$', 'g'), '');
    }
  }
  if (isEnd && !title) title = 'END CARD';
  return { type: isEnd ? 'endcard' : 'motion', num, title, dur, rangeSec: null };
}

/** Heading seksi `### JUDUL` (bukan kutipan/teks layar). */
function parseSectionHeader(line: string): HeaderInfo | null {
  const t = line.trim();
  if (!/^#{2,4}\s+/.test(t)) return null;
  const body = stripMarkup(t);
  if (!body || /^[“"«]/.test(body)) return null;
  return { type: 'section', num: null, title: body.replace(/\s+/g, ' '), dur: null, rangeSec: null };
}

// ---------- praproses ----------

const NOISE_RES = [
  /^\s*<\/?pasted_content\b[^>]*>\s*$/i,
  /^\s*@["'A-Za-z]/,
  /^\s*\/(?:reel-edit|miva-motion|[a-z][a-z-]{2,})\b/i,
  /^\s*[-_=*]{3,}\s*$/,
  /^\s*["“”]\s*$/,
];

/** Pecah jadi baris, buang noise tempelan (tag pasted_content, path @, perintah /reel-edit, pemisah ---). */
export function preprocess(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    // tag tempelan di mana pun (satu baris sendiri atau menempel di teks); dengan atau tanpa tag sama saja
    let l = rawLine.replace(/<\/?pasted_content\b[^>]*>/gi, '').replace(/\s+$/, '');
    if (NOISE_RES.some((re) => re.test(l))) l = '';
    // pembungkus kutip ganda dari tempelan: `"“Kalau ...`
    l = l.replace(/^(\s*)"(?=[“*#])/, '$1');
    out.push(l);
  }
  // kutip pembungkus yang menempel di akhir baris terakhir (`**Chat nomor di BIO**"`)
  for (let i = out.length - 1; i >= 0; i--) {
    if (!out[i].trim()) continue;
    if (out[i].endsWith('"') && (out[i].match(/"/g) ?? []).length % 2 === 1) out[i] = out[i].slice(0, -1);
    break;
  }
  return out;
}

// ---------- parser ----------

const VO_LABEL = /^VO\s*(?:\(.*?\))?\s*:\s*(.*)$/i;
const CONTENT_LABEL = /^(motion|visual|text kecil|text|teks|end ?card|animasi|grafik|layar)\b[^:]*:\s*(.*)$/i;

function leadJunk(s: string): string {
  return s.replace(/^[^\p{L}\p{N}“"]+/u, '');
}

function cleanScript(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/[“”"«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function newBlock(index: number, h: HeaderInfo, header: string): BriefBlock {
  return {
    index,
    type: h.type,
    header,
    num: h.num,
    title: h.title,
    dur: h.dur,
    rangeSec: h.rangeSec,
    lines: [],
    tail: [],
    script: [],
    raw: header,
  };
}

export function parseBrief(text: string): ParsedBrief {
  const lines = preprocess(text);
  const heads = lines.map((l) => (l.trim() ? parseMotionHeader(l) : null));
  const nMotion = heads.filter((h) => h && (h.type === 'motion' || h.type === 'endcard')).length;
  const nRange = heads.filter((h) => h && h.type === 'range').length;
  const sections = lines.map((l) => (l.trim() ? parseSectionHeader(l) : null));
  const nSection = sections.filter(Boolean).length;
  let format: BriefFormat = 'plain';
  if (nMotion > 0) format = 'motion';
  else if (nRange > 0) format = 'range';
  else if (nSection >= 2) format = 'section';

  const headerAt = (i: number): HeaderInfo | null => {
    if (format === 'motion') {
      const h = heads[i];
      return h && (h.type === 'motion' || h.type === 'endcard') ? h : null;
    }
    if (format === 'range') return heads[i] && heads[i]!.type === 'range' ? heads[i] : null;
    if (format === 'section') return sections[i];
    return null;
  };

  const blocks: BriefBlock[] = [];
  const preRaw: string[] = [];
  const bodies: string[][] = [];
  let cur: BriefBlock | null = null;
  for (let i = 0; i < lines.length; i++) {
    const h = headerAt(i);
    if (h) {
      cur = newBlock(blocks.length, h, lines[i].trim());
      blocks.push(cur);
      bodies.push([]);
      continue;
    }
    if (!lines[i].trim()) continue;
    if (cur) {
      bodies[bodies.length - 1].push(lines[i]);
      cur.raw += '\n' + lines[i];
    } else preRaw.push(lines[i]);
  }

  const preamble = preRaw.map(classifyLine);

  blocks.forEach((b, bi) => {
    const body = bodies[bi];
    if (format === 'motion') {
      const cl = body.map(classifyLine);
      let last = -1;
      cl.forEach((l, i) => {
        if (l.strong) last = i;
      });
      b.lines = cl.slice(0, last + 1);
      b.tail = cl.slice(last + 1);
    } else {
      parseInlineBody(b, body, format);
    }
  });

  return { format, preamble, blocks };
}

/** Format 'range' / 'section': pisahkan baris VO (naskah) dan isi motion berdasarkan penanda label. */
function parseInlineBody(b: BriefBlock, body: string[], format: BriefFormat): void {
  let mode: 'content' | 'vo' = 'content';
  let prevColon = false;
  for (const raw of body) {
    const t = leadJunk(stripMarkup(raw));
    const vo = VO_LABEL.exec(t);
    if (vo) {
      mode = 'vo';
      prevColon = false;
      const rest = cleanScript(vo[1]);
      if (rest) b.script.push(rest);
      continue;
    }
    if (/^beat\b/i.test(t) && boldRatio(raw) >= 0.85 && t.length < 12) continue;
    const cl = classifyLine(raw);
    const lab = CONTENT_LABEL.exec(t);
    if (lab && !cl.speaker) {
      mode = 'content';
      if (/^motion\b/i.test(t)) {
        // label "Motion:" saja dibuang; sisa teks di baris yang sama tetap jadi isi
        prevColon = false;
        if (lab[2].trim()) b.lines.push(classifyLine(lab[2]));
        continue;
      }
      b.lines.push(cl);
      prevColon = cl.colon;
      continue;
    }
    if (mode === 'vo') {
      const subLabel = cl.bold && !cl.quotes.length && /[A-Za-z]/.test(cl.text) && cl.caps;
      if (cl.speaker || subLabel || cl.bullet) {
        mode = 'content';
        b.lines.push(cl);
        prevColon = cl.colon || (!!cl.speaker && !cl.speakerRest);
      } else {
        const s = cleanScript(cl.text);
        if (s) b.script.push(s);
      }
      continue;
    }
    // mode isi: kutipan polos (bukan tebal, tidak didahului label) pada format seksi = lanjutan VO
    if (format === 'section' && cl.quoteOnly && !cl.bold && !prevColon) {
      const s = cleanScript(cl.text);
      if (s) b.script.push(s);
      continue;
    }
    b.lines.push(cl);
    prevColon = cl.colon || (!!cl.speaker && !cl.speakerRest);
  }
}

/** Gabungan teks isi blok (untuk deteksi kata kunci). */
export function blockText(b: BriefBlock, extra: BriefLine[] = []): string {
  return [...b.lines, ...extra].map((l) => l.text).join('\n');
}

const LONG_DASH_G = new RegExp('[\u2013\u2014]', 'g');

/** Ganti em/en dash dengan tanda hubung biasa (konvensi teks MIVA). */
export function deDash(s: string): string {
  return s.replace(LONG_DASH_G, '-');
}

/** Label tampilan: "MOTION 01 - HOOK" (tanda hubung biasa). */
export function blockLabel(b: BriefBlock): string {
  const nn = (n: number) => String(n).padStart(2, '0');
  if (b.type === 'endcard') return 'END CARD';
  if (b.type === 'range') return deDash(`MOTION ${nn(b.index + 1)} - ${b.title}`);
  const n = b.num ?? b.index + 1;
  return deDash(b.title ? `MOTION ${nn(n)} - ${b.title.toUpperCase()}` : `MOTION ${nn(n)}`);
}
