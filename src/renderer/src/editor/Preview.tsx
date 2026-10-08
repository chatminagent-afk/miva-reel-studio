// Player preview: proxy footage (potongan dilompati, kecepatan lewat playbackRate), kamera dengan matematika yang sama
// dengan export (camera.ts), lapisan overlay = komposisi HTML yang sama dengan render, SFX dijadwalkan WebAudio.
//
// Tail (`edit.tail`): sesudah potongan terakhir footage DIBEKUKAN di frame terakhir dan suara diam, sementara timeline overlay
// (end card) terus berjalan sampai durasi + tail. Posisi di ekor = `tailRef` (detik sejak akhir kata/potongan terakhir),
// dijalankan jam sendiri (performance.now) karena video sudah berhenti. Blur adegan motion: CSS blur pada <video>, rampa
// 0,3 dtk, sama dengan blur FFmpeg di export (sceneBlurAt).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { cameraAt, parseOrigin } from '../../../core/camera';
import type { CompositionData } from '../../../core/compose';
import { editedToSrc, keptDuration, srcToEdited } from '../../../core/edit';
import { PEAK } from '../../../core/levels';
import { SCENE_BLUR_PX, sceneBlurAt, type SceneRange } from '../../../core/motionDoc';
import type { CuesJson, Seg } from '../../../core/types';

export interface PlayerHandle {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** lompat ke waktu footage mentah; `tailT` = detik di dalam ekor (freeze akhir), hanya bila edit.tail > 0 */
  seek: (src: number, tailT?: number) => void;
  /** lompat ke detik hasil edit (termasuk ekor) */
  seekEdited: (te: number) => void;
}

interface Props {
  /** URL proxy berversi (reel://project/assets/_proxy.mp4?v=...), lihat proxyRev() di main/projects.ts */
  src: string;
  segs: Seg[];
  speed: number;
  duration: number;
  comp: CompositionData;
  cues: CuesJson | null;
  /** versi komposisi overlay (naik setiap HTML preview diganti) */
  overlayRev: number;
  /** rentang adegan motion (detik hasil edit): footage di-blur di dalamnya */
  scenes: SceneRange[];
  /** edit.tail (dtk): freeze frame terakhir sesudah potongan terakhir */
  tail: number;
  /** `tailT` terisi (detik sejak akhir potongan terakhir) kalau posisi ada di ekor; `src` tetap di akhir potongan terakhir */
  onTime: (src: number, playing: boolean, tailT?: number) => void;
  boxWidth: number;
  boxHeight: number;
}

const W = 1080;
const H = 1920;

function segAt(segs: Seg[], t: number): number {
  return segs.findIndex(([a, b]) => t >= a - 0.001 && t < b - 0.001);
}

export const Preview = forwardRef<PlayerHandle, Props>(function Preview(p, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const cam = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [playing, setPlaying] = useState(false);
  const [inCut, setInCut] = useState(false);
  const live = useRef(p);
  live.current = p;
  const raf = useRef(0);
  const playingRef = useRef(false);
  /** detik di dalam ekor (null = di badan video) */
  const tailRef = useRef<number | null>(null);
  const tailClock = useRef(0);
  const lastEmit = useRef(0);
  const audio = useRef<{ ctx: AudioContext; buffers: Map<string, { buf: AudioBuffer; peak: number }>; nodes: AudioBufferSourceNode[] } | null>(null);

  /** durasi hasil edit tanpa ekor */
  const bodyOf = () => keptDuration(live.current.segs) / live.current.speed;
  /** frame yang ditahan di ekor: sedikit sebelum akhir potongan terakhir */
  const holdAt = () => {
    const last = live.current.segs[live.current.segs.length - 1];
    return last ? Math.max(last[0], last[1] - 0.04) : 0;
  };

  const editedNow = (src: number) => {
    const { segs, speed } = live.current;
    if (tailRef.current !== null) return { te: bodyOf() + tailRef.current, cut: false };
    const te = srcToEdited(segs, speed, src);
    if (te !== null) return { te, cut: false };
    // di bagian yang dipotong: tampilkan keadaan di awal potongan berikutnya
    const next = segs.find(([a]) => a > src);
    return { te: next ? srcToEdited(segs, speed, next[0])! : bodyOf(), cut: true };
  };

  const render = useCallback((src: number) => {
    const { te, cut } = editedNow(src);
    const { comp } = live.current;
    const { ox, oy } = parseOrigin(comp.origin);
    const c = cameraAt(comp.camera, te);
    if (cam.current) {
      cam.current.style.transformOrigin = `${ox}px ${oy}px`;
      cam.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s})`;
    }
    if (video.current) {
      const a = sceneBlurAt(live.current.scenes, te);
      video.current.style.filter = a > 0.001 ? `blur(${(SCENE_BLUR_PX * a).toFixed(2)}px)` : '';
    }
    frame.current?.contentWindow?.postMessage({ t: te }, '*');
    setInCut(cut);
    return te;
  }, []);

  // ---------- SFX ----------
  const stopSfx = () => {
    audio.current?.nodes.forEach((n) => {
      try {
        n.stop();
      } catch {
        /* sudah selesai */
      }
    });
    if (audio.current) audio.current.nodes = [];
  };

  const loadBuf = async (id: string) => {
    const a = audio.current!;
    const hit = a.buffers.get(id);
    if (hit) return hit;
    const data = await (await fetch(`reel://sfx/${encodeURIComponent(id)}.wav`)).arrayBuffer();
    const buf = await a.ctx.decodeAudioData(data);
    let peak = 1e-9;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) for (const v of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(v));
    const entry = { buf, peak };
    a.buffers.set(id, entry);
    return entry;
  };

  const scheduleSfx = (te: number) => {
    const cues = live.current.cues;
    if (!cues) return;
    if (!audio.current) audio.current = { ctx: new AudioContext(), buffers: new Map(), nodes: [] };
    const a = audio.current;
    stopSfx();
    const t0 = a.ctx.currentTime + 0.03;
    for (const c of cues.sfx) {
      void loadBuf(c.id).then(({ buf, peak }) => {
        if (!live.current || !playingRef.current) return;
        const delay = c.t - te;
        const offset = Math.max(0, -delay);
        if (offset >= buf.duration || (c.dur && offset >= c.dur)) return;
        const src = a.ctx.createBufferSource();
        src.buffer = buf;
        const g = a.ctx.createGain();
        g.gain.value = (10 ** (((PEAK[c.kat] ?? -20) + (c.gain_db ?? 0)) / 20) / peak) * 0.9;
        src.connect(g).connect(a.ctx.destination);
        const when = t0 + Math.max(0, delay);
        src.start(when, offset, c.dur ? c.dur - offset : undefined);
        a.nodes.push(src);
      });
    }
  };

  // ---------- transport ----------
  /** masuk ekor: footage berhenti di frame terakhir, jam ekor mulai dari 0 */
  const enterTail = (v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = holdAt();
    tailRef.current = 0;
    tailClock.current = performance.now();
  };

  const tick = () => {
    const v = video.current;
    if (!v || !playingRef.current) return;
    const { segs, tail } = live.current;
    if (tailRef.current !== null) {
      const tt = Math.min(tail, (performance.now() - tailClock.current) / 1000);
      tailRef.current = tt;
      render(v.currentTime);
      live.current.onTime(v.currentTime, true, tt);
      if (tt >= tail) {
        pause();
        return;
      }
      raf.current = requestAnimationFrame(tick);
      return;
    }
    let t = v.currentTime;
    const k = segAt(segs, t);
    const cur = k >= 0 ? segs[k] : null;
    if (!cur || t >= cur[1] - 0.02) {
      const next = segs.find(([a]) => a > t + 0.01);
      if (!next) {
        if (tail > 0) {
          enterTail(v);
          raf.current = requestAnimationFrame(tick);
          return;
        }
        pause();
        return;
      }
      v.currentTime = next[0];
      t = next[0];
      scheduleSfx(editedNow(t).te); // lompatan potongan: jadwalkan ulang supaya SFX tetap sinkron
    }
    render(t);
    const now = performance.now();
    if (now - lastEmit.current > 50) {
      lastEmit.current = now;
      live.current.onTime(t, true);
    }
    raf.current = requestAnimationFrame(tick);
  };

  const play = () => {
    const v = video.current;
    if (!v || playingRef.current) return;
    const { segs, speed, tail } = live.current;
    if (!segs.length) return;
    if (tailRef.current !== null) {
      if (tailRef.current < tail - 0.02) {
        // lanjutkan ekor dari posisi terakhir
        tailClock.current = performance.now() - tailRef.current * 1000;
        playingRef.current = true;
        setPlaying(true);
        void audio.current?.ctx.resume();
        scheduleSfx(bodyOf() + tailRef.current);
        raf.current = requestAnimationFrame(tick);
        return;
      }
      tailRef.current = null; // ekor sudah habis: mulai dari awal
      v.currentTime = segs[0][0];
    }
    let t = v.currentTime;
    if (segAt(segs, t) < 0) {
      const next = segs.find(([a]) => a > t) ?? segs[0];
      t = next[0];
      v.currentTime = t;
    }
    if (t >= segs[segs.length - 1][1] - 0.05) {
      if (tail > 0) {
        // tepat di akhir badan video: putar ekornya
        enterTail(v);
        playingRef.current = true;
        setPlaying(true);
        void audio.current?.ctx.resume();
        scheduleSfx(bodyOf());
        raf.current = requestAnimationFrame(tick);
        return;
      }
      t = segs[0][0];
      v.currentTime = t;
    }
    v.playbackRate = speed;
    playingRef.current = true;
    setPlaying(true);
    void v.play();
    void audio.current?.ctx.resume();
    scheduleSfx(editedNow(t).te);
    raf.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(raf.current);
    video.current?.pause();
    stopSfx();
    if (video.current) live.current.onTime(video.current.currentTime, false, tailRef.current ?? undefined);
  };

  const seek = (src: number, tailT?: number) => {
    const v = video.current;
    if (!v) return;
    const { tail, segs } = live.current;
    let t = Math.max(0, Math.min(live.current.duration, src));
    if (tailT !== undefined && tail > 0 && segs.length) {
      // di ekor: video berhenti di frame terakhir, jam ekor di posisi yang diminta
      tailRef.current = Math.max(0, Math.min(tail, tailT));
      tailClock.current = performance.now() - tailRef.current * 1000;
      t = holdAt();
      v.currentTime = t;
      v.pause();
    } else {
      tailRef.current = null;
      v.currentTime = t;
      if (playingRef.current) void v.play();
    }
    render(t);
    if (playingRef.current) scheduleSfx(editedNow(t).te);
    live.current.onTime(t, playingRef.current, tailRef.current ?? undefined);
  };

  const seekEdited = (te: number) => {
    const { segs, speed, tail } = live.current;
    if (!segs.length) return;
    const body = bodyOf();
    if (tail > 0 && te > body) seek(holdAt(), te - body);
    else seek(editedToSrc(segs, speed, Math.max(0, te)).src);
  };

  useImperativeHandle(ref, () => ({ play, pause, toggle: () => (playingRef.current ? pause() : play()), seek, seekEdited }));

  // overlay baru dimuat: kirim waktu sekarang
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.previewReady && video.current) render(video.current.currentTime);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [render]);

  // dokumen berubah saat pause: gambar ulang di posisi yang sama
  useEffect(() => {
    if (tailRef.current !== null) {
      // ekor berubah/hilang atau potongan terakhir bergeser: rapikan posisi dan tahan frame terakhir yang baru
      if (p.tail <= 0) tailRef.current = null;
      else {
        tailRef.current = Math.min(tailRef.current, p.tail);
        if (video.current && !playingRef.current) video.current.currentTime = holdAt();
      }
    }
    if (!playingRef.current && video.current) render(video.current.currentTime);
  }, [p.segs, p.speed, p.comp, p.scenes, p.tail, render]);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    stopSfx();
    void audio.current?.ctx.close();
  }, []);

  const k = Math.min(p.boxWidth / W, p.boxHeight / H);
  return (
    <div style={{ position: 'relative', width: W * k, height: H * k, borderRadius: 6, overflow: 'hidden', background: '#000' }} data-testid="preview">
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${k})`, transformOrigin: '0 0' }}>
        <div ref={cam} style={{ position: 'absolute', inset: 0, width: W, height: H }}>
          <video
            ref={video}
            src={p.src}
            preload="auto"
            playsInline
            data-testid="preview-video"
            onLoadedData={() => {
              // mulai di awal bagian pertama yang dipakai (bukan di hening awal yang dipotong)
              const v = video.current;
              if (!v) return;
              const first = live.current.segs[0];
              if (first && v.currentTime < first[0]) v.currentTime = first[0];
              render(v.currentTime);
              live.current.onTime(v.currentTime, false);
            }}
            style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'cover' }}
          />
        </div>
        <iframe
          key={p.overlayRev}
          ref={frame}
          title="overlay"
          src={`reel://preview/overlay.html?v=${p.overlayRev}`}
          sandbox="allow-scripts"
          style={{ position: 'absolute', inset: 0, width: W, height: H, border: 0, background: 'transparent', pointerEvents: 'none' }}
        />
      </div>
      {inCut && !playing && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(14,14,16,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bad)', fontSize: 12, fontWeight: 600 }}>
          Cut · not in export
        </div>
      )}
    </div>
  );
});

