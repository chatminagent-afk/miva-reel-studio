// Operasi edit (murni, bisa di-undo): semua mengubah segs / kata kunci / kamus, tidak pernah file langsung.
import type { ProjectState } from '../../../core/doc';
import { cutRange, keepRange, keptWordIndices, normalizeSegs, setGapKept, setWordKept, srcToEdited, wordKept, type Gap } from '../../../core/edit';
import { suggestKeywords, type KeywordMark } from '../../../core/suggest';
import type { EditJson, Seg } from '../../../core/types';

export interface Doc {
  edit: EditJson;
  state: ProjectState;
}

const withSegs = (d: Doc, segs: Seg[]): Doc => ({ ...d, edit: { ...d.edit, segs } });

export function toggleWord(d: Doc, i: number): Doc {
  const w = d.state.words[i];
  return withSegs(d, setWordKept(d.edit.segs, d.state.words, i, !wordKept(d.edit.segs, w), d.state.duration));
}

export function setWord(d: Doc, i: number, keep: boolean): Doc {
  return withSegs(d, setWordKept(d.edit.segs, d.state.words, i, keep, d.state.duration));
}

export function setGap(d: Doc, g: Gap, keep: boolean): Doc {
  return withSegs(d, setGapKept(d.edit.segs, g, keep));
}

export function cut(d: Doc, a: number, b: number): Doc {
  return withSegs(d, cutRange(d.edit.segs, a, b));
}

export function restore(d: Doc, a: number, b: number): Doc {
  return withSegs(d, keepRange(d.edit.segs, a, b));
}

/** Geser batas seg k (trim di timeline); dibatasi seg tetangga dan durasi footage. */
export function trimSeg(d: Doc, k: number, edge: 'start' | 'end', t: number): Doc {
  const segs = d.edit.segs.map((s) => [...s] as Seg);
  const [a, b] = segs[k];
  if (edge === 'start') segs[k][0] = Math.max(k > 0 ? segs[k - 1][1] : 0, Math.min(t, b - 0.1));
  else segs[k][1] = Math.min(k + 1 < segs.length ? segs[k + 1][0] : d.state.duration, Math.max(t, a + 0.1));
  return withSegs(d, normalizeSegs(segs));
}

export function markOf(d: Doc, i: number): KeywordMark | undefined {
  return d.state.keywords.find((m) => m.big.includes(i));
}

const withMarks = (d: Doc, keywords: KeywordMark[]): Doc => ({ ...d, state: { ...d.state, keywords, keywordMode: 'manual' } });

export function setKeyword(d: Doc, i: number, on: boolean): Doc {
  const rest = d.state.keywords.filter((m) => !m.big.includes(i));
  if (!on) return withMarks(d, rest);
  const w = d.state.words[i].w;
  const mark: KeywordMark = { big: [i], anim: w.length > 9 ? 'blur' : 'slam', hit: null };
  return withMarks(d, [...rest, mark].sort((a, b) => a.big[0] - b.big[0]));
}

export function setKeywordProp(d: Doc, i: number, patch: Partial<Pick<KeywordMark, 'anim' | 'hit' | 'pos'>>): Doc {
  // boom maks 1 per video (aturan skill): boom baru menggantikan boom lama
  const marks = d.state.keywords.map((m) => (patch.hit === 'boom' && m.hit === 'boom' && !m.big.includes(i) ? { ...m, hit: null } : m));
  return withMarks(
    d,
    marks.map((m) => (m.big.includes(i) ? { ...m, ...patch } : m)),
  );
}

/** Saran ulang kata kunci (Rules) untuk kata yang sedang terpakai. */
export function resuggest(d: Doc, names: string[]): Doc {
  const fix = d.edit.fix ?? {};
  const words = d.state.words.map((w) => ({ ...w, w: Object.prototype.hasOwnProperty.call(fix, w.w) ? fix[w.w] : w.w }));
  const speed = Number(d.edit.speed ?? 1.25);
  const marks = suggestKeywords(words, {
    candidates: keptWordIndices(d.edit.segs, d.state.words),
    timeOf: (i) => srcToEdited(d.edit.segs, speed, words[i].s + 0.05) ?? words[i].s / speed,
    names,
    sentenceStarts: d.state.segStarts,
  });
  return { ...d, state: { ...d.state, keywords: marks, keywordMode: 'rules' } };
}

/** Koreksi ejaan: berlaku untuk semua kemunculan kata yang sama (edit.json "fix", sama dengan skill). */
export function setFix(d: Doc, heard: string, correct: string): Doc {
  const fix = { ...(d.edit.fix ?? {}) };
  if (!correct || correct === heard) delete fix[heard];
  else fix[heard] = correct;
  return { ...d, edit: { ...d.edit, fix } };
}

export function setEdit(d: Doc, patch: Partial<EditJson>): Doc {
  return { ...d, edit: { ...d.edit, ...patch } };
}

// ---------- SFX ----------
const ALIGN = new Set(['whoosh', 'swish', 'riser']); // puncak bunyi jatuh tepat di titik (seperti SFX otomatis)

export function addSfx(d: Doc, t: number, id: string, kat: string): Doc {
  const sfx = [...(d.edit.sfx ?? []), { t: Math.round(t * 1000) / 1000, id, kat, align: ALIGN.has(kat), gain_db: 0 }];
  return { ...d, edit: { ...d.edit, sfx: sfx.sort((a, b) => a.t - b.t) } };
}

export function updateSfx(d: Doc, j: number, patch: Partial<NonNullable<EditJson['sfx']>[number]>): Doc {
  const sfx = (d.edit.sfx ?? []).map((m, k) => (k === j ? { ...m, ...patch } : m));
  return { ...d, edit: { ...d.edit, sfx } };
}

export function removeSfx(d: Doc, j: number): Doc {
  return { ...d, edit: { ...d.edit, sfx: (d.edit.sfx ?? []).filter((_, k) => k !== j) } };
}

/** Matikan/nyalakan satu SFX otomatis (edit.json "sfx_off", khusus app). */
export function toggleSfxOff(d: Doc, kat: string, t: number): Doc {
  const off = Array.isArray(d.edit.sfx_off) ? (d.edit.sfx_off as { kat: string; t: number }[]) : [];
  const hit = off.findIndex((o) => o.kat === kat && Math.abs(o.t - t) < 0.06);
  const next = hit >= 0 ? off.filter((_, k) => k !== hit) : [...off, { kat, t }];
  return { ...d, edit: { ...d.edit, sfx_off: next } };
}
