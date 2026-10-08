// Ikon garis inline untuk komponen motion. Semua viewBox 40x40, tanpa isian; warna garis dari CSS (`currentColor`)
// lewat `.mv-i`, jadi satu ikon dipakai di kartu gelap (garis terang) maupun tile terang (garis gelap).
// Gaya mengikuti ikon skill /reel-edit (stroke ±2.6, ujung bulat). 'logo' memakai tanda gradien (logo.ts).
import type { IconName } from './types';
import { logoMark } from './logo';

const P: Record<Exclude<IconName, 'logo'>, string> = {
  person: '<circle cx="20" cy="14" r="6.5"/><path d="M7 34c1.5-7 7-11 13-11s11.5 4 13 11"/>',
  bubble: '<path d="M8 10h24a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H18l-7 6v-6H8a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3z"/>',
  phone: '<rect x="11" y="4" width="18" height="32" rx="4"/><path d="M18 31h4"/>',
  briefcase: '<rect x="5" y="13" width="30" height="20" rx="3"/><path d="M15 13V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4M5 21h30"/>',
  chart: '<path d="M6 34h28"/><rect x="9" y="20" width="5" height="12"/><rect x="18" y="13" width="5" height="19"/><rect x="27" y="7" width="5" height="25"/>',
  check: '<path d="M10 21l7 7 14-15"/>',
  warn: '<path d="M20 5l17 30H3z"/><path d="M20 16v9M20 30v.5"/>',
  box: '<path d="M6 13l14-7 14 7v15l-14 7-14-7z"/><path d="M6 13l14 7 14-7M20 20v15"/>',
  team: '<circle cx="14" cy="14" r="5"/><circle cx="27" cy="15" r="4.5"/><path d="M4 33c1-6 5-9 10-9s9 3 10 9M23 24c5 0 9 3 10 9"/>',
  clock: '<circle cx="20" cy="21" r="13"/><path d="M20 13v8l5 4M16 4h8"/>',
  inbox: '<path d="M5 22l5-14h20l5 14v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M5 22h9l2 4h8l2-4h9"/>',
  bolt: '<path d="M23 4L9 23h10l-2 13 14-19H21z"/>',
  money: '<rect x="4" y="11" width="32" height="18" rx="3"/><circle cx="20" cy="20" r="4.5"/><path d="M9 20h.5M30.5 20h.5"/>',
  cart: '<path d="M4 7h5l4 20h18l3-14H11"/><circle cx="15" cy="33" r="2.5"/><circle cx="28" cy="33" r="2.5"/>',
  calendar: '<rect x="6" y="9" width="28" height="25" rx="4"/><path d="M6 17h28M13 5v8M27 5v8"/>',
  star: '<path d="M20 5l4.6 9.6 10.4 1.4-7.6 7.3 1.9 10.4L20 28.8 10.7 33.7l1.9-10.4L5 16l10.4-1.4z"/>',
  heart: '<path d="M20 34S6 25 6 15a7.5 7.5 0 0 1 14-3.5A7.5 7.5 0 0 1 34 15c0 10-14 19-14 19z"/>',
};

export const ICON_NAMES = [...Object.keys(P), 'logo'] as IconName[];

/** SVG ikon. 'logo' = tanda MIVA berwarna (butuh LOGO_DEFS di dokumen). */
export function icon(name: IconName): string {
  if (name === 'logo') return logoMark();
  const body = P[name] ?? P.bubble;
  return `<svg class="mv-i" viewBox="0 0 40 40">${body}</svg>`;
}

/** Ikon chip status: centang, peringatan (segitiga), atau stop (lingkaran silang). */
export function chipIcon(kind: 'check' | 'warn' | 'stop'): string {
  const body =
    kind === 'check' ? P.check : kind === 'warn' ? P.warn : '<circle cx="20" cy="20" r="14"/><path d="M14 14l12 12M26 14L14 26"/>';
  return `<svg class="mv-i" viewBox="0 0 40 40">${body}</svg>`;
}
