// Turunan dokumen untuk UI (dihitung ulang setiap dokumen berubah): timing, captions, komposisi, cue SFX, status kata.
import { useMemo } from 'react';
import { buildCompositionData, buildCues, layoutCaptions, type SfxLibrary } from '../../../core/compose';
import { derive } from '../../../core/doc';
import { editedToSrc, gaps, type Gap } from '../../../core/edit';
import type { CuesJson, SfxCue, TimingJson } from '../../../core/types';
import type { Doc } from './ops';

export interface ChunkView {
  /** indeks chunk di captions.json */
  k: number;
  /** kata mentah dalam chunk */
  raw: number[];
  text: string;
  key: boolean;
  /** waktu footage mentah */
  start: number;
  end: number;
}

export interface Derived {
  timing: TimingJson;
  captions: ReturnType<typeof derive>['captions'];
  kept: number[];
  keptSet: Set<number>;
  /** indeks timing per kata mentah (undefined = dipotong) */
  tIndex: Map<number, number>;
  comp: ReturnType<typeof buildCompositionData>;
  cues: CuesJson | null;
  gaps: Gap[];
  chunks: ChunkView[];
  /** cue SFX dengan waktu footage mentah (untuk track SFX) */
  sfxSrc: (SfxCue & { src: number })[];
  finalDuration: number;
}

const clean = (w: string) => w.replace(/[,.]+$/, '');

export function computeDerived(doc: Doc, lib: SfxLibrary | null): Derived {
  const { timing, captions, kept } = derive(doc);
  const tIndex = new Map(kept.map((raw, t) => [raw, t]));
  const comp = buildCompositionData(timing, captions, doc.edit);
  let cues: CuesJson | null = null;
  if (lib) {
    const { caps, keys } = layoutCaptions(timing, captions);
    cues = buildCues(timing, caps, keys, doc.edit, lib).cues;
  }
  const fix = doc.edit.fix ?? {};
  const W = doc.state.words;
  const chunks: ChunkView[] = captions.chunks.map((c, k) => {
    const raw = c.w.map((t) => kept[t]);
    const last = W[raw[raw.length - 1]];
    return {
      k,
      raw,
      text: raw.map((i) => clean(Object.prototype.hasOwnProperty.call(fix, W[i].w) ? fix[W[i].w] : W[i].w)).join(' '),
      key: !!(c.big && c.big.length),
      start: W[raw[0]].s,
      end: last.e_ref ?? last.e,
    };
  });
  const speed = Number(doc.edit.speed ?? 1.25);
  const sfxSrc = (cues?.sfx ?? []).map((c) => ({ ...c, src: editedToSrc(doc.edit.segs, speed, Math.max(0, c.t)).src }));
  return {
    timing,
    captions,
    kept,
    keptSet: new Set(kept),
    tIndex,
    comp,
    cues,
    gaps: gaps(doc.edit.segs, W),
    chunks,
    sfxSrc,
    finalDuration: timing.duration,
  };
}

export function useDerived(doc: Doc, lib: SfxLibrary | null): Derived {
  return useMemo(() => computeDerived(doc, lib), [doc, lib]);
}
