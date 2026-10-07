// Settings: folder proyek, kamus koreksi Whisper (kamus nama), nama/merek prioritas kata kunci, perangkat Whisper,
// mode saran kata kunci, dan diagnostik komponen offline.
import { useEffect, useState } from 'react';
import type { Settings as S } from '../../main/settings';
import { api } from './api';

const fixToText = (fix: Record<string, string>) =>
  Object.entries(fix)
    .map(([a, b]) => `${a} => ${b}`)
    .join('\n');

export function textToFix(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of t.split('\n')) {
    const m = /^\s*(.+?)\s*(=>|→|=)\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]] = m[3];
  }
  return out;
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<S | null>(null);
  const [fixText, setFixText] = useState('');
  const [namesText, setNamesText] = useState('');
  const [diag, setDiag] = useState<string>('Checking…');

  useEffect(() => {
    void api()
      .getSettings()
      .then((x) => {
        setS(x);
        setFixText(fixToText(x.fix));
        setNamesText(x.names.join(', '));
      });
    api()
      .whisperCheck()
      .then((c) => setDiag(`Whisper ${c.faster_whisper} · CTranslate2 ${c.ctranslate2} · Python ${c.python} · ${c.cuda_devices > 0 ? `${c.cuda_devices} NVIDIA GPU` : 'no CUDA GPU (CPU mode)'}`))
      .catch((e: Error) => setDiag(`Whisper not ready: ${e.message}`));
  }, []);

  if (!s) return null;
  const save = async () => {
    await api().setSettings({
      ...s,
      fix: textToFix(fixText),
      names: namesText
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
    onClose();
  };
  const pickRoot = async () => {
    const d = await api().pickFolder();
    if (d) setS({ ...s, projectsRoot: d });
  };

  return (
    <div className="scrim">
      <div role="dialog" aria-label="Settings" className="dialog" style={{ maxWidth: 560 }}>
        <div className="row">
          <span style={{ fontSize: 16, fontWeight: 600 }}>Settings</span>
          <button type="button" className="ib" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0,1fr)', gap: '12px 14px', alignItems: 'center' }}>
          <span className="muted">Projects folder</span>
          <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
            <input className="field" value={s.projectsRoot} readOnly title={s.projectsRoot} />
            <button type="button" className="btn" onClick={pickRoot}>
              Browse…
            </button>
          </div>
          <span className="muted">Transcribe on</span>
          <div className="segs">
            {(['auto', 'cpu'] as const).map((d) => (
              <button key={d} type="button" className={`seg${s.whisperDevice === d ? ' on' : ''}`} onClick={() => setS({ ...s, whisperDevice: d })}>
                {d === 'auto' ? 'GPU if available' : 'CPU only'}
              </button>
            ))}
          </div>
          <span className="muted">Suggest keywords</span>
          <div className="segs">
            <button type="button" className="seg on">
              Rules (offline)
            </button>
            <button type="button" className="seg" disabled title="Coming in a later version">
              Local LLM
            </button>
            <button type="button" className="seg" disabled title="Coming in a later version">
              Claude
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lbl-up">Name dictionary (fix mishearings)</span>
          <span className="muted" style={{ fontSize: 11 }}>
            One per line: heard =&gt; correct. Applied to every transcript (edit.json “fix”).
          </span>
          <textarea className="field" rows={5} value={fixText} onChange={(e) => setFixText(e.target.value)} aria-label="Name dictionary" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="lbl-up">Names &amp; brands (keyword priority)</span>
          <input className="field" value={namesText} onChange={(e) => setNamesText(e.target.value)} aria-label="Names and brands" />
        </div>
        <div className="muted mono" style={{ fontSize: 11 }} data-testid="diag">
          {diag}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-pri" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
