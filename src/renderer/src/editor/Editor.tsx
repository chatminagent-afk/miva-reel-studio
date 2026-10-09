// Editor (mockup Main.dc.html): header, panel kiri (Media / Audio / Captions), player, panel Details, timeline.
// Semua edit lewat useDocHistory (undo/redo), disimpan otomatis ke folder proyek (format skill).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { SfxLibrary } from '../../../core/compose';
import { editedToSrc, srcToEdited } from '../../../core/edit';
import { mergeOverlay } from '../../../core/motionDoc';
import type { SfxCatalog, SfxFeature } from '../../../core/types';
import type { VersionInfo } from '../../../core/versions';
import type { AutoEditEvent, OpenedProject } from '../../../main/projects';
import { api, fmtTime } from '../api';
import { useDerived } from './derived';
import { Details } from './Details';
import { ExportDialog } from './ExportDialog';
import { MotionPanel } from './MotionPanel';
import { motionRows, type Axis } from './motionView';
import * as ops from './ops';
import { Preview, type PlayerHandle } from './Preview';
import { previewHtml } from './previewHtml';
import { useDocHistory } from './store';
import { Timeline, pieces, type Sel } from './Timeline';
import { Transcript } from './Transcript';

type Layout = 'default' | 'media' | 'timeline' | 'preview';
const LAYOUT: Record<Layout, { left: number; right: number; tl: number; showL: boolean; showR: boolean }> = {
  default: { left: 340, right: 300, tl: 250, showL: true, showR: true },
  media: { left: 560, right: 280, tl: 210, showL: true, showR: true },
  timeline: { left: 300, right: 280, tl: 420, showL: true, showR: true },
  preview: { left: 0, right: 0, tl: 170, showL: false, showR: false },
};

interface Props {
  opened: OpenedProject;
  summary: Extract<AutoEditEvent, { type: 'done' }>['summary'] | null;
  onHome: () => void;
  /** versi lain dibuka: editor dimuat ulang dengan dokumen itu */
  onSwitch: (p: OpenedProject) => void;
}

export function Editor({ opened, summary: initialSummary, onHome, onSwitch }: Props) {
  const h = useDocHistory({ edit: opened.doc.edit, state: opened.doc.state });
  const { doc, apply } = h;
  const [lib, setLib] = useState<(SfxLibrary & { builtin: boolean }) | null>(null);
  const [wave, setWave] = useState<number[]>([]);
  const [assets, setAssets] = useState<{ template: string; fontCss: string } | null>(null);
  const [overlayRev, setOverlayRev] = useState(0);
  const [time, setTime] = useState(0);
  /** detik di dalam ekor (freeze frame akhir) kalau playhead ada di sana, selain itu null */
  const [tailT, setTailT] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [layout, setLayout] = useState<Layout>('default');
  const [leftTab, setLeftTab] = useState<'media' | 'audio' | 'captions' | 'motion'>(initialSummary ? 'captions' : 'captions');
  const [zoom, setZoom] = useState(1.2);
  const [summary, setSummary] = useState(initialSummary);
  const [saved, setSaved] = useState<string>(opened.doc.state.updated);
  const [saving, setSaving] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [proxyRev, setProxyRev] = useState(opened.proxyRev);
  const player = useRef<PlayerHandle>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });

  const d = useDerived(doc, lib);
  const speed = Number(doc.edit.speed ?? 1.25);
  const L = LAYOUT[layout];

  useEffect(() => {
    void api()
      .sfxLibrary()
      .then((x) => setLib({ catalog: x.catalog as SfxCatalog, features: x.features as Record<string, SfxFeature>, builtin: x.builtin }));
    void api().waveform().then(setWave);
    void api().renderAssets().then(setAssets);
  }, []);

  // komposisi overlay preview diperbarui (debounce) setiap dokumen berubah; isi = motion app dulu, overlay.* skill sesudahnya
  const overlay = useMemo(() => mergeOverlay(d.motion.overlay, opened.doc.overlay), [d.motion.overlay, opened.doc.overlay]);
  useEffect(() => {
    if (!assets) return;
    const t = setTimeout(() => {
      void api()
        .setPreview(previewHtml(assets.template, assets.fontCss, d.comp, overlay))
        .then(() => setOverlayRev((r) => r + 1));
    }, 150);
    return () => clearTimeout(t);
  }, [assets, d.comp, overlay]);

  // simpan otomatis 1 dtk setelah edit terakhir
  const docRef = useRef(doc);
  docRef.current = doc;
  const [versions, setVersions] = useState<{ versions: VersionInfo[]; current: number | null } | null>(null);
  const refreshVersions = useCallback(async () => setVersions(await api().listVersions({ edit: docRef.current.edit, state: docRef.current.state })), []);
  const flush = useCallback(async () => {
    setSaving(true);
    try {
      const r = await api().saveProject({ edit: docRef.current.edit, state: docRef.current.state });
      setSaved(r.saved);
      void refreshVersions();
    } finally {
      setSaving(false);
    }
  }, [refreshVersions]);
  useEffect(() => void refreshVersions(), [refreshVersions]);
  const saveVersion = async () => {
    await flush();
    await api().saveVersion({ edit: docRef.current.edit, state: docRef.current.state }, 'Manual');
    await refreshVersions();
  };
  const openVersion = async (n: number) => {
    player.current?.pause();
    await flush();
    onSwitch(await api().openVersion(n, { edit: docRef.current.edit, state: docRef.current.state }));
  };
  useEffect(() => {
    if (h.rev === 0) return;
    const t = setTimeout(() => void flush(), 1000);
    return () => clearTimeout(t);
  }, [h.rev, flush]);

  // ukuran player mengikuti ruang yang tersedia
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 24, h: el.clientHeight - 24 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const seek = useCallback((t: number) => player.current?.seek(t), []);
  const select = useCallback(
    (s: Sel, seekTo?: number) => {
      setSel(s);
      if (s?.kind === 'motion') {
        // motion: pemain lompat ke awalnya (detik hasil edit). Item yang baru ditambah belum bertanggal: playhead sudah di sana
        const r = d.motion.resolved.find((x) => x.id === s.id);
        if (r) player.current?.seekEdited(r.t0);
        return;
      }
      if (seekTo !== undefined) seek(seekTo);
    },
    [seek, d.motion.resolved],
  );
  const onTime = useCallback((t: number, isPlaying: boolean, tail?: number) => {
    setTime(t);
    setTailT(tail ?? null);
    setPlaying(isPlaying);
  }, []);

  const deleteSelection = useCallback(() => {
    if (!sel) return;
    if (sel.kind === 'word') apply(d.keptSet.has(sel.i) ? 'Cut word' : 'Restore word', (x) => ops.setWord(x, sel.i, !d.keptSet.has(sel.i)));
    else if (sel.kind === 'clip') {
      apply('Delete clip', (x) => ops.cut(x, sel.a, sel.b));
      setSel(null);
    } else if (sel.kind === 'gap') {
      const g = d.gaps.find((x) => x.after === sel.after);
      if (g && !g.cut) apply('Cut silence', (x) => ops.setGap(x, g, false));
    } else if (sel.kind === 'motion') {
      apply('Delete motion', (x) => ops.removeMotion(x, sel.id));
      setSel(null);
    } else if (sel.kind === 'sfx') {
      if (sel.manual >= 0) {
        apply('Delete sound', (x) => ops.removeSfx(x, sel.manual));
        setSel(null);
      } else apply('Mute sound', (x) => ops.toggleSfxOff(x, sel.kat, sel.t));
    }
  }, [sel, apply, d]);

  const split = useCallback(() => {
    if (!doc.edit.segs.some(([a, b]) => time > a + 0.05 && time < b - 0.05)) return;
    setSplits((s) => [...s, time]);
    const pc = pieces(doc.edit.segs, [...splits, time], opened.doc.state.duration).find((x) => x.kept && x.a <= time + 0.001 && time < x.b);
    if (pc) setSel({ kind: 'clip', a: pc.a, b: pc.b });
  }, [doc.edit.segs, time, splits, opened.doc.state.duration]);

  // shortcut keyboard (tidak aktif saat mengetik di input)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || exportOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') {
        e.preventDefault();
        player.current?.toggle();
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        h.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        h.redo();
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        split();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flush();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h, split, flush, deleteSelection, exportOpen]);

  const onGrade = async (grade: string) => {
    apply('Grade', (x) => ops.setEdit(x, { grade }));
    setProxyBusy(true);
    setProxyError(null);
    try {
      setProxyRev((await api().rebuildProxy(grade)).proxyRev);
    } catch (e) {
      // grade tetap tersimpan (dipakai export); hanya preview yang belum ikut berubah
      setProxyError(`Preview not updated: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e)}`);
    } finally {
      setProxyBusy(false);
    }
  };

  const te = tailT !== null ? d.bodyDuration + tailT : srcToEdited(doc.edit.segs, speed, time);
  /** waktu edit di titik footage mentah; di bagian terbuang: awal bagian terpakai berikutnya */
  const editedAt = (src: number) => {
    const v = srcToEdited(doc.edit.segs, speed, src);
    if (v !== null) return v;
    const next = doc.edit.segs.find(([a]) => a > src);
    return next ? srcToEdited(doc.edit.segs, speed, next[0])! : d.finalDuration;
  };
  /** playhead dalam detik hasil edit (di ekor: badan + posisi ekor; di bagian terbuang: awal bagian berikutnya) */
  const playheadEdited = te ?? editedAt(time);
  const axis = useMemo<Axis>(() => ({ segs: doc.edit.segs, speed, body: d.bodyDuration, raw: opened.doc.state.duration }), [doc.edit.segs, speed, d.bodyDuration, opened.doc.state.duration]);
  const motionList = useMemo(() => motionRows(d.motion.resolved), [d.motion.resolved]);
  const selWords = useMemo(() => new Set(sel?.kind === 'word' ? [sel.i] : []), [sel]);
  const inserts = (doc.edit.inserts ?? []).map((x) => ({ src: editedToSrc(doc.edit.segs, speed, x.t).src, len: x.dur * speed, name: x.src.split(/[\\/]/).pop() ?? x.src }));
  const sfxGroups = useMemo(() => {
    if (!lib) return [];
    return Object.entries(lib.catalog.pilihan).map(([kat, ids]) => ({ kat, ids: ids.filter((i) => lib.catalog.bunyi[i]?.kategori !== 'buang') }));
  }, [lib]);

  return (
    <div className="editor" data-testid="editor">
      <header>
        <div className="logo">M</div>
        <button type="button" className="btn" onClick={async () => { await flush(); onHome(); }} title="Back to projects">
          Projects
        </button>
        <div style={{ flex: '1 1 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} data-testid="project-name">
            {opened.doc.state.name}
          </span>
          {versions && (
          <select
            aria-label="Version"
            data-testid="version"
            value={versions.current ?? 'cur'}
            onChange={(e) => e.target.value !== 'cur' && void openVersion(Number(e.target.value))}
            style={{ height: 26, border: '1px solid var(--line2)', borderRadius: 6, background: '#18181B', color: '#C9C9CF', fontSize: 11, padding: '0 4px' }}
          >
            {versions.current === null && <option value="cur">edited (not a version yet)</option>}
            {[...versions.versions].reverse().map((v) => (
              <option key={v.n} value={v.n} title={v.label}>
                v{v.n} · {v.label}
              </option>
            ))}
          </select>
          )}
          {versions && (
            <button type="button" className="btn" data-testid="save-version" disabled={versions.current !== null} onClick={() => void saveVersion()} title="Keep this state as a new version">
              Save v{(versions.versions.at(-1)?.n ?? 0) + 1}
            </button>
          )}
          <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }} data-testid="saved">
            {saving ? 'Saving…' : `Saved ${new Date(saved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ok)', whiteSpace: 'nowrap' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ok)' }} />
          Offline ready
        </span>
        <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 7, background: '#18181B', border: '1px solid #222226' }}>
          {(['default', 'media', 'timeline', 'preview'] as Layout[]).map((k) => (
            <button key={k} type="button" className={`ib${layout === k ? ' on' : ''}`} aria-label={`${k} layout`} title={k[0].toUpperCase() + k.slice(1)} onClick={() => setLayout(k)}>
              <LayoutIcon k={k} />
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-pri" data-testid="open-export" onClick={async () => { player.current?.pause(); await flush(); setExportOpen(true); }}>
          ⤓ Export
        </button>
      </header>

      <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
        {L.showL && (
          <section aria-label="Assets" style={{ flex: `0 0 ${L.left}px`, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)', minHeight: 0, background: 'var(--bg2)' }}>
            <nav aria-label="Asset types" style={{ display: 'flex', gap: 2, padding: 6, borderBottom: '1px solid var(--line)' }}>
              {(
                [
                  ['media', 'Media'],
                  ['audio', 'Audio'],
                  ['captions', 'Captions'],
                  ['motion', 'Motion'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" className={`ltab${leftTab === k ? ' on' : ''}`} onClick={() => setLeftTab(k)}>
                  {l}
                </button>
              ))}
            </nav>
            {leftTab === 'media' && (
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
                <div className="card">
                  <div className="thumb" style={{ maxWidth: 110 }}>
                    <span className="mono" style={{ position: 'absolute', right: 4, bottom: 4, fontSize: 10, background: 'rgba(0,0,0,.6)', borderRadius: 3, padding: '1px 4px' }}>
                      {fmtTime(opened.doc.state.duration).slice(0, 5)}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, wordBreak: 'break-all' }}>{opened.doc.state.source.split(/[\\/]/).pop()}</span>
                </div>
                <button type="button" className="btn btn-pri" onClick={async () => { await flush(); onHome(); }}>
                  Import new footage
                </button>
              </div>
            )}
            {leftTab === 'audio' && (
              <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto' }}>
                <span className="lbl" style={{ padding: '2px 4px 6px' }}>
                  SFX library {lib?.builtin ? '(built-in, synthetic)' : ''} · placed automatically
                </span>
                {sfxGroups.map((g) => (
                  <div key={g.kat} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="ib" aria-label={`Play ${g.kat}`} onClick={() => g.ids[0] && void new Audio(`reel://sfx/${encodeURIComponent(g.ids[0])}.wav`).play()}>
                      ▶
                    </button>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto' }}>
                      <span style={{ fontSize: 12 }}>{g.kat}</span>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {g.ids.length} sound{g.ids.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`add-sfx-${g.kat}`}
                      disabled={!g.ids.length}
                      title="Add at the playhead"
                      onClick={() => apply(`Add ${g.kat}`, (x) => ops.addSfx(x, editedAt(time), g.ids[0], g.kat))}
                    >
                      + Add
                    </button>
                  </div>
                ))}
              </div>
            )}
            {leftTab === 'motion' && <MotionPanel doc={doc} d={d} sel={sel} apply={apply} playheadEdited={playheadEdited} onSelectMotion={(id) => select({ kind: 'motion', id })} />}
            {leftTab === 'captions' && (
              <Transcript doc={doc} d={d} sel={sel} time={time} summary={summary} onHideSummary={() => setSummary(null)} onSelect={select} onResuggest={() => apply('Re-suggest keywords', (x) => ops.resuggest(x, []))} />
            )}
          </section>
        )}

        <section aria-label="Player" style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="row" style={{ height: 36, padding: '0 12px', borderBottom: '1px solid var(--line)' }}>
            <span className="lbl">Player</span>
            <span className="mono muted" style={{ fontSize: 11 }}>
              9:16 · 1080×1920
            </span>
          </div>
          <div ref={stage} style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, minHeight: 0 }}>
            <Preview
              key={proxyRev}
              ref={player}
              src={`reel://project/assets/_proxy.mp4?v=${encodeURIComponent(proxyRev)}`}
              segs={doc.edit.segs}
              speed={speed}
              duration={opened.doc.state.duration}
              comp={d.comp}
              cues={d.cues}
              overlayRev={overlayRev}
              scenes={d.scenes}
              tail={d.tail}
              onTime={onTime}
              boxWidth={Math.max(120, box.w)}
              boxHeight={Math.max(200, box.h)}
            />
          </div>
          <div className="row" style={{ height: 40, padding: '0 12px', borderTop: '1px solid var(--line)' }}>
            <span className="mono" style={{ fontSize: 12 }} data-testid="timecode">
              <span style={{ color: 'var(--accent)' }}>{te === null ? 'cut' : fmtTime(te)}</span>
              <span className="muted"> / {fmtTime(d.finalDuration)}</span>
            </span>
            <button type="button" className="ib" aria-label={playing ? 'Pause' : 'Play'} data-testid="play" onClick={() => player.current?.toggle()}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="mono muted" style={{ fontSize: 11 }}>
              Final ≈ {d.finalDuration.toFixed(1)} s
            </span>
          </div>
        </section>

        {L.showR && (
          <div style={{ flex: `0 0 ${L.right}px`, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--line)', background: 'var(--bg2)', minHeight: 0 }}>
            <Details doc={doc} d={d} sel={sel} apply={apply} onGrade={onGrade} proxyBusy={proxyBusy} proxyError={proxyError} sfxBuiltin={!!lib?.builtin} lib={lib} onClearSel={() => setSel(null)} />
          </div>
        )}
      </div>

      <section aria-label="Timeline" style={{ height: L.tl, flex: '0 0 auto', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line)', background: 'var(--bg3)' }}>
        <div style={{ height: 38, flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px', borderBottom: '1px solid var(--line)' }}>
          <button type="button" className="tool on" aria-label="Select" title="Select">
            ↖
          </button>
          <button type="button" className="tool" aria-label="Split" title="Split at playhead (Ctrl+B)" data-testid="split" onClick={split}>
            ✂
          </button>
          <button type="button" className="tool" aria-label="Delete" title="Delete selection (Del)" data-testid="delete" disabled={!sel} onClick={deleteSelection}>
            🗑
          </button>
          <span style={{ width: 1, height: 18, background: 'var(--line2)', margin: '0 6px' }} />
          <button type="button" className="tool" aria-label="Undo" title={`Undo ${h.undoLabel ?? ''} (Ctrl+Z)`} data-testid="undo" disabled={!h.canUndo} onClick={h.undo}>
            ↶
          </button>
          <button type="button" className="tool" aria-label="Redo" title={`Redo ${h.redoLabel ?? ''} (Ctrl+Shift+Z)`} data-testid="redo" disabled={!h.canRedo} onClick={h.redo}>
            ↷
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="muted" style={{ fontSize: 11 }}>
              Zoom
            </span>
            <input type="range" min={0.3} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Timeline zoom" style={{ width: 110, accentColor: 'var(--accent)' }} />
          </div>
        </div>
        <Timeline
          duration={opened.doc.state.duration}
          segs={doc.edit.segs}
          splits={splits}
          chunks={d.chunks}
          selWords={selWords}
          sfx={d.sfxSrc}
          inserts={inserts}
          wave={wave}
          time={time}
          zoom={zoom}
          sel={sel}
          height={L.tl}
          onSeek={seek}
          onSelect={select}
          onTrim={(k, edge, t) => apply('Trim', (x) => ops.trimSeg(x, k, edge, t))}
          onSfxMove={(j, src) => {
            const m = doc.edit.sfx?.[j];
            if (!m) return;
            const f = m.id && lib ? lib.features[m.id] : undefined;
            const shift = m.align && f ? f.peak_at * f.dur : 0;
            apply('Move sound', (x) => ops.updateSfx(x, j, { t: Math.round((editedAt(src) + shift) * 1000) / 1000 }));
          }}
          motion={motionList}
          scenes={d.scenes}
          axis={axis}
          tail={d.tail}
          tailT={tailT}
          total={d.finalDuration}
          onMotionTimes={(id, t0, t1) => apply('Motion timing', (x) => ops.setMotionTimes(x, id, t0, t1))}
          onSeekEdited={(t) => player.current?.seekEdited(t)}
        />
      </section>

      {exportOpen && <ExportDialog projDir={opened.doc.dir} projName={opened.doc.state.name} finalDuration={d.finalDuration} flush={flush} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function LayoutIcon({ k }: { k: Layout }) {
  const paths: Record<Layout, ReactElement> = {
    default: <path d="M1.5 9.5h13M5.5 2v7.5M10.5 2v7.5" />,
    media: <path d="M1.5 10.5h13M8 2v8.5" />,
    timeline: <path d="M1.5 6.5h13M5.5 2v4.5M10.5 2v4.5" />,
    preview: (
      <>
        <rect x="6" y="3.5" width="4" height="7" rx="0.5" />
        <path d="M1.5 12h13" />
      </>
    ),
  };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
      {paths[k]}
    </svg>
  );
}
