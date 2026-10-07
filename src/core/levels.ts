// Level SFX mix.py skill, dipisah supaya preview di UI memakai angka yang sama.
// puncak tiap kategori (dBFS) setelah klip dinormalisasi; suara -14 LUFS (puncak ±-1,5)
export const PEAK: Record<string, number> = {
  ketik: -25, klik: -22, tick: -24, whoosh: -17, swish: -20, impact: -13, boom: -11,
  riser: -15, ding: -19, pop: -20, kartun: -18, glitch: -20, lain: -20,
};
