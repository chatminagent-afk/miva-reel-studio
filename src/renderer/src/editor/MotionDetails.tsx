// Panel Details untuk motion terpilih: judul + deskripsi komponen, label, waktu, adegan/SFX, tanda review, kutipan brief, editor
// props yang dibuat dari `fields` komponen (semua FieldType; bentuk sulit pakai editor baris dari core/motion/fieldedit), hapus.
import type { FieldSpec, ResolvedMotion } from '../../../core/motion/types';
import { getComponent } from '../../../core/motion';
import { fieldEditor, getPath, propsPatch } from '../../../core/motion/fieldedit';
import { Draft, Switch } from './fields';
import { mmss, MOTION_MIN } from './motionView';
import type { Derived } from './derived';
import * as ops from './ops';
import type { Doc } from './ops';

interface Props {
  doc: Doc;
  d: Derived;
  id: string;
  apply: (label: string, fn: (d: Doc) => Doc) => void;
  onClearSel: () => void;
}

/** Terapkan satu kunci props ke dokumen TERBARU (aman dipakai dari draf yang tertunda). */
const patchProp = (x: Doc, id: string, key: string, value: unknown): Doc => {
  const it = x.state.motion?.find((m) => m.id === id);
  return it ? ops.updateMotion(x, id, { props: propsPatch(it.props, key, value) }) : x;
};

function Field({ spec, row, apply }: { spec: FieldSpec; row: ResolvedMotion; apply: Props['apply'] }) {
  const ed = fieldEditor(row.kind, spec);
  const value = getPath(row.props, spec.key);
  const shown = ed.toText(value);
  const set = (v: unknown) => apply(`Edit ${spec.label}`, (x) => patchProp(x, row.id, spec.key, v));
  const tid = `motion-field-${spec.key}`;
  return (
    <div className="mfield">
      {ed.control === 'toggle' ? (
        <div className="row">
          <span>{spec.label}</span>
          <Switch on={!!value} label={spec.label} testId={tid} onToggle={() => set(!value)} />
        </div>
      ) : (
        <>
          <span className="lbl">{spec.label}</span>
          {ed.control === 'select' ? (
            <select
              className="field"
              aria-label={spec.label}
              data-testid={tid}
              value={shown}
              onChange={(e) => {
                const r = ed.fromText(e.target.value, value);
                if (r.ok) set(r.value);
              }}
            >
              {ed.options!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <Draft
              shown={shown}
              label={spec.label}
              testId={tid}
              area={ed.control === 'area'}
              rows={ed.rows}
              type={ed.control === 'number' ? 'number' : 'text'}
              placeholder={ed.placeholder}
              check={(t) => {
                const r = ed.fromText(t, value);
                return r.ok ? { norm: ed.toText(r.value), apply: () => set(r.value) } : { error: r.error };
              }}
            />
          )}
        </>
      )}
      {ed.hint && <span className="muted" style={{ fontSize: 11 }}>{ed.hint}</span>}
    </div>
  );
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function MotionDetails({ doc, d, id, apply, onClearSel }: Props) {
  const row = d.motion.resolved.find((r) => r.id === id);
  if (!row) return <div className="sec muted">Motion no longer exists.</div>;
  const comp = getComponent(row.kind);
  if (!comp) return <div className="sec muted">Unknown motion type: {row.kind}</div>;
  const scene = row.scene ?? comp.sceneDefault;
  const total = d.finalDuration;
  const failed = d.motion.errors.find((e) => e.id === id);
  const setTimes = (t0: number, t1: number) => apply('Motion timing', (x) => ops.setMotionTimes(x, id, t0, t1));
  const timeCheck = (which: 'start' | 'end') => (t: string) => {
    const n = Number(t.replace(',', '.'));
    if (!t.trim() || !Number.isFinite(n)) return { error: 'Enter a time in seconds' };
    if (n < 0 || n > total) return { error: `Between 0 and ${total.toFixed(2)} s` };
    return { norm: n.toFixed(2), apply: () => (which === 'start' ? setTimes(round2(n), row.t1) : setTimes(row.t0, round2(n))) };
  };

  return (
    <div className="sec" data-testid="motion-details" data-kind={row.kind}>
      <div className="row">
        <span style={{ fontSize: 18, fontWeight: 600, minWidth: 0 }}>{comp.title}</span>
        <span className="mono muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          {mmss(row.t0)}
        </span>
      </div>
      <span className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
        {comp.description}
      </span>
      {failed && (
        <span className="ferr" role="alert">
          This motion could not be built and is skipped: {failed.message}
        </span>
      )}

      {row.review && (
        <div className="banner" data-testid="motion-review-banner" style={{ borderColor: '#6b4b12', background: '#241a08' }}>
          <span style={{ fontSize: 12, color: '#ffd9a0' }}>Needs review: the brief did not match a component exactly, so the closest one was used. Check the text and the timing.</span>
          <div>
            <button type="button" className="btn" data-testid="motion-reviewed" onClick={() => apply('Mark reviewed', (x) => ops.updateMotion(x, id, { review: false }))}>
              Mark as reviewed
            </button>
          </div>
        </div>
      )}

      <div className="mfield">
        <span className="lbl">Label</span>
        <Draft shown={row.label ?? ''} label="Label" testId="motion-label" placeholder={comp.title} check={(t) => ({ norm: t, apply: () => apply('Motion label', (x) => ops.updateMotion(x, id, { label: t })) })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="mfield">
          <span className="lbl">Start (s)</span>
          <Draft shown={row.t0.toFixed(2)} label="Start" testId="motion-start" type="number" step={0.05} min={0} check={timeCheck('start')} />
        </div>
        <div className="mfield">
          <span className="lbl">End (s)</span>
          <Draft shown={row.t1.toFixed(2)} label="End" testId="motion-end" type="number" step={0.05} min={0} check={timeCheck('end')} />
        </div>
      </div>
      <span className="muted" style={{ fontSize: 11 }}>
        {(row.t1 - row.t0).toFixed(2)} s long (minimum {MOTION_MIN} s, suggested {comp.minDur} to {comp.maxDur} s). Times follow the cuts: the motion stays on its words.
      </span>

      <div className="row">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>Scene</span>
          <span className="muted" style={{ fontSize: 11 }}>Dark scrim and blurred footage behind the graphic</span>
        </div>
        <Switch on={scene} label="Scene" testId="motion-scene" onToggle={() => apply('Motion scene', (x) => ops.updateMotion(x, id, { scene: !scene }))} />
      </div>
      <div className="row">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>Silent</span>
          <span className="muted" style={{ fontSize: 11 }}>No sound effects for this motion</span>
        </div>
        <Switch on={row.silent === true} label="Silent" testId="motion-silent" onToggle={() => apply('Motion silent', (x) => ops.updateMotion(x, id, { silent: row.silent !== true }))} />
      </div>
      <div className="row">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>Keep when regenerating</span>
          <span className="muted" style={{ fontSize: 11 }}>Generate from brief replaces motions that are not kept</span>
        </div>
        <Switch on={row.origin === 'manual'} label="Keep when regenerating" testId="motion-keep" onToggle={() => apply('Motion keep', (x) => ops.updateMotion(x, id, { origin: row.origin === 'manual' ? 'rules' : 'manual' }))} />
      </div>

      {row.note && (
        <div className="mfield">
          <span className="lbl">From the brief</span>
          <pre className="mnote" data-testid="motion-note">
            {row.note}
          </pre>
        </div>
      )}

      <div style={{ borderTop: '1px solid #222226', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="sech">Content</span>
        {comp.fields.map((f) => (
          <Field key={f.key} spec={f} row={row} apply={apply} />
        ))}
      </div>

      <button
        type="button"
        className="btn"
        data-testid="delete-motion"
        onClick={() => {
          apply('Delete motion', (x) => ops.removeMotion(x, id));
          onClearSel();
        }}
      >
        Delete motion (Del)
      </button>
      <span className="muted" style={{ fontSize: 11 }}>
        {doc.state.motion?.length ?? 0} motion{(doc.state.motion?.length ?? 0) === 1 ? '' : 's'} in this project.
      </span>
    </div>
  );
}
