// Penjaga offline untuk proses Node render (HyperFrames): semua koneksi TCP ke luar loopback ditolak.
// Dipasang lewat `node --import <file ini>`; worker thread mewarisi execArgv, jadi ikut terjaga.
// Setiap percobaan dicatat ke stderr dengan awalan "[offline-guard]" supaya runner bisa melaporkannya.
import net from 'node:net';

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(?:\.\d{1,3}){3})$/i;
const original = net.Socket.prototype.connect;

net.Socket.prototype.connect = function connect(...args) {
  let opts = args[0];
  if (Array.isArray(opts)) opts = opts[0]; // net.connect() mengirim argumen yang sudah dinormalisasi
  if (typeof opts === 'number') opts = { port: opts, host: typeof args[1] === 'string' ? args[1] : undefined };
  if (typeof opts === 'string') opts = { path: opts };
  const host = opts?.host ?? 'localhost';
  if (opts?.path || LOOPBACK.test(String(host))) return original.apply(this, args);
  const target = `${host}:${opts?.port ?? ''}`;
  process.stderr.write(`[offline-guard] blocked ${target}\n`);
  const err = Object.assign(new Error(`offline: koneksi ke ${target} diblokir`), { code: 'ECONNREFUSED' });
  process.nextTick(() => this.destroy(err));
  return this;
};
