// UAT motion graphic (E3 sampai E9 di docs/2026-10-06-uat-plan.md) lewat UI app Electron dengan komponen ASLI:
// footage nyata + Whisper asli -> tab Motion (tempel brief, Generate) -> preview menampilkan motion -> edit (Details, timeline,
// hapus + undo) -> motion ditambat ke kata -> versi -> export dan periksa piksel frame hasilnya.
//
// Dijalankan terhadap build dev (out/main) atau app terpasang (REEL_E2E_EXE). Butuh:
//   REEL_UAT_MOTION_VIDEO  path video talking-head nyata (mis. reels\7 okt\3.MP4)
//   REEL_UAT_MOTION_BRIEF  path file brief (mis. tests/fixtures/briefs/miva-3.brief.txt)
//   REEL_UAT_MOTION_VARIANTS=1 (opsional)  tambah export 2K30 HEVC dan 1080p60 H.264
//   REEL_E2E_SHOTS=<folder> (opsional)     simpan screenshot UI ke folder itu
//   REEL_FFPROBE (opsional)                path ffprobe; bawaan: ffprobe di PATH
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Frame, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ffmpegPath } from '../../src/core/ffmpeg';
import { frameRgb, goldPixels, launchApp, lightShare, meanLuma, stubOpenDialog } from './helpers';

const VIDEO = process.env.REEL_UAT_MOTION_VIDEO;
const BRIEF = process.env.REEL_UAT_MOTION_BRIEF;
const VARIANTS = process.env.REEL_UAT_MOTION_VARIANTS === '1';
const SHOTS = process.env.REEL_E2E_SHOTS;
const ffprobeBin = () => process.env.REEL_FFPROBE ?? 'ffprobe';

interface Item {
  id: string;
  kind: string;
  text: string;
}

const probe = (file: string, entries: string) =>
  JSON.parse(execFileSync(ffprobeBin(), ['-v', 'error', '-show_entries', entries, '-of', 'json', file], { encoding: 'utf-8' })) as {
    streams: { codec_type?: string; codec_name: string; width: number; height: number; r_frame_rate: string }[];
    format: { duration: string };
  };

describe.skipIf(!VIDEO || !BRIEF || !existsSync(VIDEO) || !existsSync(BRIEF))('UAT motion graphic (video nyata, Whisper asli)', () => {
  let work: string;
  let app: ElectronApplication;
  let win: Page;
  const external: string[] = [];
  let brief = '';
  // dibagi antar langkah
  let ids: Item[] = [];
  let ex: { file: string; total: number; stmt: { t0: number; t1: number }; scene: { t0: number; t1: number }; tail: number; body: number; cover: string } | null = null;

  const projDir = () => join(work, 'projects', readdirSync(join(work, 'projects'))[0]);
  const readEdit = () => JSON.parse(readFileSync(join(projDir(), 'edit.json'), 'utf-8')) as { segs: [number, number][]; speed?: number; tail?: number };
  const keptSecs = (e: { segs: [number, number][] }) => e.segs.reduce((s, [a, b]) => s + (b - a), 0);
  const bodyOf = (e: { segs: [number, number][]; speed?: number }) => keptSecs(e) / Number(e.speed ?? 1.25);

  const shot = async (name: string, target?: string) => {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await new Promise((r) => setTimeout(r, 400));
    if (target) await win.locator(target).screenshot({ path: join(SHOTS, `${name}.png`) });
    else await win.screenshot({ path: join(SHOTS, `${name}.png`) });
  };

  const scrollTop = () =>
    win.evaluate(() => {
      document.querySelector('[data-testid="motion-panel"]')?.scrollTo(0, 0);
      document.querySelector('[aria-label="Details"] > div:last-child')?.scrollTo(0, 0);
    });
  const items = (): Promise<Item[]> =>
    win.$$eval('[data-testid="motion-item"]', (els) => els.map((e) => ({ id: (e as HTMLElement).dataset.id!, kind: (e as HTMLElement).dataset.kind!, text: e.textContent ?? '' })));
  const count = async () => Number(await win.textContent('[data-testid="motion-count"]'));
  const openTab = async (name: 'Motion' | 'Captions') => {
    await win.click(`.ltab:has-text("${name}")`);
    if (name === 'Motion') await win.waitForSelector('[data-testid="motion-panel"]');
  };
  /** pilih lewat blok timeline (tidak bergantung tab kiri) */
  const pickBlock = async (id: string) => {
    const blk = win.locator(`[data-testid="motion-block"][data-id="${id}"]`);
    await blk.scrollIntoViewIfNeeded();
    await blk.click();
    await win.waitForSelector(`[data-testid="motion-details"]`);
  };
  const times = async () => ({ t0: Number(await win.inputValue('[data-testid="motion-start"]')), t1: Number(await win.inputValue('[data-testid="motion-end"]')) });
  /** playhead ke tengah blok: klik ruler di atas tengah blok */
  const seekBlockMid = async (id: string) => {
    const blk = win.locator(`[data-testid="motion-block"][data-id="${id}"]`);
    await blk.scrollIntoViewIfNeeded();
    const b = (await blk.boundingBox())!;
    const r = (await win.locator('[data-testid="ruler"]').boundingBox())!;
    await win.mouse.click(b.x + b.width / 2, r.y + 12);
  };
  const overlayFrame = (): Frame | undefined => win.frames().find((f) => f.url().startsWith('reel://preview/overlay.html'));
  /** elemen `.mv-` terdalam yang teksnya cocok dan terlihat (opasitas efektif > 0,9, punya ukuran) di iframe preview */
  const mvVisible = async (pattern: string): Promise<boolean> => {
    try {
      return (
        (await overlayFrame()?.evaluate((pat) => {
          const re = new RegExp(pat);
          const eff = (el: Element) => {
            let o = 1;
            for (let e: Element | null = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
            return o;
          };
          const cand = [...document.querySelectorAll('[class*="mv-"]')].filter((el) => re.test(el.textContent ?? ''));
          const inner = cand.filter((el) => ![...el.children].some((c) => cand.includes(c)));
          return inner.some((el) => {
            const r = el.getBoundingClientRect();
            return eff(el) > 0.9 && r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
          });
        }, pattern)) ?? false
      );
    } catch {
      return false; // iframe baru saja diganti
    }
  };
  const phoneVisible = async (): Promise<boolean> => {
    try {
      return (
        (await overlayFrame()?.evaluate(() => {
          const el = document.querySelector('.mv-ph');
          if (!el) return false;
          let o = 1;
          for (let e: Element | null = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
          const r = el.getBoundingClientRect();
          return o > 0.9 && r.width > 100 && r.height > 100;
        })) ?? false
      );
    } catch {
      return false;
    }
  };

  const runExport = async (opts: { name: string; resolution?: string; fps?: string; codec?: string; cover: boolean; coverTitle?: string }) => {
    await win.click('[data-testid="open-export"]');
    await win.waitForSelector('[role="dialog"][aria-label="Export"]');
    await win.fill('[aria-label="File name"]', opts.name);
    if (opts.resolution) await win.click(`[aria-label="Resolution"] button:has-text("${opts.resolution}")`);
    if (opts.fps) await win.click(`[aria-label="Frame rate"] button:has-text("${opts.fps}")`);
    if (opts.codec) await win.click(`[aria-label="Codec"] button:has-text("${opts.codec}")`);
    const coverOn = (await win.getAttribute('[aria-label="Cover JPG"]', 'aria-pressed')) === 'true';
    if (coverOn !== opts.cover) await win.click('[aria-label="Cover JPG"]');
    if (opts.cover && opts.coverTitle !== undefined) await win.fill('[aria-label="Cover title"]', opts.coverTitle);
    const summary = (await win.textContent('[role="dialog"][aria-label="Export"] .mono.muted'))!;
    await win.click('[data-testid="export-start"]');
    await win.waitForSelector('[data-testid="export-done"], [data-testid="export-error"]', { timeout: 1_500_000 });
    const err = await win.$('[data-testid="export-error"]');
    if (err) throw new Error(`export gagal: ${await err.textContent()}`);
    const done = (await win.textContent('[data-testid="export-done"]'))!;
    await win.click('[data-testid="export-done"] button:has-text("Close")');
    return { summary, done, file: join(work, 'exports', `${opts.name}.mp4`) };
  };

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'reel-motion-'));
    brief = readFileSync(BRIEF!, 'utf-8');
    ({ app, win } = await launchApp(work));
    win.on('request', (r) => {
      if (!/^(file|data|blob|devtools|reel):/.test(r.url())) external.push(r.url());
    });
    await win.waitForSelector('[data-testid="choose"]', { timeout: 60_000 });
    await win.evaluate(
      (w) =>
        window.reel.setSettings({
          projectsRoot: `${w}/projects`,
          exportDir: `${w}/exports`,
          exportDefaults: { resolution: '1080p', fps: 30, codec: 'h264', quality: 'recommended', cover: true, waCopy: false, openFolder: false },
        }),
      work,
    );
  });
  afterAll(async () => {
    await app?.close().catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
  });

  it('a. import + Auto Edit (Whisper asli), tab Motion, tempel brief, Generate', async () => {
    await stubOpenDialog(app, VIDEO!);
    await win.click('[data-testid="choose"]');
    await win.waitForSelector('[data-testid="editor"]', { timeout: 900_000 });
    expect((await win.$$eval('[data-testid="transcript"] .w', (e) => e.length))).toBeGreaterThan(20);
    await openTab('Motion');
    expect(await count()).toBe(0);
    // Generate dimatikan selama brief kosong
    expect(await win.isDisabled('[data-testid="motion-generate"]')).toBe(true);
    // brief tanpa blok: pesan ramah, tidak ada motion dibuat
    await win.fill('[data-testid="motion-brief"]', 'halo ini cuma naskah biasa tanpa blok motion');
    await win.click('[data-testid="motion-generate"]');
    await win.waitForSelector('[data-testid="motion-notice"]');
    expect(await win.textContent('[data-testid="motion-notice"]')).toMatch(/No motion blocks recognised/);
    expect(await count()).toBe(0);
    await win.fill('[data-testid="motion-brief"]', brief);
    expect(await win.$('[data-testid="motion-notice"]')).toBeNull();
    expect(await win.isDisabled('[data-testid="motion-generate"]')).toBe(false);
    await win.click('[data-testid="motion-generate"]');
    await win.waitForSelector('[data-testid="motion-report"]');
    await scrollTop();
    await shot('01-motion-tab-after-generate');
  }, 900_000);

  it('b. urutan jenis miva-3, tail terisi, laporan 9 blok', async () => {
    ids = await items();
    const kinds = ids.map((i) => i.kind);
    console.log('jenis berurutan:', kinds.join(' '), '| laporan:', await win.textContent('[data-testid="motion-report"]'));
    expect(kinds.slice(0, 2).sort()).toEqual(['counter', 'toasts']);
    expect(kinds.slice(2)).toEqual(['split', 'bubbles', 'phone', 'statement', 'chain', 'logo', 'chat', 'chain', 'endcard']);
    expect(await win.textContent('[data-testid="report-blocks"]')).toBe('9');
    expect(Number(await win.textContent('[data-testid="report-created"]'))).toBe(ids.length);
    await expect.poll(async () => Number(await win.inputValue('[data-testid="motion-tail"]')), { timeout: 10_000 }).toBeGreaterThan(0);
    await win.waitForSelector('[data-testid="tail-region"]');
    // tersimpan ke edit.json (format skill) tanpa menunggu lama
    await expect.poll(() => readEdit().tail ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    // waktu total di timecode = badan + tail
    const e = readEdit();
    const total = await win.textContent('[data-testid="timecode"]').then((t) => {
      const [m, s] = t!.split('/')[1].trim().split(':').map(Number);
      return m * 60 + s;
    });
    expect(Math.abs(total - (bodyOf(e) + (e.tail ?? 0)))).toBeLessThan(0.02);
    // blok timeline: satu per item; ada yang bertanda review (amber) bila laporan menyebutnya
    expect(await win.$$eval('[data-testid="motion-block"]', (e) => e.length)).toBe(ids.length);
    const review = Number(await win.textContent('[data-testid="report-review"]'));
    expect(await win.$$eval('[data-testid="motion-block"].review', (e) => e.length)).toBe(review);
    expect(await win.$$eval('[data-testid="motion-item"] .mbadge.review', (e) => e.length)).toBe(review);
    await shot('02-timeline-motion-track', '[aria-label="Timeline"]');
  });

  it('c. preview menampilkan motion di waktunya (statement, phone)', async () => {
    const stmt = ids.find((i) => i.kind === 'statement')!;
    const phone = ids.find((i) => i.kind === 'phone')!;
    await seekBlockMid(stmt.id);
    await expect.poll(() => mvVisible('customer-nya\\.'), { timeout: 20_000, message: 'teks "customer-nya." terlihat di iframe preview' }).toBe(true);
    await seekBlockMid(phone.id);
    await expect.poll(phoneVisible, { timeout: 20_000, message: 'HP lock-screen terlihat' }).toBe(true);
    // di luar motion (mis. awal tail?) teks statement tidak terlihat
    await seekBlockMid(stmt.id);
    await expect.poll(phoneVisible, { timeout: 10_000 }).toBe(false);
  });

  it('d. edit: teks lewat Details, waktu mulai, geser blok chain di timeline, hapus + undo', async () => {
    const stmt = ids.find((i) => i.kind === 'statement')!;
    await openTab('Motion');
    await win.click(`[data-testid="motion-item"][data-id="${stmt.id}"]`);
    await win.waitForSelector('[data-testid="motion-details"][data-kind="statement"]');
    expect(await win.inputValue('[data-testid="motion-field-line2"]')).toBe('customer-nya.');
    // teks: draf lokal, diterapkan saat blur
    await win.fill('[data-testid="motion-field-line2"]', 'pelanggan-nya.');
    await win.press('[data-testid="motion-field-line2"]', 'Tab');
    await seekBlockMid(stmt.id);
    await expect.poll(() => mvVisible('pelanggan-nya\\.'), { timeout: 20_000 }).toBe(true);
    expect(await mvVisible('customer-nya\\.')).toBe(false);
    // waktu mulai: +0,3 dtk, akhir tetap
    await win.click(`[data-testid="motion-item"][data-id="${stmt.id}"]`);
    const t = await times();
    await win.fill('[data-testid="motion-start"]', (t.t0 + 0.3).toFixed(2));
    await win.press('[data-testid="motion-start"]', 'Tab');
    await expect.poll(async () => (await times()).t0, { timeout: 10_000 }).toBeCloseTo(t.t0 + 0.3, 1);
    expect(Math.abs((await times()).t1 - t.t1)).toBeLessThan(0.03);
    // input tidak valid: error inline dan tidak diterapkan
    await win.fill('[data-testid="motion-start"]', '-5');
    await win.press('[data-testid="motion-start"]', 'Tab');
    await win.waitForSelector('[data-testid="motion-start-error"]');
    // tidak diterapkan: pilih item lain lalu kembali, nilai di dokumen masih yang lama
    await win.click(`[data-testid="motion-item"][data-id="${ids[0].id}"]`);
    await win.click(`[data-testid="motion-item"][data-id="${stmt.id}"]`);
    expect(Math.abs((await times()).t0 - (t.t0 + 0.3))).toBeLessThan(0.03);
    await win.fill('[data-testid="motion-start"]', (t.t0 + 0.3).toFixed(2));
    await win.press('[data-testid="motion-start"]', 'Tab');
    await win.waitForSelector('[data-testid="motion-start-error"]', { state: 'detached' });

    // geser blok chain +0,5 dtk hasil edit (= 0,5 x speed dtk sumbu x 96 px/dtk pada zoom bawaan 1,2)
    const chain = ids.find((i) => i.kind === 'chain')!;
    await pickBlock(chain.id);
    const before = await times();
    const speed = Number(readEdit().speed ?? 1.25);
    const blk = win.locator(`[data-testid="motion-block"][data-id="${chain.id}"]`);
    const b = (await blk.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const dx = 0.5 * speed * 80 * 1.2;
    await win.mouse.move(cx, cy);
    await win.mouse.down();
    for (let k = 1; k <= 8; k++) await win.mouse.move(cx + (dx * k) / 8, cy);
    await win.mouse.up();
    await expect.poll(async () => (await times()).t0 - before.t0, { timeout: 10_000 }).toBeGreaterThan(0.3);
    const after = await times();
    console.log(`geser chain: mulai ${before.t0} -> ${after.t0} (selisih ${(after.t0 - before.t0).toFixed(3)}), akhir ${before.t1} -> ${after.t1}`);
    expect(after.t0 - before.t0).toBeGreaterThan(0.35);
    expect(after.t0 - before.t0).toBeLessThan(0.65);
    expect(Math.abs(after.t1 - after.t0 - (before.t1 - before.t0))).toBeLessThan(0.03); // geser menjaga durasi
    // ubah ukuran: tepi kanan -0,6 dtk hasil edit, tepi kiri tetap
    const hb = (await blk.locator('[data-testid="motion-handle-r"]').boundingBox())!;
    const hx = hb.x + hb.width / 2;
    const hy = hb.y + hb.height / 2;
    await win.mouse.move(hx, hy);
    await win.mouse.down();
    const rdx = -0.6 * speed * 96;
    for (let k = 1; k <= 6; k++) await win.mouse.move(hx + (rdx * k) / 6, hy);
    await win.mouse.up();
    await expect.poll(async () => (await times()).t1, { timeout: 10_000 }).toBeLessThan(after.t1 - 0.4);
    const resized = await times();
    expect(Math.abs(resized.t0 - after.t0)).toBeLessThan(0.03);
    expect(after.t1 - resized.t1).toBeGreaterThan(0.4);
    expect(after.t1 - resized.t1).toBeLessThan(0.8);
    // undo satu per aksi: resize -> geser kembali ke kondisi sebelumnya
    await win.keyboard.press('Control+z');
    await expect.poll(async () => (await times()).t1, { timeout: 10_000 }).toBeCloseTo(after.t1, 1);
    await win.keyboard.press('Control+z');
    await expect.poll(async () => (await times()).t0, { timeout: 10_000 }).toBeCloseTo(before.t0, 1);
    await win.keyboard.press('Control+Shift+z');
    await win.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await times()).t1, { timeout: 10_000 }).toBeCloseTo(resized.t1, 1);

    // hapus lewat Delete lalu Ctrl+Z
    const n = await count();
    const logo = ids.find((i) => i.kind === 'logo')!;
    await win.click(`[data-testid="motion-item"][data-id="${logo.id}"]`);
    await win.keyboard.press('Delete');
    await expect.poll(count, { timeout: 10_000 }).toBe(n - 1);
    expect((await items()).some((i) => i.id === logo.id)).toBe(false);
    expect(await win.$$eval('[data-testid="motion-block"]', (e) => e.length)).toBe(n - 1);
    await win.keyboard.press('Control+z');
    await expect.poll(count, { timeout: 10_000 }).toBe(n);
    expect((await items()).some((i) => i.id === logo.id)).toBe(true);
  });

  it('d2. kontrol Details: toggle Scene/Silent, label, mark reviewed, editor ramah chat, JSON tidak valid ditolak', async () => {
    const chat = ids.find((i) => i.kind === 'chat')!;
    await openTab('Motion');
    await win.click(`[data-testid="motion-item"][data-id="${chat.id}"]`);
    await win.waitForSelector('[data-testid="motion-details"][data-kind="chat"]');
    await scrollTop();
    await shot('03-details-chat');
    // editor ramah: langkah chat sebagai baris teks
    const steps = await win.inputValue('[data-testid="motion-field-steps"]');
    console.log('langkah chat (teks):', JSON.stringify(steps));
    expect(steps).toMatch(/^cus: /m);
    expect(steps).toMatch(/^bot: /m);
    await win.fill('[data-testid="motion-field-steps"]', steps + '\nclear\nngawur tanpa awalan');
    await win.press('[data-testid="motion-field-steps"]', 'Tab');
    await win.waitForSelector('[data-testid="motion-field-steps-error"]');
    expect(await win.textContent('[data-testid="motion-field-steps-error"]')).toMatch(/^Line \d+:/);
    // nilai tidak valid tidak diterapkan: buka ulang item, teks lama masih sama
    await win.click(`[data-testid="motion-item"][data-id="${ids[0].id}"]`);
    await win.click(`[data-testid="motion-item"][data-id="${chat.id}"]`);
    expect(await win.inputValue('[data-testid="motion-field-steps"]')).toBe(steps);
    await win.fill('[data-testid="motion-field-steps"]', steps + '\ncus: Terima kasih');
    await win.press('[data-testid="motion-field-steps"]', 'Tab');
    await win.click(`[data-testid="motion-item"][data-id="${ids[0].id}"]`);
    await win.click(`[data-testid="motion-item"][data-id="${chat.id}"]`);
    expect(await win.inputValue('[data-testid="motion-field-steps"]')).toBe(steps + '\ncus: Terima kasih');
    await win.keyboard.press('Control+z'); // satu langkah undo per edit
    await win.click(`[data-testid="motion-item"][data-id="${ids[0].id}"]`);
    await win.click(`[data-testid="motion-item"][data-id="${chat.id}"]`);
    expect(await win.inputValue('[data-testid="motion-field-steps"]')).toBe(steps);
    // Scene + Silent
    const scene0 = (await win.getAttribute('[data-testid="motion-scene"]', 'aria-pressed')) === 'true';
    await win.click('[data-testid="motion-scene"]');
    expect((await win.getAttribute('[data-testid="motion-scene"]', 'aria-pressed')) === 'true').toBe(!scene0);
    await win.click('[data-testid="motion-silent"]');
    await win.waitForSelector(`[data-testid="motion-item"][data-id="${chat.id}"] .mbadge:has-text("Silent")`);
    await win.click('[data-testid="motion-silent"]');
    await win.waitForSelector(`[data-testid="motion-item"][data-id="${chat.id}"] .mbadge:has-text("Silent")`, { state: 'detached' });
    await win.click('[data-testid="motion-scene"]');
    // label
    await win.fill('[data-testid="motion-label"]', 'Kasus chat');
    await win.press('[data-testid="motion-label"]', 'Tab');
    await win.waitForSelector(`[data-testid="motion-item"][data-id="${chat.id}"]:has-text("Kasus chat")`);
    // review: item bertanda review bisa ditandai sudah dicek (kalau ada)
    const rv = await win.$$eval('[data-testid="motion-item"]', (els) => els.filter((e) => e.querySelector('.mbadge.review')).map((e) => (e as HTMLElement).dataset.id!));
    if (rv.length) {
      const n0 = Number(await win.textContent('[data-testid="report-review"]'));
      await win.click(`[data-testid="motion-item"][data-id="${rv[0]}"]`);
      await win.click('[data-testid="motion-reviewed"]');
      await expect.poll(async () => Number(await win.textContent('[data-testid="report-review"]'))).toBe(n0 - 1);
    }
    // Generate ulang: konfirmasi mengganti motion hasil brief; Cancel tidak mengubah apa pun
    const n = await count();
    await win.click('[data-testid="motion-generate"]');
    await win.waitForSelector('[data-testid="motion-confirm"]');
    expect(await win.textContent('[data-testid="motion-confirm"]')).toMatch(/replaces \d+ motions? generated from the brief, including any edits/);
    await win.click('[data-testid="motion-confirm-cancel"]');
    expect(await count()).toBe(n);
  });

  it('e. potong kata di depan chat: item chat bergeser mengikuti kata (ditambat)', async () => {
    const chat = ids.find((i) => i.kind === 'chat')!;
    await pickBlock(chat.id);
    const t0 = (await times()).t0;
    expect(t0).toBeGreaterThan(8);
    // kata terpakai pertama sesudah detik ke-3 footage, jauh sebelum chat
    await openTab('Captions');
    const w = await win.$$eval('[data-testid="transcript"] .w', (els) =>
      els.map((e) => ({ id: e.getAttribute('data-testid')!, cut: e.classList.contains('cut'), t: parseFloat((e as HTMLElement).title) })),
    );
    const pick = w.find((x) => !x.cut && x.t > 3)!;
    const segs0 = readEdit();
    await win.click(`[data-testid="${pick.id}"]`);
    await win.keyboard.press('Delete');
    await expect.poll(() => keptSecs(readEdit()), { timeout: 15_000 }).toBeLessThan(keptSecs(segs0) - 0.05);
    const removed = bodyOf(segs0) - bodyOf(readEdit());
    await pickBlock(chat.id);
    await expect.poll(async () => (await times()).t0, { timeout: 10_000 }).toBeLessThan(t0 - 0.05);
    const t1 = (await times()).t0;
    console.log(`potong ${pick.id} (${removed.toFixed(3)} dtk): chat ${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
    expect(Math.abs(t0 - t1 - removed)).toBeLessThan(0.06);
    await win.keyboard.press('Control+z'); // kembalikan supaya langkah berikutnya memakai kondisi semula
    await expect.poll(async () => (await times()).t0, { timeout: 10_000 }).toBeCloseTo(t0, 1);
    await expect.poll(() => keptSecs(readEdit()), { timeout: 15_000 }).toBeCloseTo(keptSecs(segs0), 1);
  });

  it('f. versi: simpan v2 sesudah Generate, v1 tanpa motion, v2 dengan motion dan editannya', async () => {
    await openTab('Motion');
    const n = await count();
    await win.waitForSelector('[data-testid="save-version"]:not([disabled])');
    await win.click('[data-testid="save-version"]');
    await win.waitForFunction(() => (document.querySelector('[data-testid="version"]') as HTMLSelectElement).value === '2');
    const opts = await win.$$eval('[data-testid="version"] option', (els) => els.map((e) => e.textContent));
    expect(opts[0]).toMatch(/^v2/);
    expect(opts.at(-1)).toMatch(/^v1 · Auto Edit/);
    await win.selectOption('[data-testid="version"]', '1');
    await win.waitForFunction(() => (document.querySelector('[data-testid="version"]') as HTMLSelectElement | null)?.value === '1', undefined, { timeout: 30_000 });
    await openTab('Motion');
    await expect.poll(count, { timeout: 30_000 }).toBe(0);
    expect(await win.$$eval('[data-testid="motion-block"]', (e) => e.length)).toBe(0);
    expect(await win.$('[data-testid="tail-region"]')).toBeNull();
    await win.selectOption('[data-testid="version"]', '2');
    await win.waitForFunction(() => (document.querySelector('[data-testid="version"]') as HTMLSelectElement | null)?.value === '2', undefined, { timeout: 30_000 });
    await openTab('Motion');
    await expect.poll(count, { timeout: 30_000 }).toBe(n);
    const stmt = (await items()).find((i) => i.kind === 'statement')!;
    await win.click(`[data-testid="motion-item"][data-id="${stmt.id}"]`);
    expect(await win.inputValue('[data-testid="motion-field-line2"]')).toBe('pelanggan-nya.');
    expect(await win.inputValue('[data-testid="motion-brief"]')).toContain('[MOTION 05');
  });

  it('g. export 1080p30 H.264 + cover: durasi = badan + tail, emas di statement, adegan lebih gelap, tail terang', async () => {
    await openTab('Motion');
    ids = await items();
    const stmt = ids.find((i) => i.kind === 'statement')!;
    const phone = ids.find((i) => i.kind === 'phone')!;
    const plain = ids.find((i) => i.kind === 'bubbles')!;
    await pickBlock(stmt.id);
    const stmtT = await times();
    await pickBlock(phone.id);
    expect((await win.getAttribute('[data-testid="motion-scene"]', 'aria-pressed')) === 'true').toBe(true);
    const sceneT = await times();
    await pickBlock(plain.id);
    expect((await win.getAttribute('[data-testid="motion-scene"]', 'aria-pressed')) === 'true').toBe(false); // acuan non-adegan
    const plainT = await times();
    await win.waitForTimeout(1500); // autosave
    const e = readEdit();
    const body = bodyOf(e);
    const tail = e.tail ?? 0;
    const total = body + tail;
    const title = 'harus pegang|*HP*'; // judul cover dari bug asli (ENAMETOOLONG)
    const r = await runExport({ name: 'motion-1080p30', cover: true, coverTitle: title });
    // dialog menampilkan durasi termasuk tail
    const shown = Number(/([\d.]+) s$/.exec(r.summary.trim())![1]);
    expect(Math.abs(shown - total)).toBeLessThan(0.06);
    expect(r.done).toContain('1080×1920');
    expect(r.done).toContain('cover');
    expect(existsSync(r.file)).toBe(true);
    const p = probe(r.file, 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate');
    const v = p.streams.find((s) => s.codec_type === 'video')!;
    expect([v.codec_name, v.width, v.height, v.r_frame_rate]).toEqual(['h264', 1080, 1920, '30/1']);
    expect(p.streams.some((s) => s.codec_type === 'audio')).toBe(true);
    const dur = Number(p.format.duration);
    console.log(`export: durasi ${dur.toFixed(3)} s, badan ${body.toFixed(3)} + tail ${tail} = ${total.toFixed(3)}`);
    expect(Math.abs(dur - total)).toBeLessThanOrEqual(2 / 30 + 0.001);

    // cover JPG di samping MP4, ukuran 1080x1920, judul tampil (kata besar emas)
    const cover = r.file.replace(/\.mp4$/, '-cover.jpg');
    expect(existsSync(cover)).toBe(true);
    const cp = probe(cover, 'stream=width,height,codec_name');
    expect([cp.streams[0].width, cp.streams[0].height, cp.streams[0].codec_name]).toEqual([1080, 1920, 'mjpeg']);
    const coverRgb = execFileSync(ffmpegPath(), ['-v', 'error', '-i', cover, '-vf', 'scale=1080:1920', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
    const coverGold = goldPixels(coverRgb, 250, 800);
    console.log('piksel emas di cover (y 250-800):', coverGold);
    expect(coverGold).toBeGreaterThan(1500);

    // frame di tengah statement: teks serif emas di area atas (y 300-700)
    const mid = (stmtT.t0 + stmtT.t1) / 2;
    const fMid = frameRgb(r.file, mid);
    const gMid = goldPixels(fMid, 300, 700);
    const gPre = goldPixels(frameRgb(r.file, Math.max(0, stmtT.t0 - 0.25)), 300, 700);
    console.log(`emas y300-700: tengah statement ${gMid}, sebelum ${gPre}`);
    expect(gMid).toBeGreaterThan(1500);
    expect(gMid).toBeGreaterThan(gPre * 3);

    // adegan (HP) jauh lebih gelap dari frame non-adegan (statement) di area bawah wajah (scrim + blur)
    const lScene = meanLuma(frameRgb(r.file, (sceneT.t0 + sceneT.t1) / 2), 1300, 1900);
    const lPlain = meanLuma(frameRgb(r.file, (plainT.t0 + plainT.t1) / 2), 1300, 1900);
    console.log(`luma y1300-1900: adegan ${lScene.toFixed(1)}, non-adegan ${lPlain.toFixed(1)}`);
    expect(lScene).toBeLessThan(lPlain * 0.75);

    // ekor: end card terang (#eceff2) memenuhi layar
    const tailT = body + Math.min(1.2, tail * 0.55);
    const share = lightShare(frameRgb(r.file, tailT));
    console.log(`porsi piksel terang di ekor (t=${tailT.toFixed(2)}): ${(share * 100).toFixed(1)}%`);
    expect(share).toBeGreaterThan(0.6);
    expect(lightShare(frameRgb(r.file, Math.max(0, stmtT.t0 + 0.9)))).toBeLessThan(0.4);

    ex = { file: r.file, total, stmt: stmtT, scene: sceneT, tail, body, cover };
    await win.evaluate(() => {
      const t = document.querySelector('[data-testid="timeline"]')!;
      t.scrollLeft = t.scrollWidth;
    });
    await shot('04-timeline-tail', '[aria-label="Timeline"]');
  });

  it.skipIf(!VARIANTS)(
    'h. varian: 2K30 HEVC dan 1080p60 H.264 dengan motion',
    async () => {
      expect(ex).not.toBeNull();
      const { stmt, total } = ex!;
      const mid = (stmt.t0 + stmt.t1) / 2;
      const r2k = await runExport({ name: 'motion-2k30', resolution: '2K', fps: '30 fps', codec: 'HEVC', cover: false });
      const p2k = probe(r2k.file, 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate');
      const v2k = p2k.streams.find((s) => s.codec_type === 'video')!;
      expect([v2k.codec_name, v2k.width, v2k.height, v2k.r_frame_rate]).toEqual(['hevc', 1440, 2560, '30/1']);
      expect(Math.abs(Number(p2k.format.duration) - total)).toBeLessThanOrEqual(2 / 30 + 0.001);
      const g2k = goldPixels(frameRgb(r2k.file, mid), 300, 700);
      console.log('2K30 HEVC: emas', g2k);
      expect(g2k).toBeGreaterThan(1500);

      const r60 = await runExport({ name: 'motion-1080p60', resolution: '1080p', fps: '60 fps', codec: 'H.264', cover: false });
      const p60 = probe(r60.file, 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate');
      const v60 = p60.streams.find((s) => s.codec_type === 'video')!;
      expect([v60.codec_name, v60.width, v60.height, v60.r_frame_rate]).toEqual(['h264', 1080, 1920, '60/1']);
      expect(Math.abs(Number(p60.format.duration) - total)).toBeLessThanOrEqual(2 / 60 + 0.001);
      const g60 = goldPixels(frameRgb(r60.file, mid), 300, 700);
      console.log('1080p60: emas', g60);
      expect(g60).toBeGreaterThan(1500);
    },
    1_800_000,
  );

  it('i. + Add motion, brief dengan blok tak dikenal (review), Generate ulang mempertahankan motion manual, tombol keyboard di kotak brief tidak memicu timeline', async () => {
    await openTab('Motion');
    const n0 = await count();
    await win.selectOption('[data-testid="motion-add"]', 'cta');
    await expect.poll(count, { timeout: 10_000 }).toBe(n0 + 1);
    const added = (await items()).find((i) => i.id.startsWith('mt-man-cta'))!;
    expect(added.text).toContain('Manual');
    await win.waitForSelector('[data-testid="motion-details"][data-kind="cta"]'); // langsung terpilih
    expect(await win.$$eval('[data-testid="motion-block"]', (e) => e.length)).toBe(n0 + 1);

    // blok tanpa keterangan visual: tidak ada yang bisa dibangun, pesan ramah, motion yang ada tidak disentuh
    await win.fill('[data-testid="motion-brief"]', ['[MOTION 01 - ANEH | 2 seconds]', 'Xyzzy plugh quux frobnicate.'].join('\n'));
    await win.click('[data-testid="motion-generate"]');
    await win.waitForSelector('[data-testid="motion-notice"]');
    expect(await win.textContent('[data-testid="motion-notice"]')).toMatch(/nothing could be built/);
    expect(await win.$('[data-testid="motion-confirm"]')).toBeNull();
    expect(await count()).toBe(n0 + 1);
    // blok yang tidak dikenali: konfirmasi mengganti hasil brief, item manual tetap, ada tanda review
    await win.fill('[data-testid="motion-brief"]', ['[MOTION 01 - ANEH | 2 seconds]', 'Tampilkan sesuatu yang aneh dan misterius di layar.'].join('\n'));
    await win.click('[data-testid="motion-generate"]');
    await win.waitForSelector('[data-testid="motion-confirm"]');
    expect(await win.textContent('[data-testid="motion-confirm"]')).toMatch(new RegExp(`replaces ${n0} motions`));
    await win.click('[data-testid="motion-confirm-yes"]');
    await expect.poll(count, { timeout: 10_000 }).toBe(2);
    const now = await items();
    expect(now.some((i) => i.id === added.id)).toBe(true);
    expect(now.some((i) => i.kind === 'counter')).toBe(false);
    expect(Number(await win.textContent('[data-testid="report-review"]'))).toBeGreaterThanOrEqual(1);
    const rv = now.find((i) => i.text.includes('Review'))!;
    await win.waitForSelector('[data-testid="motion-block"].review');
    await win.click(`[data-testid="motion-item"][data-id="${rv.id}"]`);
    await win.waitForSelector('[data-testid="motion-review-banner"]');
    await win.click('[data-testid="motion-reviewed"]');
    await expect.poll(async () => Number(await win.textContent('[data-testid="report-review"]'))).toBe(0);
    expect(await win.$('[data-testid="motion-block"].review')).toBeNull();
    expect(await win.$('[data-testid="motion-review-banner"]')).toBeNull();

    // tombol keyboard saat fokus di kotak brief: tidak memutar, tidak memotong, tidak menghapus motion
    await win.click(`[data-testid="motion-item"][data-id="${added.id}"]`);
    const clips = await win.$$eval('[data-testid="clip-piece"]', (e) => e.length);
    await win.click('[data-testid="motion-brief"]');
    await win.keyboard.type('a b');
    await win.keyboard.press('Control+b');
    await win.keyboard.press('Backspace');
    await win.keyboard.press('Delete');
    expect(await count()).toBe(2);
    expect(await win.getAttribute('[data-testid="play"]', 'aria-label')).toBe('Play');
    expect(await win.$$eval('[data-testid="clip-piece"]', (e) => e.length)).toBe(clips);
    expect(await win.$('[data-testid="motion-details"]')).not.toBeNull();
  });

  it('tanpa request internet dari jendela app', () => {
    expect(external).toEqual([]);
  });
});
