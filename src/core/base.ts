// Port skill reel-edit `build_base.py`: edit.json (src, segs, fix, grade, speed) -> assets/base.mp4 (tanpa audio),
// assets/voice.wav (-14 LUFS) dan timing.json.
//
// - Potongan `segs` digabung (fade audio 20/30 ms tiap sambungan supaya tidak "klik"), lalu dipercepat `speed`
//   (default 1,25x; video setpts, suara atempo yang menjaga pitch). Semua waktu di timing.json = waktu SESUDAH percepat.
// - Grade preset atau string filter ffmpeg sendiri di edit.json "grade".
// - Suara: highpass 90 Hz, denoise ringan, kompresor, loudnorm -14 LUFS (standar Reels).
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg } from './ffmpeg';
import { pyFixed, pyFloatStr } from './py';
import { mapTiming, SPEED_DEFAULT, tailOf, type TimingResult } from './timing';
import type { EditJson, RawWord } from './types';

export { mapTiming, SPEED_DEFAULT, type TimingResult };


export const GRADES: Record<string, string> = {
  // disetujui di tes-edit v1 (03/10): footage HP siang, interior terang, kulit sedikit hangat
  natural:
    'eq=contrast=1.06:brightness=0.008:saturation=1.12:gamma=0.98,' +
    'colorbalance=rs=0.02:bs=-0.025:rm=0.015:bm=-0.015,' +
    "curves=master='0/0 0.25/0.23 0.75/0.77 1/0.98',unsharp=5:5:0.45,vignette=angle=PI/5:mode=forward",
  // lebih kontras & hangat ala referensi (kafe/indoor malam)
  warm:
    'eq=contrast=1.10:saturation=1.10:gamma=0.97,colorbalance=rs=0.04:gs=0.01:bs=-0.04:rm=0.03:bm=-0.03:rh=0.02:bh=-0.02,' +
    "curves=master='0/0.02 0.25/0.22 0.75/0.78 1/0.97',unsharp=5:5:0.4,vignette=angle=PI/4.5:mode=forward",
  // footage gelap/flat: angkat bayangan dulu
  lift:
    "eq=contrast=1.04:brightness=0.03:saturation=1.10:gamma=0.92,curves=master='0/0.03 0.3/0.33 0.7/0.75 1/0.98'," +
    'unsharp=5:5:0.45,vignette=angle=PI/5:mode=forward',
};

export function resolveGrade(grade: string | undefined): string {
  const g = grade ?? 'natural';
  return GRADES[g] ?? g;
}

/** filter_complex persis seperti build_base.py. */
export function buildBaseFilter(edit: EditJson): string {
  const speed = Number(edit.speed ?? SPEED_DEFAULT);
  const grade = resolveGrade(edit.grade);
  const parts: string[] = [];
  let labels = '';
  edit.segs.forEach(([a, b], i) => {
    const d = b - a;
    const A = pyFloatStr(a);
    const B = pyFloatStr(b);
    parts.push(
      `[0:v]trim=${A}:${B},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=${A}:${B},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${pyFixed(d - 0.03, 3)}:d=0.03[a${i}];`,
    );
    labels += `[v${i}][a${i}]`;
  });
  const sp = pyFloatStr(speed);
  const sv = speed !== 1 ? `setpts=PTS/${sp},` : '';
  const sa = speed !== 1 ? `atempo=${sp},` : '';
  // tail: freeze frame terakhir + hening sesudah kata terakhir (ruang end card); persis build_base.py
  const tail = tailOf(edit);
  const vt = tail ? `,tpad=stop_mode=clone:stop_duration=${pyFloatStr(tail)}` : '';
  const at = tail ? `,apad=pad_dur=${pyFloatStr(tail)}` : '';
  return (
    parts.join('') +
    `${labels}concat=n=${edit.segs.length}:v=1:a=1[vc][ac];` +
    `[vc]${sv}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${grade}${vt},format=yuv420p[vo];` +
    `[ac]${sa}highpass=f=90,afftdn=nr=12:nf=-30,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,` +
    `loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000${at}[ao]`
  );
}

/** Tiga perintah ffmpeg build_base.py (tanpa `-v error -y` yang ditambahkan helper). */
export function buildBaseCommands(edit: EditJson, proj: string): string[][] {
  const mov = join(proj, 'assets', '_base.mov');
  return [
    ['-i', edit.src, '-filter_complex', buildBaseFilter(edit), '-map', '[vo]', '-map', '[ao]', '-r', '30',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-g', '15', '-c:a', 'pcm_s16le', mov],
    ['-i', mov, '-an', '-c:v', 'copy', '-movflags', '+faststart', join(proj, 'assets', 'base.mp4')],
    ['-i', mov, '-vn', '-c:a', 'copy', join(proj, 'assets', 'voice.wav')],
  ];
}

/** Jalankan build base lengkap (ffmpeg) dan kembalikan timing. */
export async function buildBase(edit: EditJson, words: RawWord[], proj: string, signal?: AbortSignal): Promise<TimingResult> {
  await mkdir(join(proj, 'assets'), { recursive: true });
  const [encode, video, audio] = buildBaseCommands(edit, proj);
  await ffmpeg(encode, { signal });
  await ffmpeg(video, { signal });
  await ffmpeg(audio, { signal });
  await unlink(join(proj, 'assets', '_base.mov'));
  return mapTiming(edit, words);
}

