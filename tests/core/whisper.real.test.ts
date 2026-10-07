// Sidecar dengan faster-whisper + ctranslate2 ASLI (site Linux dari lock, `npm run fetch-resources`).
// Model large-v3-turbo tidak tersedia di sesi cloud (HuggingFace diblokir), jadi yang dites: versi terkunci ter-import,
// API cocok dengan parameter yang dipakai sidecar, dan kegagalan model terbaca rapi tanpa diulang percuma.
// Transkripsi sungguhan (akurasi, CUDA) diuji di mesin yang punya model: laptop Steven / CI.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkWhisper, transcribe, type WhisperRuntime } from '../../src/core/whisper';

const ROOT = join(__dirname, '..', '..');
const SITE = join(ROOT, 'resources', 'bin', 'linux64', 'whisper-site');
const hasSite = process.platform === 'linux' && existsSync(join(SITE, 'faster_whisper'));
const AUDIO = join(ROOT, 'tests', 'fixtures', 'cases', 'basic', 'audio.wav');

describe.skipIf(!hasSite)('sidecar Whisper dengan library asli', () => {
  let work: string;
  const rt = (modelDir: string): WhisperRuntime => ({ python: 'python3', sidecar: join(ROOT, 'resources', 'whisper', 'sidecar.py'), site: SITE, modelDir });
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), 'reel-whisper-real-'));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('versi terkunci ter-import dan semua parameter yang dipakai ada di API', async () => {
    expect(await checkWhisper(rt(''))).toMatchObject({ python: expect.stringMatching(/^3\.13\./), faster_whisper: '1.2.1', ctranslate2: '4.8.2', missing_params: [] });
  });

  it('folder model kosong: error model_missing', async () => {
    const m = join(work, 'kosong');
    mkdirSync(m);
    await expect(transcribe(rt(m), { src: AUDIO, workDir: work, out: join(work, 'a.json') })).rejects.toMatchObject({ code: 'model_missing' });
  });

  it('model rusak di mesin tanpa GPU: gagal di CPU dengan pesan ctranslate2, tidak diulang', async () => {
    const m = join(work, 'rusak');
    mkdirSync(m);
    writeFileSync(join(m, 'model.bin'), 'bukan model');
    const prog: string[] = [];
    await expect(transcribe(rt(m), { src: AUDIO, workDir: work, out: join(work, 'b.json'), onProgress: (p) => prog.push(p.message) })).rejects.toMatchObject({
      code: 'internal',
    });
    expect(prog).not.toContain('GPU failed, using CPU');
  });
});
