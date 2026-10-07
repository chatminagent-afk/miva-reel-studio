// Auto Edit (tombol setelah import): footage mentah -> proyek siap direview.
//   1. proxy preview 540p (grade diterapkan, keyframe rapat supaya lompat potongan mulus)
//   2. transkripsi Whisper (sidecar, GPU kalau ada)
//   3. potong hening (celah kata + energi suara, sama dengan skill) + buang retake
//   4. saran kata kunci (Rules, offline)
//   5. subtitle, kamera otomatis (dihitung saat render/preview dari timing), simpan proyek format skill
// base.mp4 (potong + percepat + bersihkan suara) TIDAK dibuat di sini: lambat dan baru perlu saat export.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveGrade } from './base';
import { analyzeAudio, PAD_IN, proposeCuts } from './cut';
import { cutRange, keptWordIndices, srcToEdited } from './edit';
import { probeDuration } from './ffmpeg';
import { CancelledError, runProcess } from './proc';
import { initialEdit, projectName, saveProject, uniqueDir, type ProjectDoc } from './project';
import { detectRetakes, suggestKeywords } from './suggest';
import type { RawWord, Seg } from './types';
import { transcribe, type WhisperDevice, type WhisperRuntime } from './whisper';

export interface AutoEditOptions {
  src: string;
  /** folder induk proyek (mis. Documents/MIVA Reel Studio) */
  root: string;
  speed?: number;
  grade?: string;
  /** kamus koreksi salah dengar ("cloud" -> "Claude"), masuk ke edit.json "fix" */
  fix?: Record<string, string>;
  /** nama/merek yang diprioritaskan jadi kata kunci */
  names?: string[];
  device?: WhisperDevice;
  ffmpeg: string;
  whisper: WhisperRuntime;
  signal?: AbortSignal;
  onProgress?: (p: AutoEditProgress) => void;
  /** untuk tes: lewati transkripsi dan pakai kata ini */
  wordsOverride?: RawWord[];
  segStartsOverride?: number[];
}

export interface AutoEditProgress {
  step: 1 | 2 | 3 | 4 | 5;
  /** 0..1 dalam langkah ini */
  progress: number;
  message: string;
}

export interface AutoEditResult {
  doc: ProjectDoc;
  /** info untuk banner "Auto Edit done" */
  summary: { silences: number; retakes: number; keywords: number; rawDuration: number; finalDuration: number; device: string | null; fallback: string | null };
}

export const PROXY = 'assets/_proxy.mp4';

/** Proxy preview: crop 9:16 sama dengan base.mp4, 540×960, grade proyek, keyframe tiap 0,5 dtk. */
export function proxyArgs(src: string, out: string, grade: string | undefined): string[] {
  return [
    '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1',
    '-i', src,
    '-vf', `scale=540:960:force_original_aspect_ratio=increase,crop=540:960,${resolveGrade(grade)},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '15',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
    out,
  ];
}

export async function makeProxy(ffmpegBin: string, src: string, out: string, grade: string | undefined, duration: number, signal?: AbortSignal, onFrac?: (f: number) => void): Promise<void> {
  await runProcess(ffmpegBin, proxyArgs(src, out, grade), {
    signal,
    onStdoutLine: (l) => {
      const m = /^out_time_us=(\d+)/.exec(l);
      if (m && duration > 0) onFrac?.(Math.min(1, Number(m[1]) / 1e6 / duration));
    },
  });
}

/** Buang retake: dari awal percobaan pertama sampai tepat sebelum pengulangan (padding kata sebelumnya tidak disentuh). */
export function cutRetakes(segs: Seg[], words: RawWord[], retakes: ReturnType<typeof detectRetakes>): Seg[] {
  let out = segs;
  for (const r of retakes) {
    const i = r.words[0];
    const prev = words[i - 1];
    const from = Math.max(words[i].s - PAD_IN, prev ? ((prev.e_ref ?? prev.e) + words[i].s) / 2 : 0);
    out = cutRange(out, from, r.to - PAD_IN);
  }
  return out;
}

const applyFix = (w: string, fix: Record<string, string>) => (Object.prototype.hasOwnProperty.call(fix, w) ? fix[w] : w);

export async function runAutoEdit(o: AutoEditOptions): Promise<AutoEditResult> {
  const step = (s: AutoEditProgress['step'], progress: number, message: string) => o.onProgress?.({ step: s, progress, message });
  const check = () => {
    if (o.signal?.aborted) throw new CancelledError();
  };
  const dir = uniqueDir(o.root, projectName(o.src));
  await mkdir(join(dir, 'assets'), { recursive: true });
  await mkdir(join(dir, 'renders'), { recursive: true });
  await mkdir(join(dir, '.reel'), { recursive: true });
  const edit = initialEdit(o.src, { speed: o.speed, grade: o.grade, fix: o.fix });

  step(1, 0, 'Membuat proxy preview (540p)');
  const rawDuration = await probeDuration(o.src);
  await makeProxy(o.ffmpeg, o.src, join(dir, PROXY), edit.grade, rawDuration, o.signal, (f) => step(1, f, 'Membuat proxy preview (540p)'));
  check();

  step(2, 0, 'Transkripsi (Whisper, di PC ini)');
  let raw: RawWord[];
  let device: string | null = null;
  let fallback: string | null = null;
  let segStarts: number[] = o.segStartsOverride ?? [];
  if (o.wordsOverride) raw = o.wordsOverride;
  else {
    const r = await transcribe(o.whisper, {
      src: o.src,
      workDir: join(dir, 'renders'),
      out: join(dir, 'words-raw.json'),
      device: o.device,
      signal: o.signal,
      onProgress: (p) => step(2, p.progress, p.stage === 'transcribe' ? p.message : 'Memuat model Whisper'),
    });
    raw = r.words;
    device = r.device;
    fallback = r.fallback;
    segStarts = r.segStarts;
  }
  check();

  step(3, 0, 'Mencari hening dan retake');
  const { edb, duration } = await analyzeAudio(o.src);
  const cut = proposeCuts(raw, edb, duration);
  const words = cut.words; // dengan e_ref
  const retakes = detectRetakes(words);
  edit.segs = cutRetakes(cut.segs, words, retakes);
  const silences = Math.max(0, cut.segs.length - 1) + (cut.segs.length && cut.segs[0][0] > 0.3 ? 1 : 0);
  step(3, 1, 'Potongan siap');
  check();

  step(4, 0, 'Saran kata kunci (Rules)');
  const kept = keptWordIndices(edit.segs, words);
  const speed = Number(edit.speed);
  const fixed = words.map((w) => ({ ...w, w: applyFix(w.w, edit.fix ?? {}) }));
  const keywords = suggestKeywords(fixed, {
    candidates: kept,
    timeOf: (i) => srcToEdited(edit.segs, speed, words[i].s + 0.05) ?? words[i].s / speed,
    names: o.names,
    sentenceStarts: segStarts,
  });

  step(5, 0, 'Subtitle, kamera, dan SFX');
  const now = new Date().toISOString();
  const doc: ProjectDoc = {
    dir,
    edit,
    state: {
      version: 1,
      name: dir.split(/[\\/]/).pop()!,
      source: o.src,
      created: now,
      updated: now,
      duration,
      words,
      keywords,
      retakes,
      floor: cut.floor,
      keywordMode: 'rules',
      segStarts,
    },
    overlay: {},
  };
  const { timing } = await saveProject(doc);
  step(5, 1, 'Selesai');
  return {
    doc,
    summary: { silences, retakes: retakes.length, keywords: keywords.length, rawDuration, finalDuration: timing.duration, device, fallback },
  };
}
