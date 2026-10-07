// Transkripsi lewat sidecar faster-whisper (resources/whisper/sidecar.py): footage -> words-raw.json (format skill).
//
// Audio di-decode di sini dengan ffmpeg app, sama persis dengan load16k() skill (WAV 16 kHz mono), lalu sidecar
// memuat model large-v3-turbo: CUDA float16 kalau GPU jalan, kalau tidak CPU int8 (keputusan langkah 2, 06/10).
// Kalau DLL CUDA rusak sampai proses sidecar mati tanpa pesan, transkripsi diulang sekali di CPU.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg } from './ffmpeg';
import { CancelledError, ProcError, runProcess } from './proc';
import type { RawWord } from './types';

export interface WhisperRuntime {
  python: string;
  /** resources/whisper/sidecar.py */
  sidecar: string;
  /** folder site-packages (faster-whisper, ctranslate2, DLL CUDA) */
  site: string;
  /** folder model CTranslate2 (model.bin, config.json, tokenizer.json, ...) */
  modelDir: string;
}

export type WhisperDevice = 'auto' | 'cuda' | 'cpu';

export interface TranscribeOptions {
  /** footage mentah */
  src: string;
  /** folder kerja (WAV 16 kHz sementara ditulis di sini, sama dengan renders/ skill) */
  workDir: string;
  /** words-raw.json */
  out: string;
  device?: WhisperDevice;
  language?: string;
  initialPrompt?: string;
  hotwords?: string;
  signal?: AbortSignal;
  onProgress?: (p: TranscribeProgress) => void;
}

export interface TranscribeProgress {
  stage: 'decode' | 'load' | 'transcribe';
  /** 0..1 untuk tahap transcribe (posisi audio), selain itu 0 */
  progress: number;
  message: string;
}

export interface TranscribeResult {
  words: RawWord[];
  device: 'cuda' | 'cpu';
  computeType: string;
  /** alasan tidak memakai CUDA (null kalau CUDA dipakai atau device dipaksa cpu) */
  fallback: string | null;
  loadSeconds: number;
  transcribeSeconds: number;
  duration: number;
  /** koneksi jaringan yang diblokir penjaga offline sidecar (harus kosong) */
  blocked: string[];
  /** indeks kata pertama tiap segmen Whisper (awal kalimat) */
  segStarts: number[];
}

export type SidecarEvent =
  | { type: 'start'; python: string; faster_whisper: string }
  | { type: 'trying'; device: 'cuda' | 'cpu' }
  | { type: 'loaded'; device: 'cuda' | 'cpu'; compute_type: string; load_s: number; fallback: string | null }
  | { type: 'progress'; t: number; duration: number }
  | { type: 'done'; words: number; out: string; transcribe_s: number; duration: number; seg_starts: number[] }
  | { type: 'check'; python: string; faster_whisper: string; ctranslate2: string; cuda_devices: number; missing_params: string[] }
  | { type: 'error'; code: 'model_missing' | 'audio' | 'cuda' | 'internal'; message: string };

export class WhisperError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'WhisperError';
  }
}

export function parseSidecarLine(line: string): SidecarEvent | null {
  if (!line.startsWith('{')) return null;
  try {
    const ev = JSON.parse(line) as SidecarEvent;
    return typeof ev.type === 'string' ? ev : null;
  } catch {
    return null;
  }
}

/** -I: abaikan PYTHONPATH/site user (lingkungan Python Steven tidak boleh memengaruhi app); -u: event tidak tertahan buffer. */
export function sidecarArgs(rt: WhisperRuntime, o: { audio: string; out: string; device: WhisperDevice } & Pick<TranscribeOptions, 'language' | 'initialPrompt' | 'hotwords'>): string[] {
  const a = ['-I', '-u', rt.sidecar, '--site', rt.site, '--model', rt.modelDir, '--audio', o.audio, '--out', o.out, '--device', o.device];
  if (o.language) a.push('--language', o.language);
  if (o.initialPrompt) a.push('--initial-prompt', o.initialPrompt);
  if (o.hotwords) a.push('--hotwords', o.hotwords);
  return a;
}

/** Decode audio seperti load16k() skill: ffmpeg -ac 1 -ar 16000 -> WAV int16. */
export async function prepareAudio16k(src: string, wav: string, signal?: AbortSignal): Promise<void> {
  await ffmpeg(['-i', src, '-ac', '1', '-ar', '16000', wav], { signal });
}

interface RunOutcome {
  events: SidecarEvent[];
  blocked: string[];
  failure?: unknown;
}

async function runSidecar(rt: WhisperRuntime, args: string[], o: TranscribeOptions): Promise<RunOutcome> {
  const events: SidecarEvent[] = [];
  const blocked: string[] = [];
  try {
    await runProcess(rt.python, args, {
      signal: o.signal,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      onStdoutLine: (l) => {
        const ev = parseSidecarLine(l);
        if (!ev) return;
        events.push(ev);
        if (ev.type === 'loaded') o.onProgress?.({ stage: 'transcribe', progress: 0, message: `Transkripsi (${ev.device === 'cuda' ? 'GPU' : 'CPU'})` });
        if (ev.type === 'progress') o.onProgress?.({ stage: 'transcribe', progress: Math.min(1, ev.t / ev.duration), message: 'Transkripsi' });
      },
      onStderrLine: (l) => {
        const b = /^\[offline-guard\] blocked (.+)$/.exec(l);
        if (b) blocked.push(b[1]);
      },
    });
    return { events, blocked };
  } catch (failure) {
    if (failure instanceof CancelledError) throw failure;
    return { events, blocked, failure };
  }
}

/** Transkripsi footage -> words-raw.json + daftar kata. */
export async function transcribe(rt: WhisperRuntime, o: TranscribeOptions): Promise<TranscribeResult> {
  const audio = join(o.workDir, '_a16k.wav');
  o.onProgress?.({ stage: 'decode', progress: 0, message: 'Membaca audio' });
  await prepareAudio16k(o.src, audio, o.signal);
  o.onProgress?.({ stage: 'load', progress: 0, message: 'Memuat model Whisper' });

  const requested = o.device ?? 'auto';
  let run = await runSidecar(rt, sidecarArgs(rt, { ...o, audio, device: requested }), o);
  let crashNote: string | null = null;
  const err = (r: RunOutcome) => r.events.find((e): e is Extract<SidecarEvent, { type: 'error' }> => e.type === 'error');
  // device yang sedang dipakai/dicoba saat proses gagal (event trying/loaded terakhir)
  const usedCuda = (r: RunOutcome) => {
    const last = r.events.filter((e) => e.type === 'trying' || e.type === 'loaded').at(-1);
    return last !== undefined && (last.type === 'trying' || last.type === 'loaded') && last.device === 'cuda';
  };
  // proses mati (atau gagal di CUDA) saat memakai/mencoba GPU -> ulang sekali di CPU; error model/audio tidak diulang
  const e1 = err(run);
  if (run.failure && requested === 'auto' && usedCuda(run) && (!e1 || e1.code === 'cuda' || e1.code === 'internal')) {
    const code = run.failure instanceof ProcError ? run.failure.code : null;
    crashNote = e1 ? `CUDA gagal: ${e1.message}` : `sidecar CUDA berhenti (kode ${code})`;
    o.onProgress?.({ stage: 'load', progress: 0, message: 'GPU gagal, memakai CPU' });
    const retry = await runSidecar(rt, sidecarArgs(rt, { ...o, audio, device: 'cpu' }), o);
    run = { ...retry, blocked: [...run.blocked, ...retry.blocked] };
  }
  if (run.failure) {
    const e = err(run);
    if (e) throw new WhisperError(e.message, e.code);
    const f = run.failure as Error;
    throw new WhisperError(`Sidecar Whisper gagal: ${f.message}`, 'internal');
  }
  const loaded = run.events.find((e): e is Extract<SidecarEvent, { type: 'loaded' }> => e.type === 'loaded');
  const done = run.events.find((e): e is Extract<SidecarEvent, { type: 'done' }> => e.type === 'done');
  if (!loaded || !done) throw new WhisperError('Sidecar Whisper selesai tanpa hasil', 'internal');
  const words = JSON.parse(await readFile(o.out, 'utf-8')) as RawWord[];
  return {
    words,
    device: loaded.device,
    computeType: loaded.compute_type,
    fallback: crashNote ?? loaded.fallback,
    loadSeconds: loaded.load_s,
    transcribeSeconds: done.transcribe_s,
    duration: done.duration,
    blocked: run.blocked,
    segStarts: done.seg_starts ?? [],
  };
}

/** Diagnostik instalasi: versi, jumlah GPU CUDA, kecocokan API faster-whisper dengan parameter yang dipakai. */
export async function checkWhisper(rt: Pick<WhisperRuntime, 'python' | 'sidecar' | 'site'>): Promise<Extract<SidecarEvent, { type: 'check' }>> {
  const got: { check?: Extract<SidecarEvent, { type: 'check' }>; error?: Extract<SidecarEvent, { type: 'error' }> } = {};
  const failure = await runProcess(rt.python, ['-I', '-u', rt.sidecar, '--site', rt.site, '--check'], {
    onStdoutLine: (l) => {
      const ev = parseSidecarLine(l);
      if (ev?.type === 'check') got.check = ev;
      if (ev?.type === 'error') got.error = ev;
    },
  }).then(
    () => null,
    (e: Error) => e,
  );
  // --check keluar dengan kode 1 kalau ada parameter API yang hilang; hasilnya tetap dikembalikan
  if (got.check) return got.check;
  throw new WhisperError(got.error?.message ?? failure?.message ?? 'check tanpa hasil', got.error?.code ?? 'internal');
}
