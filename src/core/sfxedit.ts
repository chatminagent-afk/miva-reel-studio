// Edit SFX di app: SFX manual = edit.json "sfx" (format skill), SFX otomatis yang dimatikan = edit.json "sfx_off"
// (khusus app; skill mengabaikannya, jadi /reel-edit akan memunculkan lagi bunyi yang dimatikan).
import type { CuesJson, EditJson, SfxCue } from './types';

export interface SfxOff {
  kat: string;
  /** waktu cue (detik hasil edit) saat dimatikan */
  t: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.06;

export function sfxOff(edit: EditJson): SfxOff[] {
  return Array.isArray(edit.sfx_off) ? (edit.sfx_off as SfxOff[]) : [];
}

export function isOff(c: Pick<SfxCue, 'kat' | 't'>, off: SfxOff[]): boolean {
  return off.some((o) => o.kat === c.kat && near(o.t, c.t));
}

/** Buang cue otomatis yang dimatikan pengguna (dipakai export dan preview). */
export function applySfxOff(cues: CuesJson, edit: EditJson): CuesJson {
  const off = sfxOff(edit);
  return off.length ? { ...cues, sfx: cues.sfx.filter((c) => !isOff(c, off)) } : cues;
}

/** Indeks entri edit.sfx yang menghasilkan cue ini (SFX manual, selalu ber-id di app), atau -1 kalau otomatis. */
export function manualMatch(c: SfxCue, edit: EditJson, features: Record<string, { dur: number; peak_at: number }>): number {
  if (c.prio < 3) return -1;
  return (edit.sfx ?? []).findIndex((m) => {
    if (!m.id || m.id !== c.id) return false;
    const shift = m.align && features[m.id] ? features[m.id].peak_at * features[m.id].dur : 0;
    return near(m.t - shift, c.t);
  });
}
