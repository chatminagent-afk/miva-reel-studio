// Format file proyek, sama dengan skill /reel-edit supaya proyek bisa dibuka bergantian oleh app dan skill.

/** Kata dari Whisper (words-raw.json). `e_ref` = akhir kata yang dipangkas memakai energi pita suara. */
export interface RawWord {
  w: string;
  s: number;
  e: number;
  p?: number;
  e_ref?: number;
}

export type Seg = [number, number];

export interface Insert {
  t: number;
  dur: number;
  src: string;
  zoom?: number;
}

export interface ManualSfx {
  t: number;
  kat?: string;
  id?: string;
  gain_db?: number;
  align?: boolean;
  dur?: number;
}

export interface CamState {
  scale: number;
  x: number;
  y: number;
  filter?: string;
}

export interface CamStep {
  el?: string;
  t: number;
  from: Partial<CamState>;
  to: Partial<CamState>;
  dur: number;
  ease: string;
}

export interface MusicSpec {
  style?: string;
  file?: string;
  start?: number;
  lufs?: number;
  duck_db?: number;
  [k: string]: unknown;
}

/** edit.json */
export interface EditJson {
  src: string;
  segs: Seg[];
  fix?: Record<string, string>;
  grade?: string;
  speed?: number;
  music?: MusicSpec;
  camera?: 'auto' | CamStep[];
  camera_kuat?: number;
  origin?: string;
  whip?: number[];
  riser?: boolean;
  sfx?: ManualSfx[];
  inserts?: Insert[];
  mode?: string;
  /** dtk freeze frame terakhir + hening sesudah kata terakhir (ruang end card); sama dengan `tail` di build_base.py skill */
  tail?: number;
  [k: string]: unknown;
}

export interface TimedWord {
  w: string;
  s: number;
  e: number;
  seg: number;
}

/** timing.json — semua waktu sudah dalam waktu SESUDAH percepat. */
export interface TimingJson {
  duration: number;
  speed: number;
  cuts: number[];
  words: TimedWord[];
  lines?: unknown;
}

/** Satu entri captions.json = satu kemunculan subtitle (biasa ATAU kata kunci). */
export interface Chunk {
  w: number[];
  anim?: string;
  big?: number[];
  hit?: string | null;
  pos?: string;
  _teks?: string;
}

export interface CaptionsJson {
  chunks: Chunk[];
}

/** Bunyi di pustaka SFX (_fitur.json): durasi dan posisi puncak relatif 0..1. */
export interface SfxFeature {
  dur: number;
  peak_at: number;
  [k: string]: unknown;
}

/** catalog.json pustaka SFX. */
export interface SfxCatalog {
  bunyi: Record<string, { kategori?: string; label?: string; dikonfirmasi?: boolean; [k: string]: unknown }>;
  pilihan: Record<string, string[]>;
}

export interface SfxCue {
  t: number;
  id: string;
  kat: string;
  dur: number | null;
  prio: number;
  gain_db: number;
  /** 1 = SFX bagian motion graphic (bukan SFX otomatis subtitle): tidak terkena `sfx_off`. Skill mengabaikan field ini. */
  m?: 1;
}

export interface CuesJson {
  duration: number;
  music: MusicSpec;
  sfx: SfxCue[];
}
