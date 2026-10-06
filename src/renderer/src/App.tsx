// Kerangka awal: membuktikan jalur UI -> IPC -> pipeline. Editor penuh dibangun di langkah 3-8 (mockup docs/mockup).
// Panel export di sini sementara (uji runner render); dialog Export versi mockup dibuat di langkah 8.
import { useEffect, useState } from 'react';
import type { ExportEvent, ExportRequest } from '../../main/export';
import type { ReelApi } from '../../preload';

declare global {
  interface Window {
    reel: ReelApi;
  }
}

const btn = { height: 36, padding: '0 16px', borderRadius: 8, border: 0, background: '#F2C94C', color: '#1A1400', fontWeight: 600 } as const;
const ghost = { ...btn, background: '#2A2A30', color: '#EDEDEF' } as const;

export function App() {
  const [clip, setClip] = useState<{ path: string; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proj, setProj] = useState<string | null>(null);
  const [opts, setOpts] = useState<Pick<ExportRequest, 'resolution' | 'fps' | 'codec'>>({ resolution: '1080p', fps: 30, codec: 'h264' });
  const [job, setJob] = useState<number | null>(null);
  const [status, setStatus] = useState<{ progress: number; message: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(
    () =>
      window.reel.onExportEvent((ev: ExportEvent) => {
        if (ev.type === 'progress') setStatus({ progress: ev.progress, message: ev.message });
        else {
          setJob(null);
          if (ev.type === 'done') {
            setStatus({ progress: 1, message: 'Selesai' });
            setResult(`${ev.result.output} · ${ev.result.width}×${ev.result.height} · ${ev.result.fps} fps · ${ev.result.encoder}`);
          } else if (ev.type === 'cancelled') setStatus({ progress: 0, message: 'Dibatalkan' });
          else setError(ev.message);
        }
      }),
    [],
  );

  const importVideo = async () => {
    setError(null);
    const path = await window.reel.openVideo();
    if (!path) return;
    try {
      setClip(await window.reel.probe(path));
    } catch (e) {
      setError(String(e));
    }
  };

  const startExport = async () => {
    if (!proj) return;
    setError(null);
    setResult(null);
    const output = await window.reel.saveVideo(`${proj}/renders/reel-${opts.resolution}.mp4`);
    if (!output) return;
    try {
      setStatus({ progress: 0, message: 'Memulai' });
      setJob(await window.reel.exportStart({ projDir: proj, output, ...opts, openFolder: true }));
    } catch (e) {
      setStatus(null);
      setError(String(e));
    }
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', color: '#EDEDEF', padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>MIVA Reel Studio</h1>
      <button type="button" data-testid="import" onClick={importVideo} style={{ ...btn, width: 160 }}>
        Import
      </button>
      {clip && (
        <p data-testid="clip-info" style={{ margin: 0 }}>
          {clip.path} · {clip.duration.toFixed(2)} s
        </p>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640, paddingTop: 16, borderTop: '1px solid #2A2A30' }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Export (test)</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" style={ghost} onClick={async () => setProj(await window.reel.pickFolder())}>
            Project folder…
          </button>
          <span style={{ fontSize: 13, opacity: 0.7 }}>{proj ?? 'No project'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={opts.resolution} onChange={(e) => setOpts({ ...opts, resolution: e.target.value as ExportRequest['resolution'] })}>
            <option value="1080p">1080p</option>
            <option value="2k">2K</option>
            <option value="4k">4K</option>
          </select>
          <select value={opts.fps} onChange={(e) => setOpts({ ...opts, fps: Number(e.target.value) as 30 | 60 })}>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
          <select value={opts.codec} onChange={(e) => setOpts({ ...opts, codec: e.target.value as ExportRequest['codec'] })}>
            <option value="h264">H.264</option>
            <option value="hevc">HEVC</option>
          </select>
          {job === null ? (
            <button type="button" data-testid="export" style={btn} disabled={!proj} onClick={startExport}>
              Export
            </button>
          ) : (
            <button type="button" data-testid="export-cancel" style={ghost} onClick={() => window.reel.exportCancel()}>
              Cancel
            </button>
          )}
        </div>
        {status && (
          <div data-testid="export-status" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ height: 6, borderRadius: 3, background: '#2A2A30', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(status.progress * 100)}%`, height: '100%', background: '#F2C94C' }} />
            </div>
            <span style={{ fontSize: 13 }}>
              {Math.round(status.progress * 100)}% · {status.message}
            </span>
          </div>
        )}
        {result && (
          <p data-testid="export-result" style={{ margin: 0, fontSize: 13 }}>
            {result}
          </p>
        )}
      </section>
      {error && <p style={{ margin: 0, color: '#FF9D9D' }}>{error}</p>}
    </main>
  );
}
