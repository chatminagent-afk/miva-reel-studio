// Sidecar Whisper dengan faster_whisper palsu (tests/fixtures/fake_whisper_site): format words-raw.json sama dengan
// skill, setelan transkripsi, pemilihan GPU/CPU + fallback, progress, batal, penjaga offline.
// Model asli tidak ada di sesi cloud (HuggingFace diblokir); tes dengan library asli ada di whisper.real.test.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CancelledError } from '../../src/core/proc';
import { checkWhisper, parseSidecarLine, sidecarArgs, transcribe, WhisperError, type WhisperRuntime } from '../../src/core/whisper';

const ROOT = join(__dirname, '..', '..');
const CASES = join(ROOT, 'tests', 'fixtures', 'cases');
// -I sama dengan cara sidecar dijalankan: numpy di user site (mis. Python Microsoft Store) tidak terlihat oleh sidecar
const hasPython = spawnSync('python3', ['-I', '-c', 'import numpy'], { encoding: 'utf-8' }).status === 0;

let work: string;
let n = 0;

/** Runtime + spec palsu baru per tes. */
function setup(spec: Record<string, unknown>, opts: { model?: boolean } = {}) {
  const dir = join(work, `t${++n}`);
  mkdirSync(dir, { recursive: true });
  const modelDir = join(dir, 'model');
  if (opts.model !== false) {
    mkdirSync(modelDir);
    writeFileSync(join(modelDir, 'model.bin'), '');
  }
  const record = join(dir, 'record.jsonl');
  writeFileSync(join(dir, 'spec.json'), JSON.stringify({ record, ...spec }));
  process.env.FAKE_FW_SPEC = join(dir, 'spec.json');
  const rt: WhisperRuntime = {
    python: 'python3',
    sidecar: join(ROOT, 'resources', 'whisper', 'sidecar.py'),
    site: join(ROOT, 'tests', 'fixtures', 'fake_whisper_site'),
    modelDir,
  };
  const calls = () => (existsSync(record) ? readFileSync(record, 'utf-8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { dir, rt, calls, out: join(dir, 'words-raw.json') };
}

const caseWords = (c: string) => JSON.parse(readFileSync(join(CASES, c, 'input.json'), 'utf-8')).words;
const audio = (c: string) => join(CASES, c, 'audio.wav');

describe.skipIf(!hasPython)('sidecar Whisper (faster_whisper palsu)', () => {
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'reel-whisper-'));
  });
  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
    delete process.env.FAKE_FW_SPEC;
  });

  it.each(['basic', 'nokeys', 'speed1_warm'])('words-raw.json identik dengan transcribe.py skill: %s', async (c) => {
    const { dir, rt, out } = setup({ words: caseWords(c), cuda_devices: 0 });
    const r = await transcribe(rt, { src: audio(c), workDir: dir, out });
    expect(readFileSync(out, 'utf-8')).toBe(readFileSync(join(CASES, c, 'golden', 'words-raw.json'), 'utf-8'));
    expect(r.words).toEqual(JSON.parse(readFileSync(out, 'utf-8')));
    expect([r.device, r.computeType]).toEqual(['cpu', 'int8']);
    expect(r.fallback).toMatch(/tidak ada GPU CUDA/);
    expect(r.blocked).toEqual([]);
  });

  it('GPU tersedia: CUDA float16, dites hangat dulu, setelan sama dengan skill, audio = load16k skill', async () => {
    const { dir, rt, out, calls } = setup({ words: caseWords('basic'), cuda_devices: 1, cuda: 'ok' });
    const r = await transcribe(rt, { src: audio('basic'), workDir: dir, out });
    expect([r.device, r.computeType, r.fallback]).toEqual(['cuda', 'float16', null]);
    const c = calls();
    expect(c[0]).toMatchObject({ call: 'init', device: 'cuda', compute_type: 'float16', local_files_only: true, model: rt.modelDir });
    expect(c[1]).toMatchObject({ call: 'transcribe', warmup: true });
    // WAV int16 asli / 32768, seperti skill
    const wav = readFileSync(audio('basic'));
    const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length));
    expect(c[2]).toMatchObject({
      call: 'transcribe',
      warmup: false,
      language: 'id',
      beam_size: 5,
      word_timestamps: true,
      vad_filter: false,
      initial_prompt: null,
      hotwords: null,
      dtype: 'float32',
      n: pcm.length,
      extra: [],
    });
    expect(c[2].head).toEqual([...pcm.slice(0, 4)].map((v) => v / 32768));
  });

  it.each([
    ['load_error', /no CUDA-capable device/],
    ['warmup_error', /cudnn_ops64_9\.dll/],
  ])('CUDA gagal (%s): pindah ke CPU int8 dengan alasan', async (mode, reason) => {
    const { dir, rt, out } = setup({ words: caseWords('basic'), cuda_devices: 1, cuda: mode });
    const r = await transcribe(rt, { src: audio('basic'), workDir: dir, out });
    expect([r.device, r.computeType]).toEqual(['cpu', 'int8']);
    expect(r.fallback).toMatch(reason);
  });

  it('DLL CUDA membuat proses mati tanpa pesan: diulang sekali di CPU', async () => {
    const { dir, rt, out, calls } = setup({ words: caseWords('basic'), cuda_devices: 1, cuda: 'crash' });
    const r = await transcribe(rt, { src: audio('basic'), workDir: dir, out });
    expect([r.device, r.computeType]).toEqual(['cpu', 'int8']);
    expect(r.fallback).toBe('sidecar CUDA berhenti (kode 3)');
    expect(calls().filter((x) => x.call === 'init').map((x) => x.device)).toEqual(['cuda', 'cpu']);
    expect(readFileSync(out, 'utf-8')).toBe(readFileSync(join(CASES, 'basic', 'golden', 'words-raw.json'), 'utf-8'));
  });

  it('device cuda dipaksa: gagal = error, tidak diam-diam ke CPU', async () => {
    const { dir, rt, out } = setup({ words: caseWords('basic'), cuda_devices: 1, cuda: 'load_error' });
    await expect(transcribe(rt, { src: audio('basic'), workDir: dir, out, device: 'cuda' })).rejects.toMatchObject({ code: 'cuda' });
  });

  it('model tidak ada: error model_missing, tidak diulang', async () => {
    const { dir, rt, out, calls } = setup({ words: caseWords('basic'), cuda_devices: 1 }, { model: false });
    const p = transcribe(rt, { src: audio('basic'), workDir: dir, out });
    await expect(p).rejects.toBeInstanceOf(WhisperError);
    await expect(p).rejects.toMatchObject({ code: 'model_missing' });
    expect(calls()).toEqual([]);
    expect(existsSync(out)).toBe(false);
  });

  it('progress per segmen naik sampai 1; prompt dan hotwords diteruskan', async () => {
    const w = caseWords('basic');
    const { dir, rt, out, calls } = setup({ segments: [w.slice(0, 5), w.slice(5, 12), w.slice(12)], cuda_devices: 0 });
    const prog: number[] = [];
    const r = await transcribe(rt, {
      src: audio('basic'),
      workDir: dir,
      out,
      initialPrompt: 'CapCut, Claude',
      hotwords: 'MIVA',
      onProgress: (p) => p.stage === 'transcribe' && prog.push(p.progress),
    });
    expect(prog.length).toBe(4); // loaded + 3 segmen
    prog.forEach((v, i) => i && expect(v).toBeGreaterThan(prog[i - 1]));
    expect(calls().at(-1)).toMatchObject({ initial_prompt: 'CapCut, Claude', hotwords: 'MIVA' });
    expect(r.segStarts).toEqual([0, 5, 12]);
    expect(JSON.parse(readFileSync(out, 'utf-8')).length).toBe(w.length);
  });

  it('batal saat transkripsi: proses Python berhenti, words-raw.json tidak ditulis', async () => {
    const w = caseWords('basic');
    const { dir, rt, out } = setup({ segments: [w.slice(0, 5), w.slice(5)], delay: 3, cuda_devices: 0 });
    const ac = new AbortController();
    const p = transcribe(rt, { src: audio('basic'), workDir: dir, out, signal: ac.signal, onProgress: (x) => x.stage === 'transcribe' && ac.abort() });
    await expect(p).rejects.toBeInstanceOf(CancelledError);
    await new Promise((r) => setTimeout(r, 300));
    expect(spawnSync('pgrep', ['-f', `${dir}/spec.json`]).status).not.toBe(0);
    expect(spawnSync('pgrep', ['-f', 'sidecar.py.*' + dir]).status).not.toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it('penjaga offline: koneksi ke internet dari proses sidecar diblokir dan dilaporkan', async () => {
    const { dir, rt, out } = setup({ words: caseWords('basic'), cuda_devices: 0, network: true });
    const r = await transcribe(rt, { src: audio('basic'), workDir: dir, out });
    expect(r.blocked).toEqual(['203.0.113.7:80']);
  });

  it('check: versi dan kecocokan parameter API', async () => {
    const { rt } = setup({ cuda_devices: 2 });
    expect(await checkWhisper(rt)).toMatchObject({ faster_whisper: '1.2.1-fake', ctranslate2: '4.8.2-fake', cuda_devices: 2, missing_params: [] });
  });
});

describe('protokol sidecar', () => {
  it('argumen: Python terisolasi (-I) dan tanpa buffer (-u)', () => {
    const rt = { python: 'py', sidecar: 's.py', site: 'site', modelDir: 'm' };
    expect(sidecarArgs(rt, { audio: 'a.wav', out: 'o.json', device: 'auto' })).toEqual([
      '-I', '-u', 's.py', '--site', 'site', '--model', 'm', '--audio', 'a.wav', '--out', 'o.json', '--device', 'auto',
    ]);
    expect(sidecarArgs(rt, { audio: 'a', out: 'o', device: 'cpu', initialPrompt: 'x y' })).toEqual(expect.arrayContaining(['--initial-prompt', 'x y']));
  });

  it('baris non-JSON diabaikan', () => {
    expect(parseSidecarLine('{"type":"progress","t":1,"duration":2}')).toEqual({ type: 'progress', t: 1, duration: 2 });
    expect(parseSidecarLine('Traceback (most recent call last):')).toBeNull();
    expect(parseSidecarLine('{rusak')).toBeNull();
  });
});
