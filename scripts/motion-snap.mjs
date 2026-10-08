// Harness dev motion: render komponen motion ke template skill ASLI (toOverlayTemplate + renderTemplate), di atas satu frame
// footage, di headless Chrome (Playwright + chrome-headless-shell bawaan app), seek timeline GSAP ke waktu tertentu, simpan PNG,
// dan cek seek-safety (screenshot di t harus identik setelah scrub ke mana-mana lalu kembali).
//
// Pakai:
//   node scripts/motion-snap.mjs --demo all                       # semua demo miva-3 (counter, toasts, chain, chat, ...)
//   node scripts/motion-snap.mjs --demo chat,logo --scale 0.5     # sebagian, PNG 540x960 (sama dengan frame rujukan skill)
//   node scripts/motion-snap.mjs items.json --times 1.8,2.6       # item sendiri (JSON), waktu sendiri
//
// items.json = array ResolvedMotion ({id, kind, props, t0, t1, beatTimes?, scene?}) atau {items, times?, duration?, name?}.
// Opsi: --out DIR (default scratchpad a2-snap), --bg frame.png (default: frame 5 dtk dari reels/7 okt/3.MP4), --scale 0.5,
//       --no-seek-check, --keep (jangan hapus html kerja). Keluar dengan kode 1 bila seek-safety / error halaman / URL luar gagal.
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = 'C:/Users/Steven/AppData/Local/Temp/claude/D--Documents-Claude-Cowork/8ae0574f-36d4-4d6b-9e4b-5e6bf34e624f/scratchpad/a2-snap';
const FOOTAGE = 'D:/Documents/Claude Cowork/MIVA/reels/7 okt/3.MP4';
const CHROME = join(ROOT, 'resources/bin/win64/chrome-headless-shell/chrome-headless-shell-win64/chrome-headless-shell.exe');
const FFMPEG = join(ROOT, 'resources/bin/win64/ffmpeg/ffmpeg-8.0-essentials_build/bin/ffmpeg.exe');

// ---------- argumen ----------
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const OUT = resolve(opt('--out', SCRATCH));
const SCALE = Number(opt('--scale', '1'));
const SEEK_CHECK = !flag('--no-seek-check');
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--out', '--scale', '--bg', '--times', '--demo'].includes(args[i - 1])));

// ---------- demo: props meniru miva-3 (waktu = detik di video hasil potong miva-3, dari marks.json) ----------
const NM = [0.496, 0.976, 1.488, 1.904, 2.224, 2.672];
const DEMOS = {
  hook: {
    // g01: counter + toasts
    items: [
      { id: 'cnt', kind: 'counter', t0: 0.068, t1: 3.356 + 0.22, beatTimes: [2.064, 2.672], props: { label: 'UNREAD MESSAGES', icon: 'phone', tone: 'red', values: [12, 27, 43] } },
      { id: 'nm', kind: 'toasts', t0: 0.496, t1: 3.356 + 0.22, beatTimes: NM, props: { items: Array(6).fill('NEW MESSAGE'), icon: 'bubble', shake: true } },
    ],
    times: [0.9, 1.8, 2.5, 3.0],
  },
  statement: {
    // g05: freeze di dalam adegan
    items: [{ id: 'big5', kind: 'statement', scene: true, t0: 14.724, t1: 15.992 + 0.25, props: { line1: 'Mungkin bukan', line2: 'customer-nya.', style: 'serif', flash: true } }],
    times: [14.9, 15.5],
  },
  statement2: {
    items: [
      { id: 'sp', kind: 'statement', t0: 1, t1: 5, beatTimes: [2.5], props: { line1: 'Standby', line2: '24/7', style: 'pill', strike: ['24/7'], accent: [] } },
      { id: 'sp2', kind: 'statement', t0: 6, t1: 9, props: { line2: 'Your system should work too.', style: 'pill', accent: ['work too.'] } },
    ],
    times: [2.0, 3.2, 7.2],
  },
  chain: {
    // g06 / g06b
    items: [{
      id: 'c6', kind: 'chain', t0: 16.112, t1: 18.812 + 0.22, beatTimes: [16.112, 16.242, 16.372, 16.502, 16.632, 16.762, 16.992, 17.604, 18.204],
      props: {
        nodes: [
          { label: 'CUSTOMER', icon: 'person' }, { label: '', icon: 'bubble' }, { label: 'YOU', icon: 'person', tone: 'mint' },
          { label: '', icon: 'bubble' }, { label: 'YOU', icon: 'person', tone: 'mint' }, { label: '', icon: 'bubble' },
        ],
        alert: [2, 4],
        morph: [
          { label: 'CUSTOMER', icon: 'person' }, { label: '', icon: 'bubble' },
          { label: 'MIVA', icon: 'logo', tone: 'cyan' }, { label: 'DONE', icon: 'check', tone: 'green' },
        ],
        caption: 'Your system should work too.',
        captionAccent: ['work too.'],
      },
    }],
    times: [16.5, 17.2, 17.56, 18.0, 18.6],
  },
  chat: {
    // g08 / g08b: adegan chat 2 kasus
    items: [{
      id: 'w8', kind: 'chat', scene: true, t0: 20.772, t1: 26.832 + 0.25,
      beatTimes: [20.968, 21.302, 23.352, 23.896, 24.19, 24.624, 24.85, 26.336],
      props: {
        title: 'MIVA AI', status: 'online', logo: true,
        steps: [
          { from: 'cus', text: 'Harga berapa?' }, { from: 'bot', text: 'Untuk paket A, harganya…' },
          { from: 'chip', text: 'LEAD', sub: 'Saved', tone: 'green' }, { from: 'chip', text: 'FOLLOW-UP', sub: 'Scheduled', tone: 'green' },
          { from: 'clear' },
          { from: 'cus', text: 'Pesanan saya bermasalah.' }, { from: 'bot', text: 'Aku bantu teruskan ke admin ya.' },
          { from: 'chip', text: 'HUMAN ADMIN', tone: 'green' },
        ],
      },
    }],
    times: [21.2, 21.8, 22.6, 23.7, 25.0, 25.8, 26.6],
  },
  logo: {
    // g07: bubble ditarik lalu logo
    items: [{ id: 'lg', kind: 'logo', t0: 18.852, t1: 20.722 + 0.22, beatTimes: [19.63, 19.97], props: { sub: 'AI AUTOMATION', tagline: 'AI CUSTOMER SERVICE', gather: true } }],
    times: [19.2, 19.5, 19.9, 20.4],
  },
  chips: {
    items: [{ id: 'ch', kind: 'chips', t0: 1, t1: 5, props: { items: [
      { label: 'LEAD', sub: 'Saved', icon: 'check', tone: 'green' }, { label: 'FOLLOW-UP', sub: 'Scheduled', icon: 'check', tone: 'green' },
      { label: 'NEEDS HUMAN', icon: 'warn', tone: 'amber' }, { label: 'SPAM', sub: 'Blocked', icon: 'stop', tone: 'red' },
    ] } }],
    times: [1.3, 2.0, 3.4, 4.2],
  },
  variants: {
    // variasi props di luar miva-3: kalimat panjang + sorot, rantai tanpa morph, toast bernama, counter hijau, chat dengan admin
    items: [
      { id: 'v1', kind: 'statement', t0: 0.5, t1: 3.5, props: { line1: 'Bukan lagi sibuk urus bisnis,', line2: 'tapi sibuk urus inbox.', style: 'serif', accent: ['inbox.'] } },
      { id: 'v2', kind: 'chain', t0: 4, t1: 8, props: { nodes: [
        { label: 'LEAD', icon: 'person' }, { label: 'FOLLOW-UP', icon: 'calendar', tone: 'cyan' }, { label: 'HUMAN ADMIN', icon: 'team', tone: 'mint' },
        { label: 'PAID', icon: 'money', tone: 'green' }, { label: 'REPEAT', icon: 'heart', tone: 'gold' }], alert: [2], caption: 'Semua tercatat otomatis.', captionAccent: ['otomatis.'] } },
      { id: 'v3', kind: 'toasts', t0: 8.5, t1: 12.5, props: { items: ['Rina | Kak, harganya?', 'Dimas | Masih ada?', 'Sari | Bisa COD?', 'Andi | Promo kak?', 'Maya | Halo kak', 'Budi | Ready?', 'Tono | Ongkir?', 'Lina | Stok?', 'Eko | Kak??'], icon: 'bubble', shake: true } },
      { id: 'v4', kind: 'counter', t0: 13, t1: 17, props: { label: 'CHAT MASUK', icon: 'bubble', tone: 'green', values: [10, 50, 100] } },
      { id: 'v5', kind: 'chat', scene: true, t0: 17.5, t1: 25, props: { title: 'Toko Bunga Sari', status: 'terakhir dilihat hari ini', logo: false, steps: [
        { from: 'cus', text: 'Kak, paket saya rusak. Bisa refund?' }, { from: 'bot', text: 'Maaf ya kak, aku catat dulu dan teruskan ke admin.' },
        { from: 'chip', text: 'NEEDS HUMAN', tone: 'amber' }, { from: 'human', text: 'Halo kak, admin di sini. Boleh kirim foto barangnya?' },
        { from: 'cus', text: 'Ini kak.' }] } },
    ],
    times: [1.8, 6.5, 7.6, 10.5, 15.5, 21.5, 23.8],
  },
  phone: {
    // g04: HP lock-screen di dalam adegan (waktu miva-3)
    items: [{
      id: 'ph', kind: 'phone', scene: true, t0: 11.772, t1: 14.544 + 0.28,
      beatTimes: [12.072, 12.452, 12.832, 13.212, 13.592, 12.716, 13.036, 13.324, 13.394],
      props: {
        clocks: ['08:12', '12:47', '18:36', '22:51'],
        notifs: [{ app: 'WhatsApp', text: 'Harga berapa kak?' }, { app: 'WhatsApp', text: 'Masih buka?' }, { app: 'WhatsApp', text: 'Bisa booking besok?' },
          { app: 'WhatsApp', text: 'Kak, ready?' }, { app: 'WhatsApp', text: 'Halo kak?' }],
        status: 'Still replying', dayNight: true,
      },
    }],
    times: [12.2, 12.8, 13.3, 13.9],
  },
  split: {
    // g02 / g02b: BUSINESS vs CHAT, banjir menutupi BUSINESS (waktu miva-3)
    items: [{
      id: 'sp', kind: 'split', t0: 3.806, t1: 8.468 + 0.25,
      beatTimes: [3.806, 4.016, 4.208, 4.416, 5.256, 5.406, 5.5335, 5.661, 5.7885, 5.966],
      props: {
        left: { title: 'BUSINESS', items: ['Sales', 'Marketing', 'Team'], tone: 'mint' },
        right: { title: 'CHAT', items: ['Harga?', 'Ready kak?', 'Ongkir?', 'Promo?'], tone: 'red' },
        flood: true,
        bubbles: ['Kak?', 'Bisa COD?', 'Halo?', 'Masih buka?', 'Stok ada?', 'P', 'Kak??', 'Bisa kirim?', 'Harga?', 'Booking?', 'Halo kak', 'Diskon?', '??', 'Jam buka?'],
      },
    }],
    times: [4.5, 5.5, 6.26, 7.6],
  },
  bubbles: {
    // g03: pertanyaan itu-itu lagi -> loop (waktu miva-3)
    items: [{ id: 'lp', kind: 'bubbles', t0: 8.658, t1: 11.652 + 0.25, beatTimes: [8.658, 9.522, 10.322, 10.944], props: { mode: 'loop', items: ['Harga berapa?', 'Buka jam berapa?', 'Bisa booking?'] } }],
    times: [9.0, 10.2, 11.2, 11.6],
  },
  bubbles2: {
    // tiga mode lain: stack, gather, flood
    items: [
      { id: 'b1', kind: 'bubbles', t0: 1, t1: 5, props: { mode: 'stack', items: ['Harga berapa?', 'Buka jam berapa?', 'Bisa booking?', 'Ready kak?'] } },
      { id: 'b2', kind: 'bubbles', t0: 6, t1: 10, props: { mode: 'gather', items: ['Harga?', 'Ready kak?', 'Ongkir?', 'Promo?', 'Bisa COD?', 'Halo kak', 'Stok ada?', 'Booking?'] } },
      { id: 'b3', kind: 'bubbles', t0: 11, t1: 15, props: { mode: 'flood', items: ['Harga?', 'Ready kak?', 'Ongkir?', 'Promo?', 'Bisa COD?', 'Halo kak', 'Stok ada?', 'Booking?', 'Kak?', 'P', 'Halo?', 'Diskon?'] } },
    ],
    times: [2.5, 4.4, 6.6, 7.4, 8.4, 12, 13.5, 14.5],
  },
  endcard: {
    // g10: end card di akhir video (waktu miva-3); durasi video = t1, jadi kartu tidak keluar
    items: [{ id: 'ec', kind: 'endcard', t0: 29.646, t1: 32, beatTimes: [29.796, 29.996, 30.246], props: { title: 'MIVA', sub: 'AI AUTOMATION', tagline: 'AI Customer Service', cta: 'Chat nomor di BIO' } }],
    duration: 32,
    times: [29.7, 29.95, 30.7],
  },
  toggle: {
    items: [{ id: 'tg', kind: 'toggle', t0: 1, t1: 6, beatTimes: [2.2, 3.1], props: { from: 'Balas manual', to: 'Dibalas otomatis' } }],
    times: [1.6, 2.5, 3.0, 3.6, 5.2],
  },
  cta: {
    items: [{ id: 'ct', kind: 'cta', t0: 1, t1: 7, beatTimes: [1.2, 1.8, 2.4, 4.0], props: { pills: ['COMMENT', 'DM', 'CHAT NOMOR DI BIO'], tap: true } }],
    times: [1.5, 2.6, 3.9, 4.15, 4.4],
  },
  cta2: {
    // varian miva-2 (tanpa tap): semua pill putih, pill terakhir berikon plus
    items: [{ id: 'c2', kind: 'cta', t0: 1, t1: 6, beatTimes: [1.2, 1.7, 2.2], props: { pills: ['COMMENT', 'DM', 'CHAT IN BIO'], tap: false } }],
    times: [2.6],
  },
  mix13: {
    // semua 13 kind berurutan (~47 dtk), dua adegan bertumpuk (phone + statement) dan chat sebagai adegan terpisah
    items: [
      { id: 'k0', kind: 'counter', t0: 0.5, t1: 3.5, props: { label: 'UNREAD MESSAGES', icon: 'phone', tone: 'red', values: [12, 27, 43] } },
      { id: 'k1', kind: 'toasts', t0: 1, t1: 4, props: { items: Array(6).fill('NEW MESSAGE'), icon: 'bubble', shake: true } },
      { id: 'k2', kind: 'split', t0: 4.5, t1: 9.5, props: {
        left: { title: 'BUSINESS', items: ['Sales', 'Marketing', 'Team'], tone: 'mint' }, right: { title: 'CHAT', items: ['Harga?', 'Ready kak?', 'Ongkir?', 'Promo?'], tone: 'red' },
        flood: true, bubbles: ['Kak?', 'Bisa COD?', 'Halo?', 'Masih buka?', 'Stok ada?', 'P', 'Kak??', 'Bisa kirim?'] } },
      { id: 'k3', kind: 'bubbles', t0: 10, t1: 13, props: { mode: 'loop', items: ['Harga berapa?', 'Buka jam berapa?', 'Bisa booking?'] } },
      { id: 'k4', kind: 'phone', scene: true, t0: 13.2, t1: 18, props: {
        clocks: ['08:12', '12:47', '18:36', '22:51'], notifs: [{ app: 'WhatsApp', text: 'Harga berapa kak?' }, { app: 'WhatsApp', text: 'Masih buka?' }, { app: 'WhatsApp', text: 'Bisa booking besok?' }, { app: 'WhatsApp', text: 'Kak, ready?' }],
        status: 'Still replying', dayNight: true } },
      { id: 'k5', kind: 'statement', scene: true, t0: 17.5, t1: 20, props: { line1: 'Mungkin bukan', line2: 'customer-nya.', style: 'serif', flash: true } },
      { id: 'k6', kind: 'chain', t0: 20.5, t1: 25, props: {
        nodes: [{ label: 'CUSTOMER', icon: 'person' }, { label: '', icon: 'bubble' }, { label: 'YOU', icon: 'person', tone: 'mint' }, { label: '', icon: 'bubble' }, { label: 'YOU', icon: 'person', tone: 'mint' }, { label: '', icon: 'bubble' }],
        alert: [2, 4], morph: [{ label: 'CUSTOMER', icon: 'person' }, { label: '', icon: 'bubble' }, { label: 'MIVA', icon: 'logo', tone: 'cyan' }, { label: 'DONE', icon: 'check', tone: 'green' }],
        caption: 'Your system should work too.', captionAccent: ['work too.'] } },
      { id: 'k7', kind: 'logo', t0: 25.2, t1: 28, props: { sub: 'AI AUTOMATION', tagline: 'AI CUSTOMER SERVICE', gather: true } },
      { id: 'k8', kind: 'chat', scene: true, t0: 28.5, t1: 34, props: { title: 'MIVA AI', status: 'online', logo: true, steps: [
        { from: 'cus', text: 'Harga berapa?' }, { from: 'bot', text: 'Untuk paket A, harganya…' }, { from: 'chip', text: 'LEAD', sub: 'Saved', tone: 'green' }, { from: 'chip', text: 'FOLLOW-UP', sub: 'Scheduled', tone: 'green' }] } },
      { id: 'k9', kind: 'chips', t0: 34.5, t1: 37, props: { items: [{ label: 'LEAD', sub: 'Saved', icon: 'check', tone: 'green' }, { label: 'NEEDS HUMAN', icon: 'warn', tone: 'amber' }] } },
      { id: 'k10', kind: 'toggle', t0: 37.2, t1: 40, props: { from: 'Balas manual', to: 'Dibalas otomatis' } },
      { id: 'k11', kind: 'cta', t0: 40.2, t1: 43, props: { pills: ['COMMENT', 'DM', 'CHAT NOMOR DI BIO'], tap: true } },
      { id: 'k12', kind: 'endcard', t0: 43.5, t1: 47, props: { title: 'MIVA', sub: 'AI AUTOMATION', tagline: 'AI Customer Service', cta: 'Chat nomor di BIO' } },
    ],
    duration: 47,
    times: [2, 7, 11.5, 15.5, 18.6, 22.5, 26.5, 30, 35.5, 38.5, 41.5, 42.4, 45.5],
  },
  mix: {
    // beberapa jenis berurutan + adegan (uji gabungan)
    items: [
      { id: 'a', kind: 'counter', t0: 0.5, t1: 3.5, props: { label: 'CHAT MASUK', icon: 'bubble', tone: 'green', values: [10, 50, 100] } },
      { id: 'b', kind: 'statement', scene: true, t0: 4, t1: 6.5, props: { line1: 'Tapi', line2: 'tetap natural.', style: 'serif' } },
      { id: 'c', kind: 'chat', scene: true, t0: 6.6, t1: 11, props: { title: 'MIVA AI', status: 'online', logo: true, steps: [{ from: 'cus', text: 'Halo kak' }, { from: 'bot', text: 'Halo! Ada yang bisa aku bantu?' }] } },
      { id: 'd', kind: 'logo', t0: 11.5, t1: 14, props: { sub: 'AI AUTOMATION', tagline: 'AI CUSTOMER SERVICE', gather: false } },
    ],
    times: [1.5, 5.2, 9, 12.5],
  },
};

// ---------- siapkan item ----------
function normalize(items) {
  return items.map((it) => ({ start: { word: 0 }, beatTimes: [], ...it }));
}

function loadJobs() {
  const jobs = [];
  const demo = opt('--demo', '');
  if (demo) {
    const names = demo === 'all' ? Object.keys(DEMOS) : demo.split(',');
    for (const n of names) {
      if (!DEMOS[n]) throw new Error(`demo "${n}" tidak ada (${Object.keys(DEMOS).join(', ')})`);
      jobs.push({ name: n, items: normalize(DEMOS[n].items), times: DEMOS[n].times, duration: DEMOS[n].duration });
    }
  }
  for (const f of positional) {
    const raw = JSON.parse(readFileSync(f, 'utf-8'));
    const items = Array.isArray(raw) ? raw : raw.items;
    const base = f.replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
    jobs.push({ name: raw.name ?? base, items: normalize(items), times: raw.times, duration: raw.duration });
  }
  const t = opt('--times', '');
  if (t) for (const j of jobs) j.times = t.split(',').map(Number);
  if (!jobs.length) throw new Error('Tidak ada pekerjaan: pakai --demo all atau path items.json');
  return jobs;
}

// ---------- bundel kode app (TS) -> modul node ----------
async function bundleApp() {
  mkdirSync(OUT, { recursive: true });
  const out = join(OUT, '_app-bundle.mjs');
  await build({
    stdin: {
      contents:
        "export * from './src/core/motion/index.ts';\n" +
        "export { toOverlayTemplate, externalUrls } from './src/core/overlay.ts';\n" +
        "export { renderTemplate } from './src/core/compose.ts';\n",
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'error',
  });
  return import(pathToFileURL(out).href + '?v=' + Date.now());
}

// ---------- direktori kerja (aset vendor + latar) ----------
function prepareWork(bgArg) {
  const work = join(OUT, 'work');
  const vendor = join(work, 'assets/_vendor');
  mkdirSync(join(vendor, 'fonts'), { recursive: true });
  const fontSrc = join(ROOT, 'resources/render/fonts');
  for (const f of readdirSync(fontSrc)) if (!existsSync(join(vendor, 'fonts', f))) copyFileSync(join(fontSrc, f), join(vendor, 'fonts', f));
  copyFileSync(join(ROOT, 'resources/render/gsap.min.js'), join(vendor, 'gsap.min.js'));
  let bg = bgArg ? resolve(bgArg) : join(OUT, 'bg.png');
  if (!existsSync(bg)) {
    // frame 1080x1920 dari footage mentah (ffmpeg memutar sesuai metadata rotasi otomatis), crop tengah
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', '5', '-i', FOOTAGE, '-frames:v', '1',
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920', bg]);
  }
  copyFileSync(bg, join(work, 'assets/bg.png'));
  return work;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.css': 'text/css' };
function serve(dir) {
  const srv = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const f = join(dir, p);
    if (!f.startsWith(dir) || !existsSync(f)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }).end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, port: srv.address().port })));
}

// ---------- render satu pekerjaan ----------
function composeHtml(app, tpl, fontCss, job) {
  const items = job.items.map((it) => ({ ...it }));
  const overlay = app.buildMotionOverlay(items, { onError: (it, e) => { throw new Error(`build ${it.kind}/${it.id}: ${e?.stack ?? e}`); } });
  const duration = job.duration ?? Math.max(...items.map((i) => i.t1)) + 0.6;
  const data = { duration, cuts: [], caps: [], keys: [], camera: [], inserts: [], origin: '50% 40%', cps: 60, lines: {}, words: [], marks: {} };
  // overlay transparan persis seperti export cepat (footage digabung terpisah); blur footage adegan ditiru saat penyusunan PNG
  const html = app.renderTemplate(app.toOverlayTemplate(tpl, fontCss), data, { css: overlay.css, html: overlay.html, js: overlay.js });
  return { html, overlay, duration };
}

// keadaan gaya terhitung semua elemen motion (untuk menunjuk elemen yang tidak seek-safe saat screenshot beda)
const DUMP = () => {
  const out = {};
  document.querySelectorAll('[id^="mv-"], [id^="mv-"] *').forEach((e, i) => {
    const c = getComputedStyle(e);
    out[(e.id || e.className || e.tagName) + '#' + i] = [c.transform, c.opacity, c.display, c.filter, c.color, c.backgroundColor, c.borderTopColor, c.boxShadow, c.clipPath, e.getAttribute('style')].join(' | ');
  });
  return out;
};
// footage + overlay transparan -> PNG akhir. Blur footage di adegan: ramp 0,3 dtk masuk/keluar, 14px (sama dengan skill)
async function compose(page, port, overlayPng, t, scenes) {
  let v = 0;
  for (const sc of scenes) {
    const p = Math.min(1, Math.max(0, (t - sc.s) / 0.3), Math.max(0, (sc.e - t) / 0.3));
    v = Math.max(v, 1 - (1 - p) * (1 - p));
  }
  await page.setContent(
    `<body style="margin:0;width:1080px;height:1920px;position:relative;overflow:hidden;background:#000">` +
      `<img src="http://127.0.0.1:${port}/assets/bg.png" style="position:absolute;left:0;top:0;width:1080px;height:1920px;filter:blur(${(14 * v).toFixed(2)}px)">` +
      `<img src="data:image/png;base64,${overlayPng.toString('base64')}" style="position:absolute;left:0;top:0;width:1080px;height:1920px"></body>`,
  );
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  return page.screenshot({ type: 'png' });
}

const SETTLE = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function main() {
  const jobs = loadJobs();
  const app = await bundleApp();
  const work = prepareWork(opt('--bg', ''));
  const tpl = readFileSync(join(ROOT, 'reference/skill-reel-edit/template/template.tpl'), 'utf-8');
  const fontCss = readFileSync(join(ROOT, 'resources/render/fonts.css'), 'utf-8');
  const { srv, port } = await serve(work);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const comp = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: SCALE });
  let failed = 0;
  try {
    for (const job of jobs) {
      const { html, overlay, duration } = composeHtml(app, tpl, fontCss, job);
      const ext = app.externalUrls(html);
      if (ext.length) { failed++; console.log(`[${job.name}] GAGAL URL luar di HTML: ${ext.join(', ')}`); }
      const file = `${job.name}.html`;
      writeFileSync(join(work, file), html);
      writeFileSync(join(OUT, `${job.name}.sfx.json`), JSON.stringify({ scenes: overlay.scenes, sfx: overlay.sfx }, null, 1));
      const times = job.times ?? [duration / 2];
      for (const t of times) {
        const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: SCALE });
        const page = await ctx.newPage();
        const problems = [];
        page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
        page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
        page.on('requestfailed', (r) => problems.push('requestfailed: ' + r.url()));
        await page.addInitScript(() => { window.__timelines = {}; });
        if (flag('--force2d')) await page.addInitScript(() => { window.addEventListener('DOMContentLoaded', () => window.gsap && window.gsap.config({ force3D: false })); });
        await page.goto(`http://127.0.0.1:${port}/${file}`);
        await page.evaluate(() => document.fonts.ready);
        const seek = (u) => page.evaluate((x) => { const tl = window.__timelines.main; tl.pause(); tl.seek(x, false); }, u);
        // Chrome menyimpan tile raster dan tidak selalu membatalkan teks tak berubah saat transform berubah-balik (noise AA 1px yang
        // bergantung riwayat paint, bukan status DOM). Supaya tes seek-safety mengukur STATUS timeline, paksa repaint penuh dulu,
        // lalu ambil ulang sampai dua screenshot berurutan sama.
        const shot = async () => {
          await page.evaluate(() => { const d = document.documentElement; d.style.display = 'none'; void d.offsetHeight; d.style.display = ''; void d.offsetHeight; });
          let prev = null;
          for (let i = 0; i < 8; i++) {
            await page.evaluate(SETTLE);
            const cur = await page.screenshot({ type: 'png', omitBackground: true });
            if (prev && prev.equals(cur)) return cur;
            prev = cur;
          }
          return prev;
        };

        await seek(t);
        const a = await shot();
        const dumpA = SEEK_CHECK ? await page.evaluate(DUMP) : null;
        const png = join(OUT, `${job.name}-${t.toFixed(2)}.png`);
        writeFileSync(png.replace(/\.png$/, '-overlay.png'), a);
        writeFileSync(png, await compose(comp, port, a, t, overlay.scenes));
        let verdict = '';
        if (SEEK_CHECK) {
          // 1) scrub acak ke mana-mana lalu kembali  2) putar maju bertahap dari 0 ke t, hasil harus sama dengan seek langsung
          for (const u of [duration * 0.25, duration * 0.8, duration, 0, t * 0.5, t + 0.37, 0.01]) await seek(u);
          await seek(t);
          const b = await shot();
          await page.evaluate((x) => { const tl = window.__timelines.main; tl.pause(); for (let u = 0; u < x; u += 0.05) tl.seek(u, false); tl.seek(x, false); }, t);
          const c = await shot();
          verdict = a.equals(b) && a.equals(c) ? 'seek OK' : `seek GAGAL (acak ${a.equals(b) ? 'ok' : 'beda'}, maju ${a.equals(c) ? 'ok' : 'beda'})`;
          if (!verdict.endsWith('OK')) {
            failed++;
            writeFileSync(png.replace(/\.png$/, '-acak.png'), b); // untuk diff (ffmpeg blend=difference)
            writeFileSync(png.replace(/\.png$/, '-maju.png'), c);
            const dumpC = await page.evaluate(DUMP);
            const diffs = Object.keys(dumpA).filter((k) => dumpA[k] !== dumpC[k]);
            verdict += ` [elemen beda: ${diffs.length ? diffs.slice(0, 4).map((k) => k + ' A=' + dumpA[k] + ' C=' + dumpC[k]).join(' ;; ') : 'gaya sama, beda di raster'}]`;
          }
        }
        if (problems.length) { failed++; verdict += ' | ' + problems.join(' ; '); }
        console.log(`[${job.name}] t=${t.toFixed(2)} ${verdict} -> ${png}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(failed ? `SELESAI dengan ${failed} masalah` : 'SELESAI: semua OK');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
