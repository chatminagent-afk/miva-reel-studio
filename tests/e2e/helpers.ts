// Bantuan E2E: footage sintetis dengan kata asli tes2, Whisper palsu (sidecar asli + faster_whisper palsu), app terisolasi.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { ffmpeg } from '../../src/core/ffmpeg';

export const ROOT = join(__dirname, '..', '..');
export const ACUAN = join(ROOT, 'tests', 'fixtures', 'acuan-tes2');
export const acuanWords = () => JSON.parse(readFileSync(join(ACUAN, 'words-raw.json'), 'utf-8')) as { w: string; s: number; e: number }[];

/** Footage 37 dtk: semburan "suara" di posisi kata asli tes2 (energi pita suara cocok dengan kata). */
export async function makeRawFootage(path: string, seconds = 37.04): Promise<void> {
  const vol = acuanWords()
    .filter((w) => w.s < seconds)
    .map((w) => `between(t,${w.s},${w.e})`)
    .join('+');
  await ffmpeg([
    '-f', 'lavfi', '-i', `testsrc2=s=1080x1920:r=30:d=${seconds}`,
    '-f', 'lavfi', '-i', `anoisesrc=c=pink:r=48000:a=0.5:d=${seconds}`,
    '-filter_complex', `[1:a]bandpass=f=1200:width_type=o:w=2,volume='0.003+0.6*gt(${vol},0)':eval=frame[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', '-shortest', path,
  ]);
}

/** Lingkungan Whisper palsu: kata acuan tes2, awal segmen = kata berhuruf besar selain nama. */
export function fakeWhisperEnv(work: string): NodeJS.ProcessEnv {
  const words = acuanWords();
  const names = new Set(['CapCut,', 'Adobe', 'Premiere']);
  const starts = words.flatMap((w, i) => (/^[A-Z]/.test(w.w) && !names.has(w.w) ? [i] : []));
  const segments = starts.map((s, k) => words.slice(s, starts[k + 1] ?? words.length));
  const model = join(work, 'model');
  mkdirSync(model, { recursive: true });
  writeFileSync(join(model, 'model.bin'), '');
  writeFileSync(join(work, 'fw-spec.json'), JSON.stringify({ segments, cuda_devices: 0 }));
  return {
    REEL_PYTHON: 'python3',
    REEL_WHISPER_SITE: join(ROOT, 'tests', 'fixtures', 'fake_whisper_site'),
    REEL_WHISPER_MODEL: model,
    FAKE_FW_SPEC: join(work, 'fw-spec.json'),
  };
}

export async function launchApp(work: string, env: NodeJS.ProcessEnv = {}): Promise<{ app: ElectronApplication; win: Page }> {
  // REEL_E2E_EXE = jalankan app hasil packaging (release/*-unpacked) alih-alih out/main (dev)
  const exe = process.env.REEL_E2E_EXE;
  const app = await electron.launch({
    ...(exe ? { executablePath: exe, args: process.platform === 'linux' ? ['--no-sandbox'] : [] } : { args: ['--no-sandbox', resolve(ROOT, 'out/main/index.js')] }),
    env: { ...process.env, REEL_USER_DATA: join(work, 'userdata'), ...env },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  return { app, win };
}

/** Ganti dialog pilih file di proses utama (Playwright tidak bisa mengklik dialog OS). */
export async function stubOpenDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, path);
}
