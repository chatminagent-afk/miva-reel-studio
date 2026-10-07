// Turunan dokumen untuk UI (dihitung ulang setiap dokumen berubah): timing, captions, komposisi, cue SFX, status kata.
import { useMemo } from 'react';
import { buildCompositionData, buildCues, layoutCaptions, type SfxLibrary } from '../../../core/compose';
import { derive } from '../../../core/doc';
import { editedToSrc, gaps, type Gap } from '../../../core/edit';
import { applySfxOff, isOff, manualMatch, sfxOff } from '../../../core/sfxedit';
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

export interface SfxView extends SfxCue {
  src: number;
  /** cue otomatis yang dimatikan pengguna */
  muted: boolean;
  /** indeks di edit.sfx kalau SFX manual, -1 kalau otomatis */
  manual: number;
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
  /** semua cue SFX (termasuk yang dimatikan) dengan waktu footage mentah, untuk track SFX */
  sfxSrc: SfxView[];
  finalDuration: number;
}

const clean = (w: string) => w.replace(/[,.]+$/, '');

export function computeDerived(doc: Doc, lib: SfxLibrary | null): Derived {
  const { timing, captions, kept } = derive(doc);
  const tIndex = new Map(kept.map((raw, t) => [raw, t]));
  const comp = buildCompositionData(timing, captions, doc.edit);
  let cues: CuesJson | null = null;
  let all: SfxCue[] = [];
  if (lib) {
    const { caps, keys } = layoutCaptions(timing, captions);
    const full = buildCues(timing, caps, keys, doc.edit, lib).cues;
    all = full.sfx;
    cues = applySfxOff(full, doc.edit); // yang benar-benar terdengar (preview = export)
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
  const off = sfxOff(doc.edit);
  const sfxSrc = all.map((c) => ({
    ...c,
    src: editedToSrc(doc.edit.segs, speed, Math.max(0, c.t)).src,
    muted: isOff(c, off),
    manual: lib ? manualMatch(c, doc.edit, lib.features) : -1,
  }));
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
