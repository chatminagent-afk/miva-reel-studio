// Panel kanan (Details): isi tergantung pilihan: kata (Caption), jeda (Silence), bagian terbuang (Removed), SFX, motion,
// atau klip/tanpa pilihan (Video, Speed, Adjust, Audio). Hanya kontrol yang benar-benar berfungsi yang ditampilkan.
import { useEffect, useState, type ReactElement } from 'react';
import type { SfxLibrary } from '../../../core/compose';
import type { KeywordMark } from '../../../core/suggest';
import { fmtTime } from '../api';
import type { Derived } from './derived';
import { Switch } from './fields';
import { MotionDetails } from './MotionDetails';
import * as ops from './ops';
import type { Doc } from './ops';
import type { Sel } from './Timeline';

interface Props {
  doc: Doc;
  d: Derived;
  sel: Sel;
  apply: (label: string, fn: (d: Doc) => Doc) => void;
  onGrade: (grade: string) => void;
  proxyBusy: boolean;
  /** proxy preview gagal dibuat ulang setelah ganti Grade */
  proxyError: string | null;
  sfxBuiltin: boolean;
  lib: SfxLibrary | null;
  onClearSel: () => void;
}

function SfxPanel({ doc, d, sel, apply, lib, onClearSel }: Props & { sel: Extract<Sel, { kind: 'sfx' }> }) {
  const cue = d.sfxSrc.find((c) => c.kat === sel.kat && Math.abs(c.t - sel.t) < 0.06);
  if (!cue) return <div className="sec muted">Sound no longer exists.</div>;
  const m = cue.manual >= 0 ? doc.edit.sfx?.[cue.manual] : undefined;
  const ids = lib ? (lib.catalog.pilihan[cue.kat] ?? []).filter((i) => lib.catalog.bunyi[i]?.kategori !== 'buang') : [];
  const play = () => void new Audio(`reel://sfx/${encodeURIComponent(cue.id)}.wav`).play();
  return (
    <div className="sec">
      <div className="row">
        <span style={{ fontSize: 20, fontWeight: 600 }}>{cue.kat}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {fmtTime(Math.max(0, cue.t))}
        </span>
      </div>
      <div className="row">
        <span className="muted">Sound</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="ib" aria-label="Play sound" onClick={play}>
            ▶
          </button>
          {m ? (
            <select className="field" style={{ width: 160 }} value={cue.id} aria-label="Sound file" onChange={(e) => apply('Change sound', (x) => ops.updateSfx(x, cue.manual, { id: e.target.value }))}>
              {ids.map((i) => (
                <option key={i} value={i}>
                  {lib?.catalog.bunyi[i]?.label ?? i}
                </option>
              ))}
            </select>
          ) : (
            <span className="mono" style={{ fontSize: 11 }}>{cue.id}</span>
          )}
        </div>
      </div>
      {m ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0,1fr) 52px', alignItems: 'center', gap: 8 }}>
            <span className="muted">Volume</span>
            <input className="rng" type="range" min={-12} max={6} step={1} value={m.gain_db ?? 0} aria-label="Sound volume" onChange={(e) => apply('Sound volume', (x) => ops.updateSfx(x, cue.manual, { gain_db: Number(e.target.value) }))} />
            <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>
              {(m.gain_db ?? 0) > 0 ? '+' : ''}
              {m.gain_db ?? 0} dB
            </span>
          </div>
          <span className="muted" style={{ fontSize: 11 }}>
            Added by you. Drag the marker on the SFX track to move it.
          </span>
          <button type="button" className="btn" data-testid="delete-sfx" onClick={() => { apply('Delete sound', (x) => ops.removeSfx(x, cue.manual)); onClearSel(); }}>
            Delete sound (Del)
          </button>
        </>
      ) : (
        <>
          <span className="muted" style={{ fontSize: 11 }}>
            Placed automatically by the caption rules (same as the skill).
          </span>
          <button type="button" className="btn" data-testid="mute-sfx" onClick={() => apply(cue.muted ? 'Unmute sound' : 'Mute sound', (x) => ops.toggleSfxOff(x, cue.kat, cue.t))}>
            {cue.muted ? 'Unmute' : 'Mute this sound'}
          </button>
        </>
      )}
    </div>
  );
}

const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

function Segs<T extends string | number>({ value, options, onPick, label }: { value: T; options: { v: T; l: string }[]; onPick: (v: T) => void; label?: string }) {
  return (
    <div className="segs" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" className={`seg${o.v === value ? ' on' : ''}`} onClick={() => onPick(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

function WordPanel({ doc, d, i, apply }: { doc: Doc; d: Derived; i: number; apply: Props['apply'] }) {
  const w = doc.state.words[i];
  const fix = doc.edit.fix ?? {};
  const shown = Object.prototype.hasOwnProperty.call(fix, w.w) ? fix[w.w] : w.w;
  const [spell, setSpell] = useState(shown);
  useEffect(() => setSpell(shown), [shown, i]);
  const kept = d.keptSet.has(i);
  const mark = ops.markOf(doc, i);
  const retake = doc.state.retakes.find((r) => r.words.includes(i));
  const chunk = d.chunks.find((c) => c.raw.includes(i));
  const tI = d.tIndex.get(i);
  const sounds = d.cues && chunk && tI !== undefined ? d.cues.sfx.filter((c) => c.t >= d.timing.words[d.tIndex.get(chunk.raw[0])!].s - 0.6 && c.t <= d.timing.words[tI].e + 0.3).map((c) => c.kat) : [];
  const setProp = (patch: Partial<Pick<KeywordMark, 'anim' | 'hit' | 'pos'>>) => apply('Keyword style', (x) => ops.setKeywordProp(x, i, patch));
  return (
    <div className="sec">
      <div className="row">
        <span style={{ fontSize: 20, fontWeight: 600, wordBreak: 'break-word' }}>{shown}</span>
        <span className="mono muted" style={{ fontSize: 11 }}>
          {fmtTime(w.s)}
        </span>
      </div>
      {retake && <span style={{ fontSize: 12, color: 'var(--bad)' }}>Flagged: retake (“{retake.text}” said again)</span>}
      {!kept && <span style={{ fontSize: 12, color: 'var(--bad)' }}>Cut · not in export</span>}
      <div className="row">
        <span>Keyword</span>
        <Switch on={!!mark} label="Keyword" onToggle={() => apply(mark ? 'Remove keyword' : 'Make keyword', (x) => ops.setKeyword(x, i, !mark))} />
      </div>
      {mark && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="lbl">Animation</span>
            <Segs label="Animation" value={mark.anim} options={(['slam', 'blur', 'type'] as const).map((v) => ({ v, l: cap(v) }))} onPick={(v) => setProp({ anim: v })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="lbl">Hit (extra sound)</span>
            <Segs label="Hit" value={mark.hit ?? 'none'} options={[{ v: 'none', l: 'None' }, { v: 'impact', l: 'Impact' }, { v: 'boom', l: 'Boom' }]} onPick={(v) => setProp({ hit: v === 'none' ? null : (v as 'impact' | 'boom') })} />
            <span className="muted" style={{ fontSize: 11 }}>
              Boom is used once per video.
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="lbl">Position</span>
            <Segs label="Position" value={mark.pos ?? 'c'} options={[{ v: 'l', l: 'Left' }, { v: 'c', l: 'Center' }, { v: 'r', l: 'Right' }]} onPick={(v) => setProp({ pos: v as 'l' | 'c' | 'r' })} />
          </div>
        </>
      )}
      <div className="row">
        <span className="muted">Sound (auto)</span>
        <span>{sounds.length ? [...new Set(sounds)].join(' + ') : '—'}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="lbl">Spelling (fixes every “{w.w}”)</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field" value={spell} onChange={(e) => setSpell(e.target.value)} aria-label="Correct spelling" onKeyDown={(e) => e.key === 'Enter' && apply('Fix spelling', (x) => ops.setFix(x, w.w, spell.trim()))} />
          <button type="button" className="btn" disabled={spell.trim() === shown} onClick={() => apply('Fix spelling', (x) => ops.setFix(x, w.w, spell.trim()))}>
            Apply
          </button>
        </div>
      </div>
      <button type="button" className="btn" data-testid="toggle-word" onClick={() => apply(kept ? 'Cut word' : 'Restore word', (x) => ops.setWord(x, i, !kept))}>
        {kept ? 'Cut word (Del)' : 'Restore word'}
      </button>
    </div>
  );
}

export function Details(p: Props) {
  const { doc, d, sel, apply } = p;
  const [tab, setTab] = useState<'video' | 'speed' | 'adjust' | 'audio'>('video');
  const speed = Number(doc.edit.speed ?? 1.25);
  const camOn = doc.edit.camera === undefined || doc.edit.camera === 'auto';
  const kuat = Number(doc.edit.camera_kuat ?? 1);

  let body: ReactElement;
  let tabs: { k: string; l: string }[] = [];
  if (sel?.kind === 'motion') {
    tabs = [{ k: 'motion', l: 'Motion' }];
    body = <MotionDetails key={sel.id} doc={doc} d={d} id={sel.id} apply={apply} onClearSel={p.onClearSel} />;
  } else if (sel?.kind === 'sfx') {
    tabs = [{ k: 'sfx', l: 'Sound' }];
    body = <SfxPanel {...p} sel={sel} />;
  } else if (sel?.kind === 'word') {
    tabs = [{ k: 'caption', l: 'Caption' }];
    body = <WordPanel doc={doc} d={d} i={sel.i} apply={apply} />;
  } else if (sel?.kind === 'gap') {
    const g = d.gaps.find((x) => x.after === sel.after);
    tabs = [{ k: 'silence', l: 'Silence' }];
    body = g ? (
      <div className="sec">
        <div className="row">
          <span style={{ fontSize: 20, fontWeight: 600 }}>{(g.end - g.start).toFixed(1)} s pause</span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            {fmtTime(g.start)}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {g.cut ? 'Removed. Keep it to give an on-screen graphic time to land.' : 'Kept in the video.'}
        </span>
        <Segs label="Silence" value={g.cut ? 'cut' : 'keep'} options={[{ v: 'cut', l: 'Cut' }, { v: 'keep', l: 'Keep' }]} onPick={(v) => apply(v === 'keep' ? 'Keep silence' : 'Cut silence', (x) => ops.setGap(x, g, v === 'keep'))} />
      </div>
    ) : (
      <div className="sec muted">Silence no longer exists.</div>
    );
  } else if (sel?.kind === 'cut') {
    tabs = [{ k: 'removed', l: 'Removed' }];
    body = (
      <div className="sec">
        <div className="row">
          <span style={{ fontSize: 20, fontWeight: 600 }}>{(sel.b - sel.a).toFixed(2)} s removed</span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            {fmtTime(sel.a)}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          Not in the export. Restore it to bring this part back.
        </span>
        <button type="button" className="btn" data-testid="restore" onClick={() => apply('Restore part', (x) => ops.restore(x, sel.a, sel.b))}>
          Restore
        </button>
      </div>
    );
  } else {
    tabs = [
      { k: 'video', l: 'Video' },
      { k: 'speed', l: 'Speed' },
      { k: 'adjust', l: 'Adjust' },
      { k: 'audio', l: 'Audio' },
    ];
    body = (
      <>
        {tab === 'video' && (
          <>
            {sel?.kind === 'clip' && (
              <div className="sec">
                <div className="row">
                  <span className="sech">Selected clip</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {fmtTime(sel.a)} – {fmtTime(sel.b)}
                  </span>
                </div>
                <button type="button" className="btn" data-testid="delete-clip" onClick={() => apply('Delete clip', (x) => ops.cut(x, sel.a, sel.b))}>
                  Delete clip (Del)
                </button>
                <span className="muted" style={{ fontSize: 11 }}>
                  Split at the playhead with Ctrl+B. Drag the white edges to trim.
                </span>
              </div>
            )}
            <div className="sec">
              <div className="row">
                <span>Auto camera (zoom &amp; pan)</span>
                <Switch on={camOn} label="Auto camera" onToggle={() => apply('Auto camera', (x) => ops.setEdit(x, { camera: camOn ? [] : 'auto' }))} />
              </div>
              {camOn && (
                <div style={{ display: 'grid', gridTemplateColumns: '76px minmax(0,1fr) 44px', alignItems: 'center', gap: 8 }}>
                  <span className="muted">Strength</span>
                  <input className="rng" type="range" min={0.5} max={1.5} step={0.1} value={kuat} aria-label="Camera strength" onChange={(e) => apply('Camera strength', (x) => ops.setEdit(x, { camera_kuat: Number(e.target.value) }))} />
                  <span className="mono" style={{ fontSize: 11, textAlign: 'right' }}>
                    {kuat.toFixed(1)}×
                  </span>
                </div>
              )}
            </div>
          </>
        )}
        {tab === 'speed' && (
          <div className="sec">
            <div className="row">
              <span className="sech">Speed</span>
              <span className="mono">{speed.toFixed(2)}×</span>
            </div>
            <input className="rng" type="range" min={1} max={1.5} step={0.05} value={speed} aria-label="Speed" onChange={(e) => apply('Speed', (x) => ops.setEdit(x, { speed: Number(e.target.value) }))} />
            <Segs label="Speed presets" value={speed} options={[1, 1.1, 1.25, 1.5].map((v) => ({ v, l: `${v}×` }))} onPick={(v) => apply('Speed', (x) => ops.setEdit(x, { speed: v }))} />
            <span className="muted" style={{ fontSize: 11 }}>
              Pitch stays natural. 1.25× is the MIVA fast-paced default.
            </span>
          </div>
        )}
        {tab === 'adjust' && (
          <div className="sec">
            <span className="sech">Grade preset</span>
            <Segs label="Grade" value={String(doc.edit.grade ?? 'natural')} options={['natural', 'warm', 'lift'].map((v) => ({ v, l: cap(v) }))} onPick={(v) => p.onGrade(v)} />
            <span className="muted" style={{ fontSize: 11 }}>
              {p.proxyBusy ? 'Updating preview…' : 'Natural: daylight phone footage. Warm: indoor/night. Lift: dark or flat footage.'}
            </span>
            {p.proxyError && !p.proxyBusy && (
              <span style={{ fontSize: 11, color: 'var(--bad)' }} data-testid="proxy-error">
                {p.proxyError}
              </span>
            )}
          </div>
        )}
        {tab === 'audio' && (
          <div className="sec">
            <div className="row">
              <span className="muted">Voice</span>
              <span>noise reduction, compressor</span>
            </div>
            <div className="row">
              <span className="muted">Loudness target</span>
              <span className="mono">−14 LUFS</span>
            </div>
            <div className="row">
              <span className="muted">SFX library</span>
              <span>{p.sfxBuiltin ? 'built-in (synthetic)' : 'your library'}</span>
            </div>
            <div className="row">
              <span className="muted">Sound effects</span>
              <span>{d.cues?.sfx.length ?? 0} auto</span>
            </div>
          </div>
        )}
      </>
    );
  }
  const activeTab = tabs.length === 1 ? tabs[0].k : tab;
  return (
    <aside aria-label="Details" className="details">
      <div style={{ display: 'flex', gap: 16, padding: '0 14px', borderBottom: '1px solid var(--line)' }}>
        {tabs.map((t) => (
          <button key={t.k} type="button" className={`rtab${activeTab === t.k ? ' on' : ''}`} onClick={() => setTab(t.k as typeof tab)}>
            {t.l}
          </button>
        ))}
      </div>
      <div style={{ padding: '0 14px 14px', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>{body}</div>
    </aside>
  );
}
