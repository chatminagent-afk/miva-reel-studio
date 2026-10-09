// Jendela chat ala WhatsApp (gaya #wwin miva-3, #hwin miva-2/5): header (tile logo + nama + status), bubble customer abu,
// balasan bot hijau (titik mengetik lalu diketik per huruf), balasan admin biru, chip status di dasar jendela, dan "clear"
// untuk mengganti kasus. Cocok sebagai adegan (scrim + footage blur). Satu langkah = satu beat.
import type { ChatProps, ChatStep, MotionComponent, ResolvedMotion, MotionSfx } from '../types';
import { cue, esc, exitAt, EXIT_DUR, js, r3, toneClass, toneOf, typedHtml, uid } from '../runtime';
import { chipIcon } from '../icons';
import { logoMark } from '../logo';

const CSS = `/* chat */
.mv-chat { position: absolute; left: 110px; right: 110px; top: 215px; height: 830px; border-radius: 40px; overflow: hidden; opacity: 0;
           background: #0f1918; border: 1.5px solid rgba(255, 255, 255, 0.10); box-shadow: 0 40px 90px rgba(0, 0, 0, 0.45); }
.mv-chat-hd { height: 112px; display: flex; align-items: center; gap: 20px; padding: 0 30px; background: #172321; border-bottom: 1px solid rgba(255, 255, 255, 0.07); }
.mv-chat-hd .mv-tile { width: 68px; height: 68px; border-radius: 20px; }
.mv-chat-hd .mv-tile .mv-mk { width: 54px; }
.mv-chat-hd .mv-ava { background: var(--mv-s2); color: var(--mv-mint); font-size: 34px; font-weight: 800; }
.mv-chat-hd b { display: block; font-size: 34px; font-weight: 800; }
.mv-chat-hd small { display: flex; align-items: center; gap: 8px; font-size: 23px; color: var(--mv-mint); font-weight: 600; }
.mv-chat-hd small i { width: 11px; height: 11px; border-radius: 50%; background: #3ddc84; }
.mv-chat-th { position: absolute; left: 30px; right: 30px; top: 150px; display: flex; flex-direction: column; gap: 24px; }
.mv-sm { max-width: 88%; padding: 18px 26px; border-radius: 28px; font-size: 40px; font-weight: 600; line-height: 1.25; opacity: 0; }
.mv-sm.cus { align-self: flex-start; background: #2a3533; color: var(--mv-ink); border-bottom-left-radius: 8px; }
.mv-sm.bot { align-self: flex-end; background: var(--mv-bot); color: #fff; border-bottom-right-radius: 8px; }
.mv-sm.hum { align-self: flex-end; background: #25406b; color: #fff; border-bottom-right-radius: 8px; }
.mv-who { display: block; font-size: 20px; font-weight: 900; letter-spacing: 2px; color: var(--mv-amber); margin-bottom: 2px; }
.mv-dots { align-self: flex-end; display: flex; gap: 9px; padding: 22px 26px; border-radius: 26px; background: var(--mv-bot); opacity: 0; }
.mv-dots.hum { background: #25406b; }
.mv-dots b { width: 13px; height: 13px; border-radius: 50%; background: #d8efe7; opacity: 0.55; }
.mv-chat-cp { position: absolute; left: 30px; right: 30px; bottom: 44px; display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; }
.mv-chat-cp .mv-chip { height: 72px; }
.mv-chat-cp .mv-chip.big { height: 92px; padding: 0 36px; font-size: 38px; letter-spacing: 2px; background: rgba(var(--rgb), 0.22); border-color: var(--c); }
.mv-chat-cp .mv-chip.big .mv-i { width: 40px; height: 40px; }
`;

const CPS = 60;
const DOTS = 0.5;

interface Thread {
  bubbles: string[];
  chips: string[];
}

/** Perkiraan lamanya langkah (detik) untuk pembagian waktu bawaan. */
function weight(s: ChatStep): number {
  const len = Array.from(s.text ?? '').length;
  if (s.from === 'cus') return 0.95;
  if (s.from === 'bot' || s.from === 'human') return DOTS + len / CPS + 0.55;
  if (s.from === 'chip') return 0.6;
  return 0.5; // clear
}

function build(item: ResolvedMotion<'chat'>) {
  const p = item.props;
  const P = 'mv-' + uid(item.id);
  const t0 = item.t0;
  const tOut = exitAt(item);
  const steps: ChatStep[] = p.steps ?? [];

  // ---- waktu tiap langkah: beatTimes bila ada, kalau tidak berurutan menurut perkiraan lama (dipadatkan bila kepanjangan) ----
  const given = (item.beatTimes ?? []).filter((x) => Number.isFinite(x));
  const start = t0 + 0.5;
  const w = steps.map(weight);
  const total = w.reduce((a, b) => a + b, 0);
  const room = Math.max(0.6, tOut - 0.45 - start);
  const f = total > room ? room / total : 1;
  let acc = 0;
  const at = steps.map((_, i) => {
    const d = start + acc * f;
    acc += w[i];
    return r3(Math.max(t0 + 0.2, Math.min(tOut - 0.3, i < given.length ? given[i] : d)));
  });

  // ---- HTML: thread per kasus (dipisah 'clear') ----
  const threads: Thread[] = [{ bubbles: [], chips: [] }];
  const chipsPerThread: number[] = [0];
  steps.forEach((s) => {
    if (s.from === 'chip') chipsPerThread[chipsPerThread.length - 1]++;
    if (s.from === 'clear') chipsPerThread.push(0);
  });
  steps.forEach((s, i) => {
    const th = threads[threads.length - 1];
    const text = s.text ?? '';
    if (s.from === 'clear') {
      threads.push({ bubbles: [], chips: [] });
    } else if (s.from === 'cus') {
      th.bubbles.push(`<div class="mv-sm cus" id="${P}-s${i}">${esc(text)}</div>`);
    } else if (s.from === 'bot' || s.from === 'human') {
      const hum = s.from === 'human';
      th.bubbles.push(
        `<div class="mv-dots${hum ? ' hum' : ''}" id="${P}-d${i}"><b></b><b></b><b></b></div>` +
          `<div class="mv-sm ${hum ? 'hum' : 'bot'}" id="${P}-s${i}">${hum ? '<span class="mv-who">ADMIN</span>' : ''}${typedHtml(text)}</div>`,
      );
    } else if (s.from === 'chip') {
      const tone = s.tone ?? 'green';
      const kind = tone === 'red' || tone === 'amber' ? 'warn' : 'check';
      const big = !s.sub && chipsPerThread[threads.length - 1] === 1;
      th.chips.push(
        `<span class="mv-chip ${toneClass(tone, 'green')}${big ? ' big' : ''}" id="${P}-s${i}">${chipIcon(kind)}${esc(text)}` +
          `${s.sub ? ` <small>${esc(s.sub)}</small>` : ''}</span>`,
      );
    }
  });
  const title = p.title ?? '';
  const tile = p.logo
    ? `<div class="mv-tile">${logoMark()}</div>`
    : `<div class="mv-tile mv-ava">${esc(Array.from(title)[0]?.toUpperCase() ?? '?')}</div>`;
  const body = threads
    .map((th, k) => `<div class="mv-chat-th" id="${P}-th${k}">${th.bubbles.join('')}</div><div class="mv-chat-cp" id="${P}-cp${k}">${th.chips.join('')}</div>`)
    .join('');
  const html =
    `<div class="mv-r" id="${P}" data-layout-allow-overlap><div class="mv-chat" id="${P}-w">` +
    `<div class="mv-chat-hd">${tile}<div><b>${esc(title)}</b>${p.status ? `<small><i></i>${esc(p.status)}</small>` : ''}</div></div>` +
    `${body}</div></div>`;

  // ---- JS + SFX ----
  const J: string[] = [];
  const sfx: MotionSfx[] = [cue(t0, 'swish', -8, { align: true })];
  J.push(`tl.fromTo("#${P}-w", { opacity: 0, y: 30, scale: 0.96 }, { ...IN, duration: 0.36 }, ${r3(t0 + 0.05)});`);
  let th = 0;
  steps.forEach((s, i) => {
    const t = at[i];
    const next = i + 1 < steps.length ? at[i + 1] : tOut;
    if (s.from === 'cus') {
      J.push(`mv.show("${P}-s${i}", ${t}, 0.25);`);
      sfx.push(cue(t, 'pop', -4));
    } else if (s.from === 'bot' || s.from === 'human') {
      const len = Array.from(s.text ?? '').length;
      const dd = Math.min(DOTS, Math.max(0.2, (next - t) * 0.4));
      const ts = r3(t + dd);
      // ketikan harus selesai sebelum langkah berikutnya: percepat bila perlu (maks 140 huruf/dtk)
      const roomT = next - ts - 0.12;
      const cps = Math.round(Math.max(CPS, Math.min(140, roomT > 0 ? len / roomT : CPS)));
      J.push(`mv.dots("${P}-d${i}", ${t}, ${ts});`);
      J.push(`mv.type("${P}-s${i}", ${ts}, ${cps});`);
      sfx.push(cue(ts, 'ketik', -4, { dur: len / cps + 0.05 }));
    } else if (s.from === 'chip') {
      const big = !s.sub && chipsPerThread[th] === 1;
      const rgb = toneOf(s.tone, 'green').rgb;
      if (big) J.push(`tl.fromTo("#${P}-s${i}", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.32, ease: "back.out(1.9)", immediateRender: false }, ${t});`);
      else J.push(`mv.pop("${P}-s${i}", ${t}, 0.28);`);
      J.push(`mv.ring("${P}-s${i}", ${r3(t + 0.1)}, "${rgb}");`);
      sfx.push(cue(t, 'ding', big ? -2 : -6));
    } else {
      // clear: thread dan chip kasus ini keluar ke atas, kasus berikutnya mulai dari atas
      J.push(`tl.to("#${P}-th${th}", { opacity: 0, y: -60, duration: 0.25, ease: "power2.in" }, ${t});`);
      J.push(`tl.to("#${P}-cp${th}", { opacity: 0, duration: 0.2, ease: "power2.in" }, ${t});`);
      sfx.push(cue(t, 'swish', -10, { align: true }));
      th++;
    }
  });
  J.push(`mv.hide(${js(P)}, ${tOut}, ${EXIT_DUR});`);
  return { html, css: CSS, js: J.join('\n'), sfx };
}

export const chat: MotionComponent<'chat'> = {
  kind: 'chat',
  title: 'Chat window',
  description: 'WhatsApp chat window: customer bubbles, typed bot replies (typing dots first), admin replies, status chips, and clear for the next case.',
  fields: [
    { key: 'title', label: 'Header name', type: 'text' },
    { key: 'status', label: 'Status', type: 'text', hint: 'E.g. online' },
    { key: 'logo', label: 'MIVA logo tile in header', type: 'bool' },
    {
      key: 'steps',
      label: 'Steps',
      type: 'json',
      hint: "[{from: cus|bot|human|chip|clear, text?, sub?, tone?}]; one step = one beat; max ~5 bubbles per case (use clear)",
    },
  ],
  defaults: (): ChatProps => ({
    title: 'MIVA AI',
    status: 'online',
    logo: true,
    steps: [
      { from: 'cus', text: 'Harga berapa?' },
      { from: 'bot', text: 'Untuk paket A, harganya…' },
      { from: 'chip', text: 'LEAD', sub: 'Saved', tone: 'green' },
      { from: 'chip', text: 'FOLLOW-UP', sub: 'Scheduled', tone: 'green' },
    ],
  }),
  minDur: 3,
  maxDur: 14,
  zone: 'scene',
  sceneDefault: true,
  build,
};
