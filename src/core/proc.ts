// Proses anak untuk render panjang (HyperFrames, ffmpeg): baca output per baris, batalkan seluruh pohon proses.
import { spawn, type ChildProcess } from 'node:child_process';

export class CancelledError extends Error {
  constructor() {
    super('Dibatalkan');
    this.name = 'CancelledError';
  }
}

export class ProcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly tail: string,
  ) {
    super(message);
    this.name = 'ProcError';
  }
}

/**
 * Hentikan proses beserta turunannya. Windows: taskkill /T. POSIX: proses dijalankan sebagai pemimpin grup
 * (detached), jadi seluruh grup diberi SIGTERM dulu (HyperFrames/puppeteer menutup Chrome-nya sendiri),
 * lalu SIGKILL kalau masih hidup setelah `graceMs`.
 */
export function killTree(child: ChildProcess, graceMs = 4000): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
    return;
  }
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      /* grup sudah habis */
    }
  };
  signal('SIGTERM');
  const t = setTimeout(() => signal('SIGKILL'), graceMs);
  t.unref();
  child.once('close', () => clearTimeout(t));
}

/**
 * Batas CreateProcess Windows = 32.767 karakter untuk seluruh baris perintah. Ambang ini sengaja di bawahnya
 * (selisih cara quoting Node vs perkiraan kita), supaya gagalnya jelas, bukan `spawn ENAMETOOLONG` yang samar.
 */
export const WIN_CMDLINE_MAX = 32_000;

/** Perkiraan panjang baris perintah Windows: program dan tiap argumen berspasi/berkutip dibungkus tanda kutip. */
export function commandLineLength(cmd: string, args: string[]): number {
  const q = (a: string) => (a === '' || /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  return [cmd, ...args].reduce((n, a) => n + q(a).length, 0) + args.length; // + satu spasi per argumen
}

/** Windows: tolak perintah yang kepanjangan dengan pesan jelas. Platform lain tidak punya batas sekecil ini. */
export function assertCommandFits(cmd: string, args: string[], platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return;
  const n = commandLineLength(cmd, args);
  if (n > WIN_CMDLINE_MAX)
    throw new Error(
      `Perintah ${cmd.split(/[\\/]/).pop()} terlalu panjang untuk Windows (${n} karakter, batas ${WIN_CMDLINE_MAX}): ` +
        'proyek ini terlalu kompleks untuk satu perintah. Laporkan sebagai bug.',
    );
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  /** Jumlah baris terakhir (stdout + stderr) yang disimpan untuk pesan error. */
  tailLines?: number;
}

/** Jalankan perintah; resolve saat keluar dengan kode 0, reject ProcError / CancelledError. */
export function runProcess(cmd: string, args: string[], opts: RunOptions = {}): Promise<void> {
  if (opts.signal?.aborted) return Promise.reject(new CancelledError());
  return new Promise((resolve, reject) => {
    assertCommandFits(cmd, args); // throw di executor = reject
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tail: string[] = [];
    const keep = opts.tailLines ?? 40;
    const lines = (onLine?: (l: string) => void) => {
      let buf = '';
      return (d: Buffer) => {
        buf += d.toString();
        const parts = buf.split(/\r?\n|\r/);
        buf = parts.pop() ?? '';
        for (const p of parts) {
          if (!p.trim()) continue;
          tail.push(p);
          if (tail.length > keep) tail.shift();
          onLine?.(p);
        }
      };
    };
    child.stdout!.on('data', lines(opts.onStdoutLine));
    child.stderr!.on('data', lines(opts.onStderrLine));
    const onAbort = () => killTree(child);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e) => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', onAbort);
      if (opts.signal?.aborted) reject(new CancelledError());
      else if (code === 0) resolve();
      else reject(new ProcError(`${cmd} keluar dengan kode ${code}: ${tail.slice(-4).join(' | ')}`, code, tail.join('\n')));
    });
  });
}
