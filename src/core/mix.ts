// Port skill reel-edit `mix.py`: voice.wav + SFX dari cues.json -> renders/_mix.wav, plus laporan level.
//
// ATURAN STEVEN 04/10: TANPA musik latar, cukup SFX. Musik hanya kalau diminta untuk video tertentu:
//   {"style": "none"}                   DEFAULT — tanpa musik
//   {"file": "path.mp3", "start": 0}    file milik sendiri / berlisensi (ducking di bawah suara)
//   {"style": "piano" | "bright"}       musik sintetis miva-motion — fase 2 (belum di-port)
//   opsional: "lufs" (default -34), "duck_db" (default 8)
// Setelah mix, selisih suara vs musik harus >= 16 LU; kalau tidak, gagal.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg, ffmpegRaw } from './ffmpeg';
import { pyRound } from './py';
import type { CuesJson } from './types';

export const SR = 48000;
import { PEAK } from './levels';

export { PEAK };

const db = (x: number) => 10 ** (x / 20);

/** Stereo planar: [L, R], Float64. */
export type Stereo = [Float64Array, Float64Array];

/** Decode ke stereo 48 kHz float (sama dengan rd() di skill). */
export async function readStereo(path: string): Promise<Stereo> {
  const { stdout } = await ffmpeg(['-i', path, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-']);
  const n = Math.floor(stdout.length / 8);
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = stdout.readFloatLE(i * 8);
    R[i] = stdout.readFloatLE(i * 8 + 4);
  }
  return [L, R];
}

/** PCM s16 stereo, pemotongan seperti numpy astype("<i2") (truncate ke nol). */
export function toWav(x: Stereo): Buffer {
  const n = x[0].length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, x[c][i])) * 32767;
      data.writeInt16LE(Math.trunc(v), i * 4 + c * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Integrated loudness + true peak lewat ffmpeg ebur128 (sama dengan lufs() di skill). */
export async function lufs(path: string): Promise<{ i: number; peak: number }> {
  const { stderr } = await ffmpegRaw(['-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const tail = stderr.slice(stderr.lastIndexOf('Summary:'));
  const i = parseFloat(tail.split('I:')[1].split('LUFS')[0]);
  const peak = tail.includes('Peak:') ? parseFloat(tail.split('Peak:')[1].split('dBFS')[0]) : 0;
  return { i, peak };
}

function fit(x: Stereo, n: number): Stereo {
  const out: Stereo = [new Float64Array(n), new Float64Array(n)];
  const m = Math.min(n, x[0].length);
  out[0].set(x[0].subarray(0, m));
  out[1].set(x[1].subarray(0, m));
  return out;
}

export interface MixReport {
  voiceLufs: number;
  sfxLufs: number;
  musicLufs: number | null;
  mixLufs: number;
  mixPeak: number;
  sfxCount: number;
}

export interface MixOptions {
  /** id SFX -> path file .wav di pustaka */
  sfxPath: (id: string) => string;
}

/** Mix suara + SFX (+ musik file opsional) ke `<proj>/renders/_mix.wav`. */
export async function mix(proj: string, Q: CuesJson, opts: MixOptions): Promise<MixReport> {
  const dur = Q.duration;
  const n = Math.trunc(dur * SR);
  const voice = fit(await readStereo(join(proj, 'assets', 'voice.wav')), n);

  const sfx: Stereo = [new Float64Array(n), new Float64Array(n)];
  const cache = new Map<string, Stereo>();
  for (const c of Q.sfx) {
    let src = cache.get(c.id);
    if (!src) {
      src = await readStereo(opts.sfxPath(c.id));
      cache.set(c.id, src);
    }
    let peak = 0;
    for (const ch of src) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    // urutan operasi sama dengan numpy: y / (peak + 1e-9) * db(...)
    const den = peak + 1e-9;
    const lvl = db((PEAK[c.kat] ?? -20) + (c.gain_db ?? 0));
    let y: Stereo = [src[0].map((v) => (v / den) * lvl), src[1].map((v) => (v / den) * lvl)];
    let a = pyRound(c.t * SR);
    if (a < 0) {
      // riser yang mulai sebelum 0: pakai ekornya saja
      y = [y[0].subarray(-a), y[1].subarray(-a)];
      a = 0;
    }
    if (c.dur) {
      // ketik dipangkas sepanjang animasi ketik, fade 60 ms
      const L = Math.min(y[0].length, Math.trunc(c.dur * SR));
      y = [y[0].slice(0, L), y[1].slice(0, L)];
      const f = Math.min(L, Math.trunc(0.06 * SR));
      for (let k = 0; k < f; k++) {
        const w = f === 1 ? 1 : 1 - k / (f - 1); // np.linspace(1, 0, f)
        y[0][L - f + k] *= w;
        y[1][L - f + k] *= w;
      }
    }
    const b = Math.min(n, a + y[0].length);
    for (let i = a; i < b; i++) {
      sfx[0][i] += y[0][i - a];
      sfx[1][i] += y[1][i - a];
    }
  }

  let music: Stereo | null = null;
  const spec = Q.music ?? { style: 'none' };
  if (spec.file) {
    const m = await readStereo(spec.file);
    const a = Math.trunc((spec.start ?? 0) * SR);
    music = fit([m[0].subarray(a), m[1].subarray(a)], n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = Math.min(1, Math.max(0, t / 0.6)) * Math.min(1, Math.max(0, (dur - t) / 1.5));
      music[0][i] *= env;
      music[1][i] *= env;
    }
    // ducking: envelope suara (RMS 10 ms, attack cepat, release 300 ms) -> musik turun duck_db saat ada suara
    const hop = Math.trunc(0.01 * SR);
    const frames = Math.ceil(n / hop);
    const sm = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      let s = 0;
      let cnt = 0;
      for (let i = f * hop; i < Math.min(n, (f + 1) * hop); i++, cnt++) s += voice[0][i] ** 2 + voice[1][i] ** 2;
      const e = Math.sqrt(s / (cnt * 2));
      const act = Math.min(1, Math.max(0, (20 * Math.log10(e + 1e-9) + 42) / 10));
      const prev = f ? sm[f - 1] : 0;
      sm[f] = prev + (act - prev) * (act > prev ? 0.5 : 0.033);
    }
    const duck = Number(spec.duck_db ?? 8);
    for (let i = 0; i < n; i++) {
      const g = db(-duck * sm[Math.trunc(i / hop)]);
      music[0][i] *= g;
      music[1][i] *= g;
    }
    await writeFile(join(proj, 'renders', '_music.wav'), toWav(music));
    const mi = (await lufs(join(proj, 'renders', '_music.wav'))).i;
    const g = db(Number(spec.lufs ?? -34) - mi);
    for (let i = 0; i < n; i++) {
      music[0][i] *= g;
      music[1][i] *= g;
    }
  } else if (spec.style && spec.style !== 'none') {
    throw new Error(`Musik sintetis "${spec.style}" belum tersedia (fase 2). Pakai {"style": "none"} atau {"file": ...}.`);
  }

  const out: Stereo = [new Float64Array(n), new Float64Array(n)];
  let pk = 0;
  for (let c = 0; c < 2; c++)
    for (let i = 0; i < n; i++) {
      out[c][i] = voice[c][i] + sfx[c][i] + (music ? music[c][i] : 0);
      pk = Math.max(pk, Math.abs(out[c][i]));
    }
  if (pk > db(-1.0)) {
    const g = db(-1.0) / pk;
    for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) out[c][i] *= g;
  }
  const renders = join(proj, 'renders');
  if (music) await writeFile(join(renders, '_music.wav'), toWav(music));
  else await writeFile(join(renders, '_music.wav'), toWav([new Float64Array(n), new Float64Array(n)]));
  await writeFile(join(renders, '_sfx.wav'), toWav(sfx));
  await writeFile(join(renders, '_mix.wav'), toWav(out));

  const vi = (await lufs(join(proj, 'assets', 'voice.wav'))).i;
  const mi = music ? (await lufs(join(renders, '_music.wav'))).i : null;
  const si = (await lufs(join(renders, '_sfx.wav'))).i;
  const fin = await lufs(join(renders, '_mix.wav'));
  if (mi !== null && vi - mi < 16)
    throw new Error(`Musik terlalu keras dibanding suara (selisih ${(vi - mi).toFixed(1)} LU < 16). Turunkan music.lufs.`);
  return { voiceLufs: vi, sfxLufs: si, musicLufs: mi, mixLufs: fin.i, mixPeak: fin.peak, sfxCount: Q.sfx.length };
}
