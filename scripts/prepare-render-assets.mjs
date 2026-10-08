// Siapkan aset render offline dari paket npm (dijalankan otomatis oleh `npm install` lewat postinstall):
//   resources/render/fonts.css       @font-face lokal (di-inline ke komposisi, jadi HyperFrames tidak mengunduh dari Google)
//   resources/render/fonts/*.woff2   file font (@fontsource, sumber sama dengan Google Fonts)
//   resources/render/gsap.min.js     GSAP (template skill memakai CDN jsDelivr)
//
// Set face = persis yang tersedia saat skill merender online, supaya hasil identik:
//   Inter: compiler HyperFrames meminta normal 100–900 + italic 400/700 (URL default fetchGoogleFont).
//   Playfair Display: default compiler (normal 400–900, italic 400/700) + link template (italic 600/700/800).
//   Montserrat: hanya normal 600 + 800 (wordmark MIVA di motion graphic, src/core/motion); tidak dipakai template skill.
// Weight/style lain sengaja TIDAK dibundel: browser harus memilih face terdekat yang sama dengan render skill.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'resources', 'render');
const require = createRequire(join(ROOT, 'package.json'));

const SUBSETS = ['latin', 'latin-ext'];
const FAMILIES = [
  { pkg: '@fontsource/inter', normal: [100, 200, 300, 400, 500, 600, 700, 800, 900], italic: [400, 700] },
  { pkg: '@fontsource/playfair-display', normal: [400, 500, 600, 700, 800, 900], italic: [400, 600, 700, 800] },
  { pkg: '@fontsource/montserrat', normal: [600, 800], italic: [] },
];

function pkgDir(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'fonts'), { recursive: true });

const rules = [];
const versions = {};
for (const fam of FAMILIES) {
  const dir = pkgDir(fam.pkg);
  versions[fam.pkg] = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).version;
  const faces = [...fam.normal.map((w) => [w, 'normal']), ...fam.italic.map((w) => [w, 'italic'])];
  for (const [weight, style] of faces) {
    const css = readFileSync(join(dir, `${weight}${style === 'italic' ? '-italic' : ''}.css`), 'utf-8');
    for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const file = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
      if (!file || !SUBSETS.some((s) => file.includes(`-${s}-${weight}-${style}.woff2`))) continue;
      copyFileSync(join(dir, 'files', file), join(OUT, 'fonts', file));
      const family = block.match(/font-family:\s*'([^']+)'/)[1];
      const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
      rules.push(
        `@font-face { font-family: "${family}"; font-style: ${style}; font-weight: ${weight}; font-display: block; ` +
          `src: url("__FONTS__/${file}") format("woff2");${range ? ` unicode-range: ${range};` : ''} }`,
      );
    }
  }
}
const expected = FAMILIES.reduce((n, f) => n + (f.normal.length + f.italic.length) * SUBSETS.length, 0);
if (rules.length !== expected) throw new Error(`fonts.css: ${rules.length} face, seharusnya ${expected}`);
writeFileSync(join(OUT, 'fonts.css'), rules.join('\n') + '\n');

const gsap = join(pkgDir('gsap'), 'dist', 'gsap.min.js');
if (!existsSync(gsap)) throw new Error('gsap.min.js tidak ditemukan');
copyFileSync(gsap, join(OUT, 'gsap.min.js'));
versions.gsap = JSON.parse(readFileSync(join(pkgDir('gsap'), 'package.json'), 'utf-8')).version;

writeFileSync(join(OUT, 'versions.json'), JSON.stringify(versions, null, 2) + '\n');
console.log(`resources/render siap: ${rules.length} font face, gsap ${versions.gsap}`);
