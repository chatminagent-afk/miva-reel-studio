// Akses API proses utama (preload). Renderer tidak punya akses Node; semua lewat sini.
import type { ReelApi } from '../../preload';

declare global {
  interface Window {
    reel: ReelApi;
  }
}

export const api = (): ReelApi => window.reel;

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(2).padStart(5, '0')}`;
}

export function fmtShort(s: number): string {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

/** Pesan error yang ramah untuk kode dari proses utama (UI berbahasa Inggris, detail asli tetap ditampilkan). */
export function friendlyError(message: string, code?: string): string {
  if (code === 'model_missing') return 'Whisper model is not installed. Reinstall the app or run fetch-resources.';
  if (code === 'audio') return 'Could not read the audio of this file.';
  if (/base\.mp4 belum ada/.test(message)) return 'Run Auto Edit first.';
  return message;
}
