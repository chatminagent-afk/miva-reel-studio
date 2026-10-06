// Smoke test Electron: app terbuka, jendela tampil, IPC probe jalan, tanpa request jaringan keluar.
// Jalankan: xvfb-run -a node tests/e2e.smoke.mjs   (butuh `npm run build` dulu)
import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';

const sample = process.argv[2];
const app = await electron.launch({ args: ['--no-sandbox', resolve('out/main/index.js')], env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' } });
const win = await app.firstWindow();
const external = [];
win.on('request', (r) => { if (!/^(file|data|blob|devtools):/.test(r.url())) external.push(r.url()); });
await win.waitForSelector('[data-testid="import"]', { timeout: 20000 });
const title = await win.title();
let probe = null;
if (sample) probe = await win.evaluate((p) => window.reel.probe(p), sample);
console.log(JSON.stringify({ title, probe, externalRequests: external }));
await app.close();
