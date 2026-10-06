import { spawn } from 'node:child_process';

// Lokasi binary bisa diganti (app membundel ffmpeg; tes memakai ffmpeg sistem).
let ffmpegBin = process.env.REEL_FFMPEG || 'ffmpeg';
let ffprobeBin = process.env.REEL_FFPROBE || 'ffprobe';

export function setFfmpegPaths(ffmpeg: string, ffprobe: string): void {
  ffmpegBin = ffmpeg;
  ffprobeBin = ffprobe;
}

export function ffmpegPath(): string {
  return ffmpegBin;
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

function run(bin: string, args: string[], opts: { signal?: AbortSignal } = {}): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, signal: opts.signal });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new FfmpegError(`${bin} keluar dengan kode ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`, err));
    });
  });
}

/** Jalankan ffmpeg dengan `-v error -y` di depan, sama seperti helper `run()` di skill. */
export function ffmpeg(args: string[], opts: { signal?: AbortSignal } = {}) {
  return run(ffmpegBin, ['-v', 'error', '-y', ...args], opts);
}

export function ffmpegRaw(args: string[], opts: { signal?: AbortSignal } = {}) {
  return run(ffmpegBin, args, opts);
}

export async function probeDuration(path: string): Promise<number> {
  const { stdout } = await run(ffprobeBin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]);
  return Number(stdout.toString().trim());
}

/** Decode audio ke PCM s16 mono pada sample rate tertentu, dikembalikan sebagai Float32 -1..1 (seperti /32768 di skill). */
export async function decodeMono16(path: string, sampleRate: number, filter?: string): Promise<Float32Array> {
  const args = ['-i', path, '-ac', '1', '-ar', String(sampleRate)];
  if (filter) args.push('-af', filter);
  args.push('-f', 's16le', '-');
  const { stdout } = await ffmpeg(args);
  const n = Math.floor(stdout.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = stdout.readInt16LE(i * 2) / 32768;
  return out;
}
