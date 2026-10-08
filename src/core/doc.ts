// Dokumen proyek (bagian murni, tanpa Node): tipe, turunan timing/captions, edit awal. Dipakai proses utama dan UI.
import { draftCaptions } from './captions';
import { keptWordIndices } from './edit';
import type { KeywordMark, Retake } from './suggest';
import type { MotionItem } from './motion/types';
import type { BriefReport } from './motion/resolve';
import { mapTiming, SPEED_DEFAULT } from './timing';
import type { CaptionsJson, Chunk, EditJson, RawWord, TimingJson } from './types';

export const STATE_VERSION = 1;

export interface ProjectState {
  version: number;
  name: string;
  /** footage mentah (path absolut) */
  source: string;
  created: string;
  updated: string;
  /** durasi audio footage mentah */
  duration: number;
  /** kata Whisper (waktu mentah) + e_ref (akhir kata dipangkas energi suara) */
  words: RawWord[];
  keywords: KeywordMark[];
  /** retake yang dibuang Auto Edit (untuk ditinjau) */
  retakes: Retake[];
  /** noise floor pita suara (dB), info */
  floor: number;
  /** cara saran kata kunci terakhir */
  keywordMode: 'rules' | 'llm' | 'claude' | 'manual';
  /** indeks kata pertama tiap segmen Whisper (awal kalimat; dipakai saran kata kunci) */
  segStarts?: number[];
  /** motion graphic (app-only; overlay.* tulisan tangan skill tetap dipakai dan digabung sesudahnya) */
  motion?: MotionItem[];
  /** teks Motion brief terakhir (naskah + blok `[MOTION NN - JUDUL | durasi]`) */
  motionBrief?: string;
  /** laporan penerjemah brief terakhir (peringatan per blok, kebutuhan tail) untuk UI */
  motionReport?: BriefReport;
}

export interface ProjectDoc {
  dir: string;
  edit: EditJson;
  state: ProjectState;
  overlay: { css?: string; html?: string; js?: string };
}

/** captions.json dari timing + kata kunci (indeks kata mentah). */
export function buildCaptions(timing: TimingJson, kept: number[], marks: KeywordMark[]): CaptionsJson {
  const draft = draftCaptions(timing);
  const toT = new Map(kept.map((raw, t) => [raw, t]));
  const chunks: Chunk[] = draft.chunks.map((c) => ({ ...c }));
  for (const m of marks) {
    const big = m.big.map((r) => toT.get(r)).filter((t): t is number => t !== undefined);
    if (!big.length) continue; // kata kunci sedang dipotong
    const c = chunks.find((ch) => ch.w.includes(big[0]));
    if (!c) continue;
    c.big = big.filter((t) => c.w.includes(t));
    c.anim = m.anim;
    if (m.hit) c.hit = m.hit;
    if (m.pos && m.pos !== 'c') c.pos = m.pos;
  }
  return { chunks };
}

/** timing.json + captions.json yang diturunkan dari dokumen. */
export function derive(doc: Pick<ProjectDoc, 'edit' | 'state'>): { timing: TimingJson; captions: CaptionsJson; kept: number[] } {
  // words-raw.json skill tidak berisi e_ref (timing memakai akhir kata Whisper); app mengikuti skill dulu (lihat DECISIONS)
  const raw = doc.state.words.map(({ e_ref: _e, ...w }) => w);
  const { timing } = mapTiming(doc.edit, raw);
  const kept = keptWordIndices(doc.edit.segs, doc.state.words);
  return { timing, captions: buildCaptions(timing, kept, doc.state.keywords), kept };
}

/** edit.json awal (sama dengan default transcribe.py skill) + pilihan import. */
export function initialEdit(src: string, opts: { speed?: number; grade?: string; fix?: Record<string, string> } = {}): EditJson {
  return {
    src,
    segs: [],
    fix: { ...(opts.fix ?? {}) },
    grade: opts.grade ?? 'natural',
    speed: opts.speed ?? SPEED_DEFAULT,
    music: { style: 'none' },
    camera: 'auto',
    sfx: [],
    inserts: [],
  };
}
