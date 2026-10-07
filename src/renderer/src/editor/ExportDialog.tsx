// Dialog Export (mockup Main.dc.html): nama file, folder (Browse + jadikan default), resolusi, fps, codec, kualitas,
// cover JPG, salinan WhatsApp, buka folder. Progress + Cancel di dialog yang sama.
import { useEffect, useState } from 'react';
import type { ExportEvent, ExportRequest } from '../../../main/export';
import type { Settings } from '../../../main/settings';
import { api } from '../api';

interface Props {
  projDir: string;
  projName: string;
  finalDuration: number;
  /** simpan dokumen sebelum export (file proyek harus terbaru) */
  flush: () => Promise<void>;
  onClose: () => void;
}

const RES = { '1080p': '1080×1920', '2k': '1440×2560', '4k': '2160×3840' } as const;
const MBPS = { '1080p': [12, 20], '2k': [20, 32], '4k': [40, 60] } as const;

export function ExportDialog({ projDir, projName, finalDuration, flush, onClose }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [name, setName] = useState(projName.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
  const [dir, setDir] = useState('');
  const [o, setO] = useState<Settings['exportDefaults'] | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [coverTitle, setCoverTitle] = useState('');
  const [run, setRun] = useState<{ progress: number; message: string } | null>(null);
  const [done, setDone] = useState<Extract<ExportEvent, { type: 'done' }>['result'] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api()
      .getSettings()
      .then((x) => {
        setS(x);
        setO(x.exportDefaults);
        setDir(x.exportDir);
      });
    void api()
      .exportDefaultCover(projDir)
      .then((c) => setCoverTitle(c.title))
      .catch(() => undefined);
    return api().onExportEvent((ev) => {
      if (ev.type === 'progress') setRun({ progress: ev.progress, message: ev.message });
      else {
        setRun(null);
        if (ev.type === 'done') setDone(ev.result);
        else if (ev.type === 'error') setError(ev.message);
      }
    });
  }, [projDir]);

  if (!s || !o) return null;
  const set = (patch: Partial<Settings['exportDefaults']>) => setO({ ...o, ...patch });
  const mbps = MBPS[o.resolution][o.quality === 'higher' ? 1 : 0] * (o.fps === 60 ? 1.5 : 1) * (o.codec === 'hevc' ? 0.6 : 1);
  const sizeMb = (mbps * finalDuration) / 8;
  const safeName = name.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'reel';
  const sep = dir.includes('\\') ? '\\' : '/';
  const output = `${dir.replace(/[\\/]+$/, '')}${sep}${safeName}.mp4`;

  const start = async () => {
    setError(null);
    setDone(null);
    await flush();
    await api().setSettings({ exportDefaults: o });
    const req: ExportRequest = {
      projDir,
      output,
      resolution: o.resolution,
      fps: o.fps,
      codec: o.codec,
      quality: o.quality,
      cover: o.cover ? { title: coverTitle } : null,
      waCopy: o.waCopy,
      openFolder: o.openFolder,
      setDefaultDir: makeDefault,
    };
    try {
      setRun({ progress: 0, message: 'Starting' });
      await api().exportStart(req);
    } catch (e) {
      setRun(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const seg = <T extends string | number>(value: T, opts: { v: T; l: string }[], pick: (v: T) => void, label: string) => (
    <div className="segs" aria-label={label}>
      {opts.map((x) => (
        <button key={String(x.v)} type="button" className={`seg${x.v === value ? ' on' : ''}`} onClick={() => pick(x.v)}>
          {x.l}
        </button>
      ))}
    </div>
  );
  const sw = (on: boolean, toggle: () => void, label: string) => (
    <button type="button" className={`sw${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} onClick={toggle}>
      <span className="knob" />
    </button>
  );

  return (
    <div className="scrim">
      <div role="dialog" aria-label="Export" className="dialog">
        <div className="row">
          <span style={{ fontSize: 16, fontWeight: 600 }}>Export</span>
          <button type="button" className="ib" aria-label="Close" onClick={onClose} disabled={!!run}>
            ✕
          </button>
        </div>
        {!run && !done && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', gap: '12px 14px', alignItems: 'center' }}>
              <span className="muted">File name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" />
              <span className="muted">Save to</span>
              <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
                <input className="field" value={dir} readOnly title={dir} aria-label="Export folder" />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const d = await api().pickFolder();
                    if (d) setDir(d);
                  }}
                >
                  Browse…
                </button>
              </div>
              <span className="muted">Resolution</span>
              {seg(o.resolution, [{ v: '1080p', l: '1080p' }, { v: '2k', l: '2K' }, { v: '4k', l: '4K' }], (v) => set({ resolution: v }), 'Resolution')}
              <span className="muted">Frame rate</span>
              {seg(o.fps, [{ v: 30, l: '30 fps' }, { v: 60, l: '60 fps' }], (v) => set({ fps: v }), 'Frame rate')}
              <span className="muted">Codec</span>
              {seg(o.codec, [{ v: 'h264', l: 'H.264' }, { v: 'hevc', l: 'HEVC' }], (v) => set({ codec: v }), 'Codec')}
              <span className="muted">Quality</span>
              {seg(o.quality, [{ v: 'recommended', l: 'Recommended' }, { v: 'higher', l: 'Higher' }], (v) => set({ quality: v }), 'Quality')}
            </div>
            {o.resolution !== '1080p' && (
              <span style={{ fontSize: 12, color: 'var(--accent)' }}>
                Source is 1080×1920, so {o.resolution.toUpperCase()} is upscaled. Text and graphics are rendered sharp; the footage adds no real detail.
              </span>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid #26262B', paddingTop: 14 }}>
              <div className="row">
                <span>Cover JPG</span>
                {sw(o.cover, () => set({ cover: !o.cover }), 'Cover JPG')}
              </div>
              {o.cover && (
                <input className="field" value={coverTitle} onChange={(e) => setCoverTitle(e.target.value)} aria-label="Cover title" title="Lines split by |, *BIG* = gold keyword line" placeholder="small line|*BIG*|small line" />
              )}
              <div className="row">
                <span>WhatsApp copy (smaller file)</span>
                {sw(o.waCopy, () => set({ waCopy: !o.waCopy }), 'WhatsApp copy')}
              </div>
              <div className="row">
                <span>Open folder when done</span>
                {sw(o.openFolder, () => set({ openFolder: !o.openFolder }), 'Open folder when done')}
              </div>
              <div className="row">
                <span>Use this folder as default</span>
                {sw(makeDefault, () => setMakeDefault(!makeDefault), 'Use as default folder')}
              </div>
            </div>
            {error && (
              <div className="err" data-testid="export-error">
                {error}
              </div>
            )}
            <div className="row" style={{ borderTop: '1px solid #26262B', paddingTop: 14 }}>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {RES[o.resolution]} · {o.fps} fps · {o.codec === 'h264' ? 'H.264' : 'HEVC'} · ≈{sizeMb < 1 ? '<1' : Math.round(sizeMb)} MB · {finalDuration.toFixed(1)} s
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button type="button" className="btn btn-pri" data-testid="export-start" disabled={!dir} onClick={start}>
                  Export
                </button>
              </div>
            </div>
          </>
        )}
        {run && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="export-progress">
            <div className="bar">
              <div style={{ width: `${Math.round(run.progress * 100)}%` }} />
            </div>
            <div className="row">
              <span className="mono muted" style={{ fontSize: 11 }}>
                {Math.round(run.progress * 100)}% · {run.message}
              </span>
              <button type="button" className="btn" data-testid="export-cancel" onClick={() => void api().exportCancel()}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {done && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="export-done">
            <span style={{ color: 'var(--ok)', fontWeight: 600 }}>Done</span>
            <span className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
              {done.output}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {done.width}×{done.height} · {done.fps} fps · {done.encoder} · {Math.round((done.timings.overlay + done.timings.mix + done.timings.composite) / 1000)} s
              {done.cover ? ' · cover' : ''}
              {done.waCopy ? ' · WhatsApp copy' : ''}
            </span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-pri" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
