// Timeline (mockup Main.dc.html): sumbu = waktu footage mentah, jadi bagian yang dipotong tetap terlihat (arsir) dan
// bisa dipulihkan. Track: Captions, Overlay, Main (potongan + gelombang suara), SFX. Trim = tarik tepi klip terpilih.
import { useEffect, useRef, useState } from 'react';
import type { Seg } from '../../../core/types';
import { fmtShort } from '../api';
import type { ChunkView, SfxView } from './derived';

export type Sel =
  | { kind: 'word'; i: number }
  | { kind: 'gap'; after: number }
  | { kind: 'clip'; a: number; b: number }
  | { kind: 'cut'; a: number; b: number }
  | { kind: 'sfx'; t: number; kat: string; manual: number }
  | null;

interface Props {
  duration: number;
  segs: Seg[];
  splits: number[];
  chunks: ChunkView[];
  selWords: Set<number>;
  sfx: SfxView[];
  inserts: { src: number; len: number; name: string }[];
  wave: number[];
  time: number;
  zoom: number;
  sel: Sel;
  height: number;
  onSeek: (t: number) => void;
  onSelect: (s: Sel, seekTo?: number) => void;
  onTrim: (seg: number, edge: 'start' | 'end', t: number) => void;
  /** SFX manual digeser (waktu footage mentah) */
  onSfxMove: (manual: number, src: number) => void;
}

interface Piece {
  a: number;
  b: number;
  kept: boolean;
  seg: number;
}

/** Potongan main track: seg dipecah titik split, ditambah bagian yang dibuang di antaranya. */
export function pieces(segs: Seg[], splits: number[], duration: number): Piece[] {
  const out: Piece[] = [];
  let t = 0;
  segs.forEach(([a, b], k) => {
    if (a > t + 0.005) out.push({ a: t, b: a, kept: false, seg: -1 });
    const pts = [a, ...splits.filter((s) => s > a + 0.05 && s < b - 0.05).sort((x, y) => x - y), b];
    for (let i = 0; i + 1 < pts.length; i++) out.push({ a: pts[i], b: pts[i + 1], kept: true, seg: k });
    t = b;
  });
  if (duration > t + 0.005) out.push({ a: t, b: duration, kept: false, seg: -1 });
  return out;
}

const TRACK_LABELS = ['Captions', 'Overlay', 'Main', 'SFX'];

export function Timeline(p: Props) {
  const K = 80 * p.zoom;
  const width = Math.max(1, p.duration * K + 40);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ seg: number; edge: 'start' | 'end'; t: number } | null>(null);
  const list = pieces(p.segs, p.splits, p.duration);
  const mainH = Math.max(58, p.height - 38 - 24 - 30 - 30 - 30 - 6);

  // gelombang suara (canvas, sekali per zoom/data)
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const w = Math.min(32000, Math.ceil(p.duration * K));
    c.width = w;
    c.height = 18;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, 18);
    g.fillStyle = '#7FA8F0';
    const step = Math.max(1, Math.floor(100 / K)); // sampel per piksel (data per 10 ms)
    const peak = Math.max(0.05, ...p.wave.slice(0, 60000)); // normalisasi: footage pelan tetap terlihat
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / K) * 100);
      let m = 0;
      for (let j = i; j < i + step && j < p.wave.length; j++) m = Math.max(m, p.wave[j]);
      const h = Math.max(1, Math.min(18, (m / peak) * 18));
      g.fillRect(x, (18 - h) / 2, 1, h);
    }
  }, [p.wave, p.duration, K]);

  // playhead tetap terlihat saat diputar
  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const x = p.time * K;
    if (x < s.scrollLeft + 20 || x > s.scrollLeft + s.clientWidth - 60) s.scrollLeft = Math.max(0, x - s.clientWidth / 3);
  }, [p.time, K]);

  const tFromEvent = (e: { clientX: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(p.duration, (e.clientX - r.left) / K));
  };

  const startTrim = (e: React.PointerEvent, seg: number, edge: 'start' | 'end') => {
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setDrag({ seg, edge, t: tFromEvent(ev, track) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      p.onTrim(seg, edge, tFromEvent(ev, track));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const [sfxDrag, setSfxDrag] = useState<{ j: number; src: number } | null>(null);
  const startSfxDrag = (e: React.PointerEvent, j: number) => {
    const track = (e.currentTarget as HTMLElement).closest('[data-track]') as HTMLElement;
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (moved) setSfxDrag({ j, src: tFromEvent(ev, track) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSfxDrag(null);
      if (moved) p.onSfxMove(j, tFromEvent(ev, track));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tickEvery = K >= 60 ? 1 : K >= 25 ? 2 : 5;
  const ticks: number[] = [];
  for (let s = 0; s <= p.duration; s += tickEvery) ticks.push(s);
  const isSel = (pc: Piece) => p.sel && (p.sel.kind === 'clip' || p.sel.kind === 'cut') && Math.abs(p.sel.a - pc.a) < 0.001 && Math.abs(p.sel.b - pc.b) < 0.001;

  return (
    <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
      <div style={{ flex: '0 0 92px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)' }}>
        <div style={{ height: 24, borderBottom: '1px solid var(--line)' }} />
        {TRACK_LABELS.map((l) => (
          <div key={l} className="thead" style={{ height: l === 'Main' ? mainH : 30, borderTop: l === 'SFX' ? '1px solid var(--line)' : undefined }}>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <div ref={scroller} style={{ flex: '1 1 auto', overflow: 'auto', minWidth: 0 }} data-testid="timeline">
        <div style={{ position: 'relative', width, minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
          <div
            role="slider"
            aria-label="Move playhead"
            aria-valuenow={p.time}
            tabIndex={0}
            data-testid="ruler"
            onPointerDown={(e) => p.onSeek(tFromEvent(e, e.currentTarget))}
            style={{ position: 'relative', height: 24, flex: '0 0 auto', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
          >
            {ticks.map((s) => (
              <span key={s} className="tick" style={{ left: s * K }}>
                {fmtShort(s)}
              </span>
            ))}
          </div>

          <div className="trk" style={{ height: 30 }}>
            {p.chunks.map((c) => (
              <button
                key={`${c.k}-${c.raw[0]}`}
                type="button"
                className={`chunk${c.key ? ' key' : ''}${c.raw.some((i) => p.selWords.has(i)) ? ' sel' : ''}`}
                style={{ left: c.start * K, width: Math.max(18, (c.end - c.start) * K - 2) }}
                onClick={() => p.onSelect({ kind: 'word', i: c.raw[0] }, c.start)}
                title={c.text}
              >
                {c.text}
              </button>
            ))}
          </div>

          <div className="trk" style={{ height: 30 }}>
            {p.inserts.length === 0 && (
              <span className="muted" style={{ position: 'absolute', left: 8, top: 8, fontSize: 11 }}>
                B-roll and images (coming soon)
              </span>
            )}
            {p.inserts.map((o, n) => (
              <span key={n} className="ovl" style={{ left: o.src * K, width: o.len * K }}>
                {o.name}
              </span>
            ))}
          </div>

          <div className="trk" data-track="main" style={{ height: mainH, margin: '0 0 4px' }} onPointerDown={(e) => e.target === e.currentTarget && p.onSeek(tFromEvent(e, e.currentTarget))}>
            <canvas ref={canvas} style={{ position: 'absolute', left: 0, bottom: 2, height: 18, width: Math.min(32000, Math.ceil(p.duration * K)), pointerEvents: 'none', zIndex: 1, opacity: 0.85 }} />
            {list.map((pc) => {
              const d = drag && pc.kept && drag.seg === pc.seg ? drag : null;
              const a = d && d.edge === 'start' && Math.abs(p.segs[pc.seg][0] - pc.a) < 0.001 ? d.t : pc.a;
              const b = d && d.edge === 'end' && Math.abs(p.segs[pc.seg][1] - pc.b) < 0.001 ? d.t : pc.b;
              const sel = isSel(pc);
              const left = a * K + 1;
              const w = Math.max(4, (b - a) * K - 2);
              if (!pc.kept)
                return (
                  <button
                    key={`c${pc.a}`}
                    type="button"
                    className={`seg-cut${sel ? ' sel' : ''}`}
                    style={{ left, width: w }}
                    aria-label={`Removed ${fmtShort(pc.a)}`}
                    title="Removed · click to review"
                    data-testid="cut-piece"
                    onClick={() => p.onSelect({ kind: 'cut', a: pc.a, b: pc.b }, pc.a)}
                  />
                );
              return (
                <div key={`k${pc.a}`} className={`seg-clip${sel ? ' sel' : ''}`} style={{ left, width: w }} data-testid="clip-piece">
                  <button type="button" aria-label={`Clip ${fmtShort(pc.a)}`} onClick={() => p.onSelect({ kind: 'clip', a: pc.a, b: pc.b }, pc.a)} style={{ position: 'absolute', inset: 0, border: 0, background: 'transparent', cursor: 'pointer' }} />
                  {sel && Math.abs(p.segs[pc.seg][0] - pc.a) < 0.001 && <span className="handle l" onPointerDown={(e) => startTrim(e, pc.seg, 'start')} title="Drag to trim" />}
                  {sel && Math.abs(p.segs[pc.seg][1] - pc.b) < 0.001 && <span className="handle r" onPointerDown={(e) => startTrim(e, pc.seg, 'end')} title="Drag to trim" />}
                </div>
              );
            })}
          </div>

          <div className="trk" data-track="sfx" style={{ height: 30, borderTop: '1px solid var(--line)' }}>
            {p.sfx.map((x, n) => {
              const sel = p.sel?.kind === 'sfx' && p.sel.kat === x.kat && Math.abs(p.sel.t - x.t) < 0.06;
              const left = (sfxDrag && x.manual === sfxDrag.j ? sfxDrag.src : x.src) * K;
              return (
                <button
                  key={n}
                  type="button"
                  className={`sfxm${x.manual >= 0 ? ' manual' : ''}${x.muted ? ' muted' : ''}${sel ? ' sel' : ''}`}
                  style={{ left }}
                  title={`${x.id}${x.manual >= 0 ? ' · drag to move' : ' · auto'}${x.muted ? ' · muted' : ''}`}
                  data-testid="sfx-marker"
                  onPointerDown={(e) => x.manual >= 0 && startSfxDrag(e, x.manual)}
                  onClick={() => p.onSelect({ kind: 'sfx', t: x.t, kat: x.kat, manual: x.manual })}
                >
                  <span className="dot" />
                  {x.kat}
                </button>
              );
            })}
          </div>

          <div style={{ position: 'absolute', top: 0, bottom: 0, left: p.time * K, width: 2, background: '#fff', pointerEvents: 'none' }} data-testid="playhead">
            <div style={{ position: 'absolute', top: 0, left: -5, width: 12, height: 10, background: '#fff', borderRadius: 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
