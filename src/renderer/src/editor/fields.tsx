// Kontrol form bersama panel Motion dan Details: Switch dan Draft (kotak teks/angka dengan draf lokal).
//
// Draft: ketikan disimpan di draf lokal dan baru diterapkan ke dokumen setelah berhenti mengetik (debounce), saat fokus
// pindah (blur), atau Enter (kotak satu baris). Jadi satu edit = satu langkah undo, bukan satu per ketikan. Teks yang tidak
// valid menampilkan error inline dan TIDAK diterapkan. Perubahan dari luar (undo/redo, buka versi) menimpa draf.
import { useEffect, useRef, useState } from 'react';

export function Switch({ on, onToggle, label, testId }: { on: boolean; onToggle: () => void; label: string; testId?: string }) {
  return (
    <button type="button" className={`sw${on ? ' on' : ''}`} aria-label={label} aria-pressed={on} data-testid={testId} onClick={onToggle}>
      <span className="knob" />
    </button>
  );
}

export type DraftCheck = { error: string } | { norm: string; apply: () => void };

interface DraftProps {
  /** teks yang sekarang ada di dokumen */
  shown: string;
  /** validasi teks: error, atau teks ternormalisasi + aksi menerapkannya */
  check: (text: string) => DraftCheck;
  label: string;
  testId?: string;
  area?: boolean;
  rows?: number;
  type?: 'text' | 'number';
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** jeda (ms) sesudah ketikan terakhir sebelum diterapkan */
  delay?: number;
}

export function Draft(p: DraftProps) {
  const [text, setText] = useState(p.shown);
  const [error, setError] = useState<string | null>(null);
  /** teks terakhir yang sinkron dengan dokumen (diterapkan atau diterima dari luar) */
  const last = useRef(p.shown);
  const timer = useRef(0);
  const live = useRef({ text, check: p.check });
  live.current = { text, check: p.check };
  const pending = useRef(false);

  // perubahan dari luar (undo/redo, buka versi, hasil Generate) menimpa draf langsung saat render (tanpa jeda satu frame);
  // perubahan akibat apply sendiri tidak menimpa ketikan yang sedang berjalan
  const [synced, setSynced] = useState(p.shown);
  if (p.shown !== synced) {
    setSynced(p.shown);
    if (p.shown !== last.current) {
      setText(p.shown);
      setError(null);
    }
  }
  useEffect(() => {
    if (p.shown !== last.current) {
      last.current = p.shown;
      pending.current = false;
      window.clearTimeout(timer.current);
    }
  }, [p.shown]);

  const run = (t: string) => {
    window.clearTimeout(timer.current);
    pending.current = false;
    const r = live.current.check(t);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setError(null);
    if (r.norm === last.current) return;
    last.current = r.norm;
    r.apply();
  };

  // pindah pilihan / tab saat ada ketikan yang belum diterapkan: terapkan dulu supaya tidak hilang
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current) {
        const r = live.current.check(live.current.text);
        if (!('error' in r) && r.norm !== last.current) r.apply();
      }
    },
    [],
  );

  const onChange = (t: string) => {
    setText(t);
    window.clearTimeout(timer.current);
    if (p.type === 'number' && t === '') {
      // input angka memberi '' untuk ketikan setengah jadi ("3." atau "-"): jangan tampilkan error sebelum blur
      setError(null);
      pending.current = false;
      return;
    }
    const r = p.check(t);
    if ('error' in r) {
      setError(r.error);
      pending.current = false;
      return;
    }
    setError(null);
    pending.current = true;
    timer.current = window.setTimeout(() => run(t), p.delay ?? 700);
  };

  const common = {
    value: text,
    'aria-label': p.label,
    'data-testid': p.testId,
    placeholder: p.placeholder,
    spellCheck: false,
    onBlur: () => run(live.current.text),
  };
  return (
    <>
      {p.area ? (
        <textarea className={`field${error ? ' bad' : ''}`} rows={p.rows ?? 4} {...common} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          className={`field${error ? ' bad' : ''}`}
          type={p.type ?? 'text'}
          step={p.step}
          min={p.min}
          max={p.max}
          {...common}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run(live.current.text)}
        />
      )}
      {error && (
        <span className="ferr" role="alert" data-testid={p.testId ? `${p.testId}-error` : undefined}>
          {error}
        </span>
      )}
    </>
  );
}
