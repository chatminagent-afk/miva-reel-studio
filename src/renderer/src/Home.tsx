// Layar Import + Auto Edit (mockup Import.dc.html): proyek terakhir, drop footage, pilihan, progress 5 langkah.
import { useEffect, useRef, useState } from 'react';
import type { AutoEditEvent, AutoEditRequest } from '../../main/projects';
import type { RecentProject } from '../../main/settings';
import { api, friendlyError } from './api';

const STEPS = [
  { label: 'Make preview proxy (540p)' },
  { label: 'Transcribe speech (Whisper, on this PC)' },
  { label: 'Find silences and retakes' },
  { label: 'Suggest keywords', note: 'Rules, offline. Nothing leaves this PC.' },
  { label: 'Build captions, camera moves and SFX' },
];

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv)$/i;

interface Props {
  onOpen: (dir: string, summary?: Extract<AutoEditEvent, { type: 'done' }>['summary']) => void;
  onSettings: () => void;
}

export function Home({ onOpen, onSettings }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [opts, setOpts] = useState<Omit<AutoEditRequest, 'src'>>({ autoEdit: true, speed: true, grade: 'natural' });
  const [busy, setBusy] = useState<{ src: string; step: number; progress: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const jobRef = useRef<number | null>(null);

  useEffect(() => {
    void api().recentProjects().then(setRecent);
    void api().getSettings().then((s) => setOpts(s.importDefaults));
    return api().onAutoEditEvent((ev) => {
      if (jobRef.current !== null && ev.id !== jobRef.current) return;
      if (ev.type === 'progress') setBusy((b) => (b ? { ...b, step: ev.step, progress: ev.progress, message: ev.message } : b));
      else {
        jobRef.current = null;
        setBusy(null);
        if (ev.type === 'done') onOpen(ev.dir, ev.summary);
        else if (ev.type === 'error') setError(friendlyError(ev.message, ev.code) + (ev.code ? '' : ''));
      }
    });
  }, [onOpen]);

  const start = async (src: string) => {
    if (!VIDEO_EXT.test(src)) {
      setError('Pick an MP4 or MOV video.');
      return;
    }
    setError(null);
    setBusy({ src, step: 1, progress: 0, message: 'Starting' });
    try {
      jobRef.current = await api().autoEditStart({ src, ...opts });
    } catch (e) {
      setBusy(null);
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const choose = async () => {
    const p = await api().openVideo();
    if (p) void start(p);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void start(api().pathForFile(f));
  };

  const name = busy ? busy.src.split(/[\\/]/).pop() : '';

  return (
    <div className="home">
      <header>
        <div className="logo" style={{ width: 28, height: 28, borderRadius: 7, fontSize: 14 }}>
          M
        </div>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Reel Studio</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-lg" onClick={onSettings}>
            Settings
          </button>
        </div>
      </header>
      <div className="body">
        <aside className="panel" aria-label="Recent projects" style={{ flex: '1 1 280px', maxWidth: 360, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lbl-up" style={{ padding: '0 10px 6px' }}>
            Recent
          </span>
          {recent.length === 0 && (
            <span className="muted" style={{ padding: '0 10px', fontSize: 12 }}>
              No projects yet.
            </span>
          )}
          {recent.map((p) => (
            <button key={p.dir} type="button" className="proj" data-testid="recent" onClick={() => onOpen(p.dir)} title={p.dir}>
              <div className="th" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span className="muted" style={{ fontSize: 11 }}>
                  opened {new Date(p.opened).toLocaleString()}
                </span>
              </div>
            </button>
          ))}
        </aside>

        <main style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
          {!busy && (
            <section className="panel" aria-label="Import" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div
                className={`drop${over ? ' over' : ''}`}
                data-testid="drop"
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A0A3AB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 15V3M7 8l5-5 5 5" />
                  <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
                </svg>
                <span style={{ fontSize: 18, fontWeight: 600 }}>Drop raw footage</span>
                <span className="muted">MP4 or MOV from your phone, 9:16 talking head</span>
                <button type="button" className="btn btn-lg btn-pri" style={{ marginTop: 6 }} data-testid="choose" onClick={choose}>
                  Choose file
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <span className="lbl-up">After import</span>
                <div className="row">
                  <span>Run Auto Edit (cut silences, flag retakes, captions, keywords, SFX)</span>
                  <button type="button" className={`sw${opts.autoEdit ? ' on' : ''}`} aria-label="Run Auto Edit" aria-pressed={opts.autoEdit} onClick={() => setOpts({ ...opts, autoEdit: !opts.autoEdit })}>
                    <span className="knob" />
                  </button>
                </div>
                <div className="row">
                  <span>Speed up 1.25×</span>
                  <button type="button" className={`sw${opts.speed ? ' on' : ''}`} aria-label="Speed up" aria-pressed={opts.speed} onClick={() => setOpts({ ...opts, speed: !opts.speed })}>
                    <span className="knob" />
                  </button>
                </div>
                <div className="row">
                  <span>Grade</span>
                  <div className="segs">
                    {(['natural', 'warm', 'lift'] as const).map((g) => (
                      <button key={g} type="button" className={`seg${opts.grade === g ? ' on' : ''}`} onClick={() => setOpts({ ...opts, grade: g })}>
                        {g[0].toUpperCase() + g.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {error && (
                <div className="err" data-testid="import-error">
                  {error}
                </div>
              )}
            </section>
          )}

          {busy && (
            <section className="panel" aria-label="Auto Edit progress" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="row">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>Auto Edit</span>
                  <span className="muted mono" style={{ fontSize: 12 }}>
                    {name}
                  </span>
                </div>
                <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>
                  Step {busy.step} of 5
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-testid="steps">
                {STEPS.map((s, i) => {
                  const n = i + 1;
                  const state = n < busy.step ? 'done' : n === busy.step ? 'run' : 'wait';
                  return (
                    <div className="step" key={s.label}>
                      <span className={`ic ic-${state}`}>{state === 'done' ? '✓' : n}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 auto' }}>
                        <span className={state === 'wait' ? 'muted' : ''}>{s.label}</span>
                        {state === 'run' && (
                          <>
                            <div className="bar">
                              <div style={{ width: `${Math.round(busy.progress * 100)}%` }} />
                            </div>
                            <span className="muted mono" style={{ fontSize: 11 }}>
                              {Math.round(busy.progress * 100)}% · {busy.message}
                            </span>
                          </>
                        )}
                        {state === 'done' && <span style={{ fontSize: 12, color: 'var(--ok)' }}>Done</span>}
                        {s.note && state !== 'done' && (
                          <span className="muted" style={{ fontSize: 11 }}>
                            {s.note}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-lg" data-testid="autoedit-cancel" onClick={() => void api().autoEditCancel()}>
                  Cancel
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
