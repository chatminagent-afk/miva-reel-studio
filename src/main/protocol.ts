// Protokol reel:// untuk UI (renderer tidak punya akses file langsung):
//   reel://project/<path>   file di folder proyek yang sedang dibuka (proxy video, gambar overlay, ...)
//   reel://vendor/<path>    aset render offline (font, GSAP) dari resources/render
//   reel://sfx/<id>.wav     pustaka SFX aktif (untuk audisi + preview)
//   reel://preview/overlay.html  komposisi overlay preview terbaru (HTML dikirim UI lewat IPC preview:set)
// Mendukung Range (wajib untuk seek <video>). Path di luar folder yang diizinkan ditolak (403).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';

export const SCHEME = 'reel';

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.json': 'application/json',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
};

const state: { projectDir: string | null; vendorDir: string | null; sfxDir: string | null; previewHtml: string } = {
  projectDir: null,
  vendorDir: null,
  sfxDir: null,
  previewHtml: '<!doctype html><html><body></body></html>',
};

export function setProjectDir(dir: string | null): void {
  state.projectDir = dir;
}
export function setVendorDir(dir: string): void {
  state.vendorDir = dir;
}
export function setSfxDir(dir: string): void {
  state.sfxDir = dir;
}
export function setPreviewHtml(html: string): void {
  state.previewHtml = html;
}

/** Harus dipanggil sebelum app ready. */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

/** Path aman di dalam root, atau null kalau keluar root (../) */
export function resolveInside(root: string, rel: string): string | null {
  const p = normalize(join(root, decodeURIComponent(rel)));
  const r = relative(root, p);
  if (r.startsWith('..') || r.split(sep).includes('..') || /^[a-zA-Z]:/.test(r)) return null;
  return p;
}

/**
 * Byte maksimum per respons Range. Potongan dibaca sekali lalu file langsung ditutup (<video> meminta sisanya sendiri).
 * Respons yang di-stream menahan file terbuka selama <video> berhenti membaca, dan di Windows file yang terbuka tidak
 * bisa diganti: proxy baru setelah ganti Grade gagal menggantikan _proxy.mp4 (bug 07/10).
 */
export const RANGE_CHUNK = 4 * 1024 * 1024;

async function readSlice(path: string, start: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const fh = await open(path, 'r');
  try {
    const buf = new Uint8Array(length);
    let off = 0;
    while (off < length) {
      const { bytesRead } = await fh.read(buf, off, length - off, start + off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return off === length ? buf : buf.slice(0, off);
  } finally {
    await fh.close();
  }
}

export async function fileResponse(path: string, range: string | null): Promise<Response> {
  if (!existsSync(path) || !statSync(path).isFile()) return new Response('not found', { status: 404 });
  const size = statSync(path).size;
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const asked = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > asked) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const body = await readSlice(path, start, Math.min(asked, start + RANGE_CHUNK - 1) - start + 1);
    const end = start + body.length - 1;
    return new Response(body, {
      status: 206,
      headers: { 'Content-Type': type, 'Content-Length': String(body.length), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
    });
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' } });
}

// komposisi preview: hanya skrip/aset lokal, tidak boleh request ke internet
const PREVIEW_CSP = "default-src 'none'; script-src 'self' reel: 'unsafe-inline'; style-src reel: 'unsafe-inline'; font-src reel: data:; img-src reel: data: blob:; media-src reel: blob:";

export function handleProtocol(): void {
  protocol.handle(SCHEME, (req) => {
    const url = new URL(req.url);
    const rel = url.pathname.replace(/^\/+/, '');
    if (url.host === 'preview') {
      return new Response(state.previewHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PREVIEW_CSP } });
    }
    const roots: Record<string, string | null> = { project: state.projectDir, vendor: state.vendorDir, sfx: state.sfxDir };
    const root = roots[url.host] ?? null;
    if (!root) return new Response('forbidden', { status: 403 });
    const path = resolveInside(root, rel);
    if (!path) return new Response('forbidden', { status: 403 });
    return fileResponse(path, req.headers.get('range'));
  });
}
