// Tanda logo MIVA (balon chat + panah naik) sebagai SVG inline. Sumber vektor: skill /reel-edit assets/miva-logo-mark.svg.
//
// Gradasi dipasang SATU kali per dokumen (LOGO_DEFS, disuntik buildMotionOverlay) dengan id unik "mv-logo-g", jadi tidak
// bentrok dengan "mivaG" milik overlay.html tulisan tangan skill yang bisa ikut di dokumen yang sama. gradientUnits
// userSpaceOnUse: koordinat gradasi mengikuti viewBox 295x180 tiap tanda, ukuran tampilan diatur CSS (.mv-mk).

export const LOGO_GRAD_ID = 'mv-logo-g';

/** SVG 0x0 berisi definisi gradasi. Tempel sekali di awal HTML motion (bukan display:none: gradasi hilang di Chrome). */
export const LOGO_DEFS =
  `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>` +
  `<linearGradient id="${LOGO_GRAD_ID}" gradientUnits="userSpaceOnUse" x1="0" y1="175" x2="290" y2="5">` +
  `<stop offset="0" stop-color="#2a3ca8"/><stop offset=".45" stop-color="#1c7fd0"/><stop offset="1" stop-color="#22d6ee"/>` +
  `</linearGradient></defs></svg>`;

/** 4 path logo. Fill/stroke eksplisit di tiap path supaya stroke induk (ikon garis) tidak menimpa segitiga. */
const MARK_PATHS =
  `<path d="M15 128L9 173L57 151Z" fill="url(#${LOGO_GRAD_ID})"/>` +
  `<path d="M30 132C8 106 10 56 48 37C86 18 126 36 136 72C145 104 158 122 172 117C190 108 228 58 256 32" fill="none" stroke="url(#${LOGO_GRAD_ID})" stroke-width="17"/>` +
  `<path d="M52 146C76 158 106 150 124 126" fill="none" stroke="url(#${LOGO_GRAD_ID})" stroke-width="15" stroke-linecap="round"/>` +
  `<path d="M287 4L271 48L243 19Z" fill="url(#${LOGO_GRAD_ID})"/>`;

/** Tanda logo. Lebar diatur CSS lewat kelas induk (mis. `.mv-lg-card .mv-mk { width: 150px }`). */
export function logoMark(extraClass = ''): string {
  const cls = ('mv-mk ' + extraClass).trim();
  return `<svg class="${cls}" viewBox="0 0 295 180">${MARK_PATHS}</svg>`;
}
