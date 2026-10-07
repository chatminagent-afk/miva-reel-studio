// Tab Captions: transkrip sebagai alat potong. Kata dicoret = dibuang dari video; chip jeda = hening yang dibuang (merah)
// atau disimpan (garis putus). Kata kunci berwarna emas. Klik = pilih + lompat ke kata itu.
import { Fragment } from 'react';
import type { AutoEditEvent } from '../../../main/projects';
import type { Derived } from './derived';
import type { Doc } from './ops';
import type { Sel } from './Timeline';

interface Props {
  doc: Doc;
  d: Derived;
  sel: Sel;
  time: number;
  summary: Extract<AutoEditEvent, { type: 'done' }>['summary'] | null;
  onHideSummary: () => void;
  onSelect: (s: Sel, seekTo?: number) => void;
  onResuggest: () => void;
}

export function Transcript({ doc, d, sel, time, summary, onHideSummary, onSelect, onResuggest }: Props) {
  const W = doc.state.words;
  const fix = doc.edit.fix ?? {};
  const keyWords = new Set(doc.state.keywords.flatMap((m) => m.big));
  const retake = new Map<number, string>();
  for (const r of doc.state.retakes) for (const i of r.words) retake.set(i, `Retake: "${r.text}" said again`);
  const gapAfter = new Map(d.gaps.map((g) => [g.after, g]));
  const nowIdx = W.findIndex((w) => time >= w.s && time < (w.e_ref ?? w.e));

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
      {summary && (
        <div className="banner" data-testid="autoedit-banner">
          <span style={{ fontSize: 12, fontWeight: 600 }}>Auto Edit done</span>
          <span style={{ fontSize: 12, color: '#D6CFB8' }}>
            {summary.silences} silences and {summary.retakes} retakes removed, {summary.keywords} keywords suggested. {summary.rawDuration.toFixed(1)} s → {summary.finalDuration.toFixed(1)} s.
            {summary.fallback ? ` Transcribed on CPU (${summary.fallback}).` : ''}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-pri" onClick={onHideSummary}>
              Accept all
            </button>
            <button type="button" className="btn" onClick={onHideSummary}>
              Review
            </button>
          </div>
        </div>
      )}
      <div className="row">
        <span className="lbl">Suggest keywords</span>
        <div className="segs">
          <button type="button" className="seg on" title="Offline rules: numbers, names and brands">
            Rules
          </button>
          <button type="button" className="seg" disabled title="Coming in a later version">
            Local LLM
          </button>
          <button type="button" className="seg" disabled title="Coming in a later version">
            Claude
          </button>
        </div>
      </div>
      <div className="row">
        <span className="muted" style={{ fontSize: 11 }}>
          Click a word to edit it. Delete cuts it. Red chips are removed silences.
        </span>
        <button type="button" className="btn" onClick={onResuggest} title="Replace keywords with new suggestions (undo with Ctrl+Z)">
          Re-suggest
        </button>
      </div>
      <div style={{ lineHeight: 1.8 }} data-testid="transcript">
        {W.map((w, i) => {
          const kept = d.keptSet.has(i);
          const g = gapAfter.get(i);
          const text = Object.prototype.hasOwnProperty.call(fix, w.w) ? fix[w.w] : w.w;
          const cls =
            'w' +
            (keyWords.has(i) && kept ? ' key' : '') +
            (kept ? '' : ' cut') +
            (retake.has(i) ? ' flag' : '') +
            (sel?.kind === 'word' && sel.i === i ? ' sel' : '') +
            (i === nowIdx ? ' now' : '');
          return (
            <Fragment key={i}>
              <button type="button" className={cls} title={retake.get(i) ?? `${w.s.toFixed(2)} s`} data-testid={`w${i}`} onClick={() => onSelect({ kind: 'word', i }, w.s)}>
                {text}
              </button>
              {g && (
                <button
                  type="button"
                  className={`gap ${g.cut ? 'gap-cut' : 'gap-keep'}${sel?.kind === 'gap' && sel.after === i ? ' sel' : ''}`}
                  data-testid={`gap${i}`}
                  title={g.cut ? 'Silence removed · click to review' : 'Silence kept'}
                  onClick={() => onSelect({ kind: 'gap', after: i }, g.start)}
                >
                  {(g.end - g.start).toFixed(1)}s
                </button>
              )}{' '}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
