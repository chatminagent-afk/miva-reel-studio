// Kerangka awal: membuktikan jalur UI -> IPC -> pipeline. Editor penuh dibangun di langkah 3-8 (mockup docs/mockup).
import { useState } from 'react';
import type { ReelApi } from '../../preload';

declare global {
  interface Window {
    reel: ReelApi;
  }
}

export function App() {
  const [clip, setClip] = useState<{ path: string; duration: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', color: '#EDEDEF', padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>MIVA Reel Studio</h1>
      <button type="button" data-testid="import" onClick={importVideo} style={{ width: 160, height: 36, borderRadius: 8, border: 0, background: '#F2C94C', color: '#1A1400', fontWeight: 600 }}>
        Import
      </button>
      {clip && (
        <p data-testid="clip-info" style={{ margin: 0 }}>
          {clip.path} · {clip.duration.toFixed(2)} s
        </p>
      )}
      {error && <p style={{ margin: 0, color: '#FF9D9D' }}>{error}</p>}
    </main>
  );
}
