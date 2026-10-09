// Timeline (mockup Main.dc.html): sumbu = waktu footage mentah, jadi bagian yang dipotong tetap terlihat (arsir) dan
// bisa dipulihkan. Track: Captions, Motion, Overlay (hanya bila ada gambar/video sisipan), Main (potongan + gelombang suara),
// SFX. Trim = tarik tepi klip terpilih. Motion = satu blok per item (geser badan, tarik tepi), dan ekor (end card hold)
// digambar di ujung kanan sesudah footage mentah.
import { useEffect, useRef, useState } from 'react';
import type { Seg } from '../../../core/types';
import { fmtShort } from '../api';
import type { ChunkView, SfxView } from './derived';
import { assignLanes, dragAxis, dragToTimes, editedToAxis, type Axis, type DragMode, type MotionRow } from './motionView';

export type Sel =
  | { kind: 'word'; i: number }
  | { kind: 'gap'; after: number }
  | { kind: 'clip'; a: number; b: number }
  | { kind: 'cut'; a: number; b: number }
  | { kind: 'sfx'; t: number; kat: string; manual: number }
  | { kind: 'motion'; id: string }
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
  /** motion bertanggal (detik hasil edit), urut waktu mulai */
  motion: MotionRow[];
  /** rentang adegan motion (detik hasil edit) */
  scenes: { s: number; e: number }[];
  /** pemetaan hasil edit <-> sumbu (segs, speed, durasi badan, durasi footage mentah) */
  axis: Axis;
  /** edit.tail (dtk) dan posisi playhead di dalam ekor (null = di badan video) */
  tail: number;
  tailT: number | null;
  /** durasi hasil edit termasuk ekor */
  total: number;
  /** blok motion digeser/diubah ukurannya (detik hasil edit) */
  onMotionTimes: (id: string, t0: number, t1: number) => void;
  /** klik ruler di ekor: lompat ke detik hasil edit */
  onSeekEdited: (te: number) => void;
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

const LANE_H = 20;
const LANE_GAP = 3;
/** jarak snapping (piksel layar) ke playhead, batas kata, dan tepi motion lain */
const SNAP_PX = 6;

export function Timeline(p: Props) {
  const K = 80 * p.zoom;
  const speed = p.axis.speed;
  /** panjang sumbu: footage mentah + ekor (end card hold) */
  const axisLen = p.duration + p.tail * speed;
  const width = Math.max(1, axisLen * K + 40);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ seg: number; edge: 'start' | 'end'; t: number } | null>(null);
  const list = pieces(p.segs, p.splits, p.duration);
  const { lanes, count: laneCount } = assignLanes(p.motion);
  const motionH = Math.max(30, laneCount * (LANE_H + LANE_GAP) + LANE_GAP);
  const overlayH = p.inserts.length ? 30 : 0;
  const mainH = Math.max(58, p.height - 38 - 24 - 30 - motionH - overlayH - 30 - 6);
  const tracks = [
    { l: 'Captions', h: 30 },
    { l: 'Motion', h: motionH },
    ...(overlayH ? [{ l: 'Overlay', h: overlayH }] : []),
    { l: 'Main', h: mainH },
    { l: 'SFX', h: 30 },
  ];
  const axisOf = (te: number) => editedToAxis(p.axis, te);
  /** playhead: di ekor ikut posisi ekor, selain itu waktu footage */
  const playAxis = p.tailT !== null ? p.duration + p.tailT * speed : p.time;

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
    const x = playAxis * K;
    if (x < s.scrollLeft + 20 || x > s.scrollLeft + s.clientWidth - 60) s.scrollLeft = Math.max(0, x - s.clientWidth / 3);
  }, [playAxis, K]);

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

  // ---- motion: seret badan = geser (durasi tetap), seret tepi = ubah ukuran; diterapkan saat pointer dilepas ----
  const [mdrag, setMdrag] = useState<{ id: string; a0: number; a1: number } | null>(null);
  const startMotionDrag = (e: React.PointerEvent, r: MotionRow, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    p.onSelect({ kind: 'motion', id: r.id });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const x0 = e.clientX;
    const A0 = axisOf(r.t0);
    const A1 = axisOf(r.t1);
    // titik snap: playhead, batas kata yang dipakai, tepi motion lain
    const cands = [playAxis, ...p.chunks.flatMap((c) => [c.start, c.end]), ...p.motion.filter((m) => m.id !== r.id).flatMap((m) => [axisOf(m.t0), axisOf(m.t1)])];
    let moved = false;
    let edges = { a0: A0, a1: A1 };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      edges = dragAxis(mode, A0, A1, (ev.clientX - x0) / K, cands, SNAP_PX / K);
      setMdrag({ id: r.id, ...edges });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMdrag(null);
      if (!moved) return;
      const t = dragToTimes(mode, p.axis, p.total, { t0: r.t0, t1: r.t1 }, edges);
      if (Math.abs(t.t0 - r.t0) > 0.004 || Math.abs(t.t1 - r.t1) > 0.004) p.onMotionTimes(r.id, t.t0, t.t1);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tickEvery = K >= 60 ? 1 : K >= 25 ? 2 : 5;
  const ticks: number[] = [];
  for (let s = 0; s <= axisLen; s += tickEvery) ticks.push(s);
  const isSel = (pc: Piece) => p.sel && (p.sel.kind === 'clip' || p.sel.kind === 'cut') && Math.abs(p.sel.a - pc.a) < 0.001 && Math.abs(p.sel.b - pc.b) < 0.001;

  return (
    <div style={{ flex: '1 1 auto', display: 'flex', minHeight: 0 }}>
      <div style={{ flex: '0 0 92px', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)' }}>
        <div style={{ height: 24, borderBottom: '1px solid var(--line)' }} />
        {tracks.map((t) => (
          <div key={t.l} className="thead" style={{ height: t.h, borderTop: t.l === 'SFX' ? '1px solid var(--line)' : undefined }}>
            <span>{t.l}</span>
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
            onPointerDown={(e) => {
              // klik di ekor (sesudah footage mentah) = lompat ke posisi di ekor
              const x = (e.clientX - e.currentTarget.getBoundingClientRect().left) / K;
              if (p.tail > 0 && x > p.duration) p.onSeekEdited(p.axis.body + Math.min(p.tail, (x - p.duration) / speed));
              else p.onSeek(tFromEvent(e, e.currentTarget));
            }}
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

          <div className="trk" data-track="motion" data-testid="motion-track" style={{ height: motionH }}>
            {p.scenes.map((sc, n) => {
              const a = axisOf(sc.s);
              return <span key={n} className="scene-shade" style={{ left: a * K, width: Math.max(2, (axisOf(sc.e) - a) * K) }} title="Scene: dark scrim and blurred footage" />;
            })}
            {p.motion.length === 0 && (
              <span className="muted" style={{ position: 'absolute', left: 8, top: 8, fontSize: 11 }}>
                Motion graphics (generate them in the Motion tab)
              </span>
            )}
            {p.motion.map((r) => {
              const live = mdrag && mdrag.id === r.id ? mdrag : null;
              const a0 = live ? live.a0 : axisOf(r.t0);
              const a1 = live ? live.a1 : axisOf(r.t1);
              const sel = p.sel?.kind === 'motion' && p.sel.id === r.id;
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  className={`mblk mk-${r.kind}${r.review ? ' review' : ''}${sel ? ' sel' : ''}${live ? ' drag' : ''}`}
                  style={{ left: a0 * K, width: Math.max(8, (a1 - a0) * K - 1), top: LANE_GAP + (lanes.get(r.id) ?? 0) * (LANE_H + LANE_GAP), height: LANE_H }}
                  title={`${r.name} · ${(r.t1 - r.t0).toFixed(1)} s${r.review ? ' · needs review' : ''}`}
                  data-testid="motion-block"
                  data-id={r.id}
                  data-kind={r.kind}
                  onPointerDown={(e) => startMotionDrag(e, r, 'move')}
                  onKeyDown={(e) => e.key === 'Enter' && p.onSelect({ kind: 'motion', id: r.id })}
                >
                  <span className="mh l" data-testid="motion-handle-l" onPointerDown={(e) => startMotionDrag(e, r, 'left')} />
                  <span className="mlabel">{r.name}</span>
                  <span className="mh r" data-testid="motion-handle-r" onPointerDown={(e) => startMotionDrag(e, r, 'right')} />
                </div>
              );
            })}
          </div>

          {overlayH > 0 && (
            <div className="trk" style={{ height: overlayH }}>
              {p.inserts.map((o, n) => (
                <span key={n} className="ovl" style={{ left: o.src * K, width: o.len * K }}>
                  {o.name}
                </span>
              ))}
            </div>
          )}

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

          {p.tail > 0 && (
            <div className="tailzone" data-testid="tail-region" style={{ left: p.duration * K, width: p.tail * speed * K, top: 24 }}>
              <span>End card hold · {p.tail.toFixed(1)} s</span>
            </div>
          )}

          <div style={{ position: 'absolute', top: 0, bottom: 0, left: playAxis * K, width: 2, background: '#fff', pointerEvents: 'none' }} data-testid="playhead">
            <div style={{ position: 'absolute', top: 0, left: -5, width: 12, height: 10, background: '#fff', borderRadius: 2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
