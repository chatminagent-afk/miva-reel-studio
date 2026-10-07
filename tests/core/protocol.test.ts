// Protokol reel:// (file proyek untuk <video> preview). Regresi bug 07/10 (laptop Steven, Windows):
// respons Range yang di-stream menahan file proxy tetap terbuka, sehingga proxy baru setelah ganti Grade gagal
// menggantikan _proxy.mp4 (rename ditolak Windows) dan preview diam-diam tetap memakai proxy lama.
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: () => undefined, handle: () => undefined } }));
const { fileResponse } = await import('../../src/main/protocol');

let dir: string;
const SIZE = 10 * 1024 * 1024;
const bytes = (seed: number) => Buffer.from(Array.from({ length: SIZE }, (_, i) => (i * seed) & 0xff));
const body = async (r: Response) => Buffer.from(await r.arrayBuffer());

describe('protokol reel:// (fileResponse)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'reel-proto-'));
    writeFileSync(join(dir, 'v.mp4'), bytes(7));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('Range terbuka (bytes=0-) dijawab per potongan terbatas; Content-Range menyebut ukuran penuh', async () => {
    const r = await fileResponse(join(dir, 'v.mp4'), 'bytes=0-');
    expect(r.status).toBe(206);
    const [, a, b, total] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')!)!.map(Number);
    expect([a, total]).toEqual([0, SIZE]);
    expect(b).toBeLessThan(SIZE - 1); // tidak seluruh file dalam satu respons
    const got = await body(r);
    expect(got.length).toBe(b - a + 1);
    expect(Number(r.headers.get('content-length'))).toBe(got.length);
    expect(got.equals(readFileSync(join(dir, 'v.mp4')).subarray(a, b + 1))).toBe(true);
  });

  it('Range eksplisit, suffix, dan di luar ukuran tetap tepat', async () => {
    const full = readFileSync(join(dir, 'v.mp4'));
    const mid = await fileResponse(join(dir, 'v.mp4'), 'bytes=100-199');
    expect(mid.headers.get('content-range')).toBe(`bytes 100-199/${SIZE}`);
    expect((await body(mid)).equals(full.subarray(100, 200))).toBe(true);
    const tail = await fileResponse(join(dir, 'v.mp4'), 'bytes=-500');
    expect(tail.headers.get('content-range')).toBe(`bytes ${SIZE - 500}-${SIZE - 1}/${SIZE}`);
    expect((await body(tail)).equals(full.subarray(SIZE - 500))).toBe(true);
    expect((await fileResponse(join(dir, 'v.mp4'), `bytes=${SIZE}-`)).status).toBe(416);
  });

  it('file bisa diganti (rename) saat respons Range baru dibaca sebagian, lalu respons berikutnya = file baru', async () => {
    const p = join(dir, 'v.mp4');
    const reader = (await fileResponse(p, 'bytes=0-')).body!.getReader();
    await reader.read(); // preview sudah mulai membaca lalu berhenti (buffer penuh)
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(join(dir, 'v.next.mp4'), bytes(13));
    expect(() => renameSync(join(dir, 'v.next.mp4'), p)).not.toThrow();
    await reader.cancel();
    const again = await body(await fileResponse(p, 'bytes=0-99'));
    expect(again.equals(bytes(13).subarray(0, 100))).toBe(true);
  });
});
