// Helper agar hasil port TypeScript identik dengan script Python skill /reel-edit.
// Python round() dan format ":.Nf" membulatkan nilai biner EKSAK dengan aturan half-to-even;
// Math.round/toFixed di JS memakai half-up, jadi hasil bisa beda di nilai seperti 0.125.

/** Pembulatan persis seperti Python `round(x, n)`. */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x;
  return Number(roundDecimalString(x, n));
}

/** Format persis seperti Python `f"{x:.{n}f}"`. */
export function pyFixed(x: number, n: number): string {
  return roundDecimalString(x, n);
}

/** Representasi float seperti Python `str(float)` (2 -> "2.0"), dipakai saat menyusun argumen ffmpeg. */
export function pyFloatStr(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e16) return x.toFixed(1);
  return String(x);
}

function roundDecimalString(x: number, n: number): string {
  const neg = x < 0 || Object.is(x, -0);
  // toFixed(100) memberi ekspansi desimal eksak dari nilai biner (cukup untuk |x| >= 1e-30)
  const exact = Math.abs(x).toFixed(100);
  const [intPart, frac] = exact.split('.');
  const keep = frac.slice(0, n);
  const rest = frac.slice(n);
  const digits = (intPart + keep).split('').map(Number);
  const first = Number(rest[0]);
  const tail = rest.slice(1);
  let up = false;
  if (first > 5) up = true;
  else if (first === 5) {
    if (/[1-9]/.test(tail)) up = true;
    else up = digits[digits.length - 1] % 2 === 1; // tepat setengah: ke genap
  }
  if (up) {
    let i = digits.length - 1;
    while (i >= 0) {
      if (digits[i] === 9) {
        digits[i] = 0;
        i--;
      } else {
        digits[i]++;
        break;
      }
    }
    if (i < 0) digits.unshift(1);
  }
  const s = digits.join('');
  const ip = s.slice(0, s.length - n) || '0';
  const fp = s.slice(s.length - n);
  const out = n > 0 ? `${ip}.${fp}` : ip;
  const isZero = /^[0.]+$/.test(out);
  return neg && !isZero ? `-${out}` : out;
}

/** numpy.percentile (interpolasi linear, default numpy). */
export function percentile(values: ArrayLike<number>, q: number): number {
  const a = Array.from(values).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const idx = ((a.length - 1) * q) / 100;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

/** Jumlah karakter seperti Python len(str) (code point, bukan UTF-16 unit). */
export function pyLen(s: string): number {
  return Array.from(s).length;
}
