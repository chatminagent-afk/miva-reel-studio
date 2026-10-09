// Tab Motion (panel kiri): Motion brief + Generate (Rules offline), laporan, daftar motion urut waktu, tambah manual, End card hold.
import { useEffect, useRef, useState } from 'react';
import { getComponent, implementedKinds } from '../../../core/motion';
import type { MotionKind } from '../../../core/motion/types';
import type { Derived } from './derived';
import { Draft } from './fields';
import { mmss, motionRows, reportView } from './motionView';
import * as ops from './ops';
import type { Doc } from './ops';
import type { Sel } from './Timeline';

interface Props {
  doc: Doc;
  d: Derived;
  sel: Sel;
  apply: (label: string, fn: (d: Doc) => Doc) => void;
  /** detik hasil edit di playhead (termasuk ekor) */
  playheadEdited: number;
  onSelectMotion: (id: string) => void;
}

const PLACEHOLDER = `Paste your script with motion blocks, for example:

Kalau kamu punya bisnis tapi masih pegang HP terus...

[MOTION 01 - HOOK | 2 seconds]
Notification chat bertubi-tubi, counter 12 -> 27 -> 43 unread messages.

[MOTION 02 - 3 seconds]
Visual split: BUSINESS di kiri, CHAT di kanan...

Also accepted: [0-3s] blocks and ### sections.`;

/** Kunci tampilan tiap jenis motion (warna ada di styles.css: .mk-<kind>). */
export const KIND_SHORT: Record<MotionKind, string> = {
  statement: 'Text',
  chat: 'Chat',
  chain: 'Chain',
  chips: 'Chips',
  counter: 'Counter',
  toasts: 'Toasts',
  phone: 'Phone',
  split: 'Split',
  bubbles: 'Bubbles',
  logo: 'Logo',
  endcard: 'End card',
  toggle: 'Toggle',
  cta: 'CTA',
};

export function MotionPanel({ doc, d, sel, apply, playheadEdited, onSelectMotion }: Props) {
  const brief = doc.state.motionBrief ?? '';
  const [text, setText] = useState(brief);
  const last = useRef(brief);
  const timer = useRef(0);
  const pending = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ next: Doc; replaced: number } | null>(null);

  const commit = (t: string) => {
    window.clearTimeout(timer.current);
    pending.current = false;
    const norm = t.trim() ? t : '';
    if (norm === last.current) return;
    last.current = norm;
    apply('Motion brief', (x) => ops.setMotionBrief(x, t));
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const textRef = useRef(text);
  textRef.current = text;

  // perubahan dari luar (undo/redo, buka versi) menimpa kotak
  useEffect(() => {
    if (brief !== last.current) {
      last.current = brief;
      pending.current = false;
      window.clearTimeout(timer.current);
      setText(brief);
    }
  }, [brief]);
  // pindah tab saat ada ketikan yang belum diterapkan
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current) commitRef.current(textRef.current);
    },
    [],
  );

  const rows = motionRows(d.motion.resolved);
  const rules = (doc.state.motion ?? []).filter((m) => m.origin === 'rules').length;
  const report = reportView(doc.state.motionReport, doc.state.motion, d.tail);

  const generate = () => {
    window.clearTimeout(timer.current);
    pending.current = false;
    setNotice(null);
    let next: Doc;
    try {
      next = ops.generateMotion(ops.setMotionBrief(doc, text));
    } catch (e) {
      setNotice(`Could not read the brief: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!next.state.motionReport || next.state.motionReport.blocks.length === 0) {
      setNotice('No motion blocks recognised. Start each block with a header such as [MOTION 01 - HOOK | 2 seconds], [0-3s] or ### Title. Nothing was changed.');
      return;
    }
    if (!(next.state.motion ?? []).some((m) => m.origin === 'rules')) {
      // blok ada tapi tidak ada yang bisa dibangun (mis. tanpa keterangan visual): jangan hapus motion yang sudah ada
      setNotice(`Found ${next.state.motionReport.blocks.length} block${next.state.motionReport.blocks.length === 1 ? '' : 's'}, but nothing could be built from ${next.state.motionReport.blocks.length === 1 ? 'it' : 'them'}. Under each header, describe what to show. Nothing was changed.`);
      return;
    }
    if (rules > 0) setConfirm({ next, replaced: rules });
    else run(next);
  };
  const run = (next: Doc) => {
    last.current = next.state.motionBrief ?? '';
    apply('Generate motion', () => next);
    setConfirm(null);
  };

  const addKind = (kind: MotionKind) => {
    const t = Math.max(0, playheadEdited);
    const next = ops.addMotion(doc, kind, t);
    const id = next.state.motion?.at(-1)?.id;
    apply(`Add ${getComponent(kind)?.title ?? kind}`, (x) => ops.addMotion(x, kind, t));
    if (id) onSelectMotion(id);
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }} data-testid="motion-panel">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <span className="sech">Motion brief</span>
          <span className="muted" style={{ fontSize: 11 }}>Rules, offline</span>
        </div>
        <textarea
          className="field"
          rows={9}
          value={text}
          aria-label="Motion brief"
          data-testid="motion-brief"
          placeholder={PLACEHOLDER}
          spellCheck={false}
          style={{ lineHeight: 1.45, fontSize: 11.5 }}
          onChange={(e) => {
            setText(e.target.value);
            setNotice(null);
            pending.current = true;
            window.clearTimeout(timer.current);
            const v = e.target.value;
            timer.current = window.setTimeout(() => commit(v), 800);
          }}
          onBlur={() => commit(textRef.current)}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-pri" data-testid="motion-generate" disabled={!text.trim()} onClick={generate}>
            Generate from brief
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            {text.trim() ? 'Reads the blocks and places them on your words.' : 'Paste a brief first.'}
          </span>
        </div>
        {notice && (
          <div className="err" role="alert" data-testid="motion-notice">
            {notice}
          </div>
        )}
        {report && !report.empty && (
          <div className="mreport" data-testid="motion-report">
            <div className="mstat">
              <b data-testid="report-blocks">{report.blocks}</b>
              <span>blocks found</span>
            </div>
            <div className="mstat">
              <b data-testid="report-created">{report.created}</b>
              <span>motions created</span>
            </div>
            <div className={`mstat${report.review ? ' warn' : ''}`}>
              <b data-testid="report-review">{report.review}</b>
              <span>need review</span>
            </div>
            <div className={`mstat${report.guessed ? ' warn' : ''}`}>
              <b data-testid="report-guessed">{report.guessed}</b>
              <span>timing guessed</span>
            </div>
            {report.notes.length > 0 && (
              <ul className="mnotes" data-testid="report-notes">
                {report.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 84px', alignItems: 'center', gap: '4px 10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>End card hold</span>
          <span className="muted" style={{ fontSize: 11 }}>Seconds the last frame is held after the final word (0 to 10)</span>
        </div>
        <Draft
          shown={String(d.tail)}
          label="End card hold"
          testId="motion-tail"
          type="number"
          step={0.1}
          min={0}
          max={10}
          check={(t) => {
            const n = Number(t.replace(',', '.'));
            if (!t.trim() || !Number.isFinite(n)) return { error: 'Enter seconds' };
            if (n < 0 || n > 10) return { error: '0 to 10 s' };
            return { norm: String(Math.round(n * 100) / 100), apply: () => apply('End card hold', (x) => ops.setTail(x, n)) };
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <span className="sech">
            Motions <span className="muted" data-testid="motion-count">{rows.length}</span>
          </span>
          <select
            className="field"
            style={{ width: 150 }}
            aria-label="Add motion"
            data-testid="motion-add"
            value=""
            title="Adds the motion at the playhead"
            onChange={(e) => e.target.value && addKind(e.target.value as MotionKind)}
          >
            <option value="">+ Add motion</option>
            {implementedKinds().map((k) => (
              <option key={k} value={k}>
                {getComponent(k)?.title ?? k}
              </option>
            ))}
          </select>
        </div>
        {rows.length === 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            No motions yet. Generate them from the brief, or add one at the playhead.
          </span>
        )}
        <div data-testid="motion-list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`mrow mk-${r.kind}${sel?.kind === 'motion' && sel.id === r.id ? ' sel' : ''}`}
              data-testid="motion-item"
              data-id={r.id}
              data-kind={r.kind}
              onClick={() => onSelectMotion(r.id)}
            >
              <span className="mkind">{KIND_SHORT[r.kind]}</span>
              <span className="mname">
                <span className="mtitle" title={r.name}>{r.name}</span>
                <span className="mono muted mtime">
                  {mmss(r.t0)} - {mmss(r.t1)}
                </span>
              </span>
              <span className="mbadges">
                {r.review && <span className="mbadge review" title="Needs review">Review</span>}
                {r.scene && <span className="mbadge" title="Dark scrim and blurred footage">Scene</span>}
                {r.silent && <span className="mbadge" title="No sound effects">Silent</span>}
                {r.manual && <span className="mbadge" title="Kept when you regenerate">Manual</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      {confirm && (
        <div className="scrim">
          <div role="dialog" aria-label="Replace motions" className="dialog" style={{ maxWidth: 420 }} data-testid="motion-confirm">
            <span style={{ fontSize: 16, fontWeight: 600 }}>Replace generated motions?</span>
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>
              This replaces {confirm.replaced} motion{confirm.replaced === 1 ? '' : 's'} generated from the brief, including any edits you made to {confirm.replaced === 1 ? 'it' : 'them'}.
              Motions you added manually are kept. You can undo with Ctrl+Z.
            </span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn" data-testid="motion-confirm-cancel" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-pri" data-testid="motion-confirm-yes" onClick={() => run(confirm.next)}>
                Replace
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
