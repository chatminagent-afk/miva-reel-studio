// Kontrak motion graphic (fase 1, langkah 6b). Dipakai bersama oleh pustaka komponen (render),
// penerjemah brief (Rules offline), integrasi proyek, dan UI. Ubah file ini hanya lewat planner.
//
// Prinsip:
// - Motion disimpan di state proyek (app-only, .reel/state.json), bukan overlay.* skill. overlay.* tulisan tangan
//   (dari skill) tetap dipakai dan digabung SETELAH motion app.
// - Waktu ditambat ke INDEKS KATA MENTAH (state.words) + offset, supaya motion ikut bergeser saat potongan berubah.
// - Komponen hanya menerima data (props), tidak ada kode dari pengguna. Render harus deterministik dan seek-safe.

/** Titik waktu: kata mentah ke-`word` (awal `s` atau akhir `e`) + offset detik (waktu hasil edit). */
export interface MotionAnchor {
  word: number;
  edge?: 's' | 'e';
  off?: number;
}

export type MotionKind =
  | 'statement'
  | 'chat'
  | 'chain'
  | 'chips'
  | 'counter'
  | 'toasts'
  | 'phone'
  | 'split'
  | 'bubbles'
  | 'logo'
  | 'endcard'
  | 'toggle'
  | 'cta';

export type IconName =
  | 'person'
  | 'bubble'
  | 'phone'
  | 'briefcase'
  | 'chart'
  | 'logo'
  | 'check'
  | 'warn'
  | 'box'
  | 'team'
  | 'clock'
  | 'inbox'
  | 'bolt'
  | 'money'
  | 'cart'
  | 'calendar'
  | 'star'
  | 'heart';

export type Tone = 'dark' | 'mint' | 'red' | 'amber' | 'green' | 'cyan' | 'gold';

// ---------- props per komponen ----------

/** Kalimat besar: baris kecil sans (line1) + baris besar serif italic emas (line2), atau pill satu kalimat. */
export interface StatementProps {
  line1?: string;
  line2: string;
  style: 'serif' | 'pill';
  /** kata yang disorot (emas di serif, mint/cyan di pill) */
  accent?: string[];
  /** kata yang dicoret */
  strike?: string[];
  /** flash putih + freeze kesan "PAUSE" saat masuk */
  flash?: boolean;
}

export type ChatFrom = 'cus' | 'bot' | 'human' | 'chip' | 'clear';
export interface ChatStep {
  from: ChatFrom;
  /** isi bubble; untuk chip = label (mis. "LEAD") */
  text?: string;
  /** untuk chip = keterangan (mis. "Saved") */
  sub?: string;
  tone?: Tone;
}
/** Jendela chat ala WhatsApp: header (nama + status), bubble customer/bot/admin, titik mengetik, balasan diketik, chip status. */
export interface ChatProps {
  title: string;
  status?: string;
  /** tile logo MIVA di header */
  logo?: boolean;
  steps: ChatStep[];
}

export interface ChainNode {
  label: string;
  icon: IconName;
  tone?: Tone;
}
/** Rantai node ikon + label dengan penghubung; opsional berubah (morph) jadi rantai kedua, lalu pill kalimat. */
export interface ChainProps {
  nodes: ChainNode[];
  morph?: ChainNode[];
  /** node yang memerah/bergetar sebelum morph (indeks di nodes) */
  alert?: number[];
  caption?: string;
  captionAccent?: string[];
}

export interface ChipItem {
  label: string;
  sub?: string;
  icon: 'check' | 'warn' | 'stop';
  tone: Tone;
}
/** Tumpukan chip status (centang/peringatan). */
export interface ChipsProps {
  items: ChipItem[];
}

/** Pill angka berjalan (mis. "12 → 27 → 43 UNREAD MESSAGES"). Tiap nilai muncul di beat berikutnya. */
export interface CounterProps {
  label: string;
  icon: IconName;
  tone: Tone;
  values: number[];
}

/** Notifikasi bertubi-tubi di sekitar kepala, kiri/kanan bergantian. */
export interface ToastsProps {
  items: string[];
  /** ikon kecil di tiap toast */
  icon?: IconName;
  shake?: boolean;
}

export interface PhoneNotif {
  app: string;
  text: string;
}
/** Mockup HP lock-screen: jam berganti, notifikasi menumpuk, status di bawah. */
export interface PhoneProps {
  clocks: string[];
  notifs: PhoneNotif[];
  status?: string;
  /** latar berubah siang ke malam mengikuti jam */
  dayNight?: boolean;
}

export interface SplitSide {
  title: string;
  items: string[];
  tone?: Tone;
}
/** Dua kartu berdampingan; opsional sisi kanan membanjiri kiri dengan bubble. */
export interface SplitProps {
  left: SplitSide;
  right: SplitSide;
  flood?: boolean;
  bubbles?: string[];
}

/** Kluster bubble chat: tumpuk satu-satu, loop scroll tanpa akhir, ditarik ke tengah, atau membanjir. */
export interface BubblesProps {
  items: string[];
  mode: 'stack' | 'loop' | 'gather' | 'flood';
}

/** Kartu logo MIVA gelap (tanda gradien + wordmark + sub), opsional tagline menyusul. */
export interface LogoProps {
  sub?: string;
  tagline?: string;
  /** bubble ditarik ke tengah sebelum logo muncul */
  gather?: boolean;
}

/** End card layar penuh terang: logo, wordmark, sub, tagline, pill CTA. Biasanya di atas freeze `edit.tail`. */
export interface EndcardProps {
  title: string;
  sub?: string;
  tagline?: string;
  cta?: string;
}

/** A dicoret lalu B dengan centang (mis. "Balas manual" → "Dibalas otomatis"). */
export interface ToggleProps {
  from: string;
  to: string;
}

/** Tumpukan pill ajakan (opsional kursor tap di pill terakhir). */
export interface CtaProps {
  pills: string[];
  tap?: boolean;
}

export interface MotionPropsMap {
  statement: StatementProps;
  chat: ChatProps;
  chain: ChainProps;
  chips: ChipsProps;
  counter: CounterProps;
  toasts: ToastsProps;
  phone: PhoneProps;
  split: SplitProps;
  bubbles: BubblesProps;
  logo: LogoProps;
  endcard: EndcardProps;
  toggle: ToggleProps;
  cta: CtaProps;
}

// ---------- item di proyek ----------

export interface MotionItemOf<K extends MotionKind> {
  id: string;
  kind: K;
  start: MotionAnchor;
  /** akhir; kalau tidak ada, pakai `dur` (detik hasil edit) */
  end?: MotionAnchor;
  dur?: number;
  /** adegan: scrim gelap + footage blur di belakang grafik */
  scene?: boolean;
  /** titik internal (mis. tiap nilai counter, tiap bubble). Kosong = dibagi rata di dalam durasi */
  beats?: MotionAnchor[];
  props: MotionPropsMap[K];
  /** judul dari brief, mis. "MOTION 01 - HOOK" */
  label?: string;
  /** Rules tidak yakin (dipakai komponen terdekat) -> tandai untuk dicek Steven */
  review?: boolean;
  /** potongan teks brief asal (untuk ditampilkan di UI) */
  note?: string;
  origin?: 'rules' | 'manual';
}

export type MotionItem = { [K in MotionKind]: MotionItemOf<K> }[MotionKind];

/** Item yang waktunya sudah dihitung (detik hasil edit). Input untuk builder komponen. */
export type ResolvedMotion<K extends MotionKind = MotionKind> = MotionItemOf<K> & {
  t0: number;
  t1: number;
  /** waktu beats yang sudah dihitung (detik hasil edit, naik, di dalam [t0, t1]) */
  beatTimes: number[];
};

// ---------- pustaka komponen ----------

export type FieldType = 'text' | 'lines' | 'number' | 'numbers' | 'bool' | 'select' | 'icon' | 'tone' | 'json';
/** Deskripsi field untuk editor props generik di UI. `key` = path di props (titik untuk nested, mis. "left.title"). */
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  hint?: string;
}

export interface MotionSfx {
  t: number;
  kat: string;
  gain_db?: number;
  /** puncak bunyi disejajarkan ke t (whoosh/swish/riser) */
  align?: boolean;
  /** potong bunyi di durasi ini (mis. ketik selama teks diketik) */
  dur?: number;
}

export interface MotionBuild {
  html: string;
  css: string;
  js: string;
  sfx: MotionSfx[];
}

export interface MotionComponent<K extends MotionKind = MotionKind> {
  kind: K;
  title: string;
  description: string;
  fields: FieldSpec[];
  defaults(): MotionPropsMap[K];
  /** durasi wajar (detik) */
  minDur: number;
  maxDur: number;
  /** zona: 'top' = di atas kepala (y 190-640, wajah tetap terlihat); 'scene' = tengah atas scrim; 'full' = layar penuh */
  zone: 'top' | 'scene' | 'full';
  /** adegan default untuk komponen ini */
  sceneDefault: boolean;
  build(item: ResolvedMotion<K>): MotionBuild;
}

/** Hasil gabungan semua motion: disuntik ke slot overlay template (sebelum overlay.* tulisan tangan). */
export interface MotionOverlay {
  html: string;
  css: string;
  js: string;
  sfx: MotionSfx[];
  /** rentang adegan (detik hasil edit) untuk blur footage di export (FFmpeg) dan preview (CSS) */
  scenes: { s: number; e: number }[];
}
