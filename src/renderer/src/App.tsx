// Navigasi app: Home (Import + proyek terakhir) <-> Editor. Settings sebagai dialog.
import { useCallback, useState } from 'react';
import type { AutoEditEvent, OpenedProject } from '../../main/projects';
import { api } from './api';
import { Editor } from './editor/Editor';
import { Home } from './Home';
import { SettingsDialog } from './Settings';

type Summary = Extract<AutoEditEvent, { type: 'done' }>['summary'];

export function App() {
  const [opened, setOpened] = useState<{ p: OpenedProject; summary: Summary | null } | null>(null);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (dir: string, summary?: Summary) => {
    setError(null);
    try {
      setOpened({ p: await api().openProject(dir), summary: summary ?? null });
    } catch (e) {
      setError(`Could not open project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  return (
    <>
      {opened ? (
        <Editor key={opened.p.doc.dir} opened={opened.p} summary={opened.summary} onHome={() => setOpened(null)} />
      ) : (
        <Home onOpen={open} onSettings={() => setSettings(true)} />
      )}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
      {error && (
        <div className="err" style={{ position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 60 }} onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </>
  );
}
