// Template skill -> komposisi offline: "overlay saja" untuk export cepat, atau render penuh (fallback whip).
//
// Render penuh skill: Chrome men-screenshot video + kamera + subtitle tiap frame (lambat, dedup frame mati).
// Export cepat: Chrome hanya merender lapisan di atas video (subtitle, kata kunci, grafik, b-roll) di latar
// transparan; video + kamera digabung FFmpeg (lihat camera.ts dan export.ts).
//
// Tiap penggantian di sini wajib menemukan pola persisnya di template. Kalau template skill berubah dan pola
// hilang, fungsi gagal keras (lebih baik daripada diam-diam merender dengan CDN atau latar hitam).

export const VENDOR_DIR = 'assets/_vendor';

interface Swap {
  name: string;
  from: string | RegExp;
  to: string;
}

// Berlaku untuk semua render app (overlay saja maupun render penuh)
const OFFLINE_SWAPS: Swap[] = [
  // offline: font Google -> @font-face lokal di-inline (HyperFrames hanya membaca @font-face di HTML; kalau tidak ada,
  // compiler-nya mengunduh font dari Google diam-diam), GSAP CDN -> file lokal
  { name: 'preconnect Google Fonts', from: /^ *<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com" \/>\n/m, to: '' },
  {
    name: 'stylesheet Google Fonts',
    from: /^ *<link href="https:\/\/fonts\.googleapis\.com\/css2[^"]*" rel="stylesheet" \/>\n/m,
    to: '    <style id="vendor-fonts">\n__FONT_FACES__    </style>\n',
  },
  {
    name: 'GSAP CDN',
    from: '<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>',
    to: `<script src="${VENDOR_DIR}/gsap.min.js"></script>`,
  },
  // fallback font yang tidak dibundel dibuang: kalau tetap ada, compiler HyperFrames mencoba mengunduhnya
  { name: 'fallback Segoe UI', from: 'font-family: "Inter", "Segoe UI", sans-serif;', to: 'font-family: "Inter", sans-serif;' },
  { name: 'fallback Georgia', from: 'font-family: "Playfair Display", Georgia, serif;', to: 'font-family: "Playfair Display", serif;' },
];

// Khusus export cepat: tanpa footage, latar transparan
const OVERLAY_SWAPS: Swap[] = [
  {
    name: 'latar html/body',
    from: 'html, body { width: 1080px; height: 1920px; overflow: hidden; background: #000; }',
    to: 'html, body { width: 1080px; height: 1920px; overflow: hidden; background: transparent; }',
  },
  {
    name: 'latar #root',
    from: '#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #000; }',
    to: '#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: transparent; }',
  },
  { name: 'latar #bgl', from: '#bgl { position: absolute; inset: 0; background: #000; }', to: '#bgl { position: absolute; inset: 0; }' },
  // footage keluar dari komposisi; #aroll tetap ada sebagai div kosong supaya timeline kamera tetap valid
  { name: 'video footage', from: /<video id="aroll" class="clip" src="assets\/base\.mp4"[^>]*><\/video>/, to: '<div id="aroll"></div>' },
];

/** Template overlay saja (export cepat). `fontCss` = isi resources/render/fonts.css. */
export function toOverlayTemplate(tpl: string, fontCss: string): string {
  return applySwaps(tpl, fontCss, [...OFFLINE_SWAPS, ...OVERLAY_SWAPS]);
}

/** Template render penuh offline (footage + kamera di Chrome, seperti skill): dipakai kalau kamera tidak bisa di FFmpeg (whip). */
export function toFullTemplate(tpl: string, fontCss: string): string {
  return applySwaps(tpl, fontCss, OFFLINE_SWAPS);
}

function applySwaps(tpl: string, fontCss: string, swaps: Swap[]): string {
  let out = tpl.replace(/\r\n/g, '\n'); // template skill ditulis di Windows (CRLF)
  for (const s of swaps) {
    const hit = typeof s.from === 'string' ? out.includes(s.from) : s.from.test(out);
    if (!hit) throw new Error(`Template skill berubah: pola "${s.name}" tidak ditemukan`);
    out = typeof s.from === 'string' ? out.split(s.from).join(s.to) : out.replace(s.from, () => s.to);
  }
  const faces = fontCss
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `      ${l.replaceAll('__FONTS__', `${VENDOR_DIR}/fonts`)}\n`)
    .join('');
  return out.replace('__FONT_FACES__', () => faces);
}

/**
 * URL jaringan di HTML akhir (http/https/protocol-relative). Export menolak komposisi yang masih punya URL luar:
 * Chrome render akan mengambilnya langsung, di luar penjaga offline proses Node.
 */
export function externalUrls(html: string): string[] {
  const found = new Set<string>();
  // atribut src/href dan url(...) di CSS; xmlns/skema JSON bukan request jaringan
  const re = /(?:\b(?:src|href|poster|data-src)\s*=\s*["']|url\(\s*["']?|@import\s+["'])((?:https?:)?\/\/[^"')\s]+)/gi;
  for (const m of html.matchAll(re)) found.add(m[1]);
  return [...found];
}
