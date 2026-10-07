// Port skill reel-edit `cover.py`: cover JPG Reels = frame talking-head + judul di tengah atas (di atas kepala),
// baris kecil Inter putih + baris besar serif italic emas (gaya kata kunci). Dirender Chrome headless bawaan (offline).
// Beda dari skill: baris kecil Inter italic 700 (skill 800; 800 italic tidak dibundel supaya set font komposisi tetap
// sama dengan render skill).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ffmpeg } from './ffmpeg';
import { runProcess } from './proc';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Judul format skill: baris dipisah '|', baris diawali '*' = besar emas. */
export function coverLines(title: string): string {
  return title
    .split('|')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const big = raw.startsWith('*');
      const t = esc(raw.replace(/^\*+|\*+$/g, '').trim());
      if (!big) return `<div class="small">${t}</div>`;
      const size = t.length <= 9 ? 168 : Math.max(104, Math.trunc(((168 * 9) / t.length) * 1.25));
      return `<div class="big" style="font-size:${size}px">${t}</div>`;
    })
    .join('');
}

export function coverHtml(frameUrl: string, title: string, fontFaces: string, zoom = 1.06): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }
#bg { position: absolute; inset: 0; background: url("${frameUrl}") center 55% / cover no-repeat; transform: scale(${zoom}); transform-origin: 50% 50%; }
#shade { position: absolute; left: 0; right: 0; top: 0; height: 900px;
  background: linear-gradient(180deg, rgba(8,10,12,0.62) 0%, rgba(8,10,12,0.40) 45%, rgba(8,10,12,0) 100%); }
#ttl { position: absolute; left: 70px; right: 70px; top: 300px; height: 380px; display: flex; flex-direction: column;
  justify-content: center; align-items: center; text-align: center; gap: 6px; }
.small { font-family: Inter, sans-serif; font-style: italic; font-weight: 700; font-size: 58px; letter-spacing: -1px; color: #fff;
  text-shadow: 0 3px 16px rgba(0,0,0,0.65); line-height: 1.1; }
.big { font-family: "Playfair Display", serif; font-style: italic; font-weight: 800; line-height: 0.98; letter-spacing: -4px;
  color: #ffd65a; -webkit-text-stroke: 3px rgba(40,24,0,0.55); paint-order: stroke fill;
  text-shadow: 0 6px 28px rgba(20,12,0,0.6), 0 1px 2px rgba(0,0,0,0.5); max-width: 940px; }
</style></head><body><div id="bg"></div><div id="shade"></div><div id="ttl">${coverLines(title)}</div></body></html>`;
}

export interface CoverOptions {
  base: string;
  /** detik di base.mp4 */
  t: number;
  title: string;
  out: string;
  workDir: string;
  browser: string;
  /** isi resources/render/fonts.css dan folder font-nya */
  fontCss: string;
  fontsDir: string;
  signal?: AbortSignal;
}

export async function renderCover(o: CoverOptions): Promise<void> {
  const frame = join(o.workDir, '_cover-frame.png');
  await ffmpeg(['-ss', String(Math.max(0, o.t)), '-i', o.base, '-frames:v', '1', frame], { signal: o.signal });
  const faces = o.fontCss.replaceAll('__FONTS__', pathToFileURL(o.fontsDir).href);
  const page = join(o.workDir, '_cover.html');
  await writeFile(page, coverHtml(pathToFileURL(frame).href, o.title, faces));
  const png = join(o.workDir, '_cover.png');
  const args = ['--headless', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1080,1920', `--screenshot=${png}`, '--allow-file-access-from-files'];
  if (process.platform === 'linux') args.unshift('--no-sandbox'); // root di Linux (dev/CI)
  await runProcess(o.browser, [...args, pathToFileURL(page).href], { signal: o.signal });
  await ffmpeg(['-i', png, '-q:v', '2', o.out], { signal: o.signal }); // q 2 ≈ JPEG kualitas 92 (skill)
}
