// State dokumen editor dengan undo/redo (snapshot; dokumen kecil, JSON beberapa KB).
import { useCallback, useReducer } from 'react';
import type { Doc } from './ops';

interface Hist {
  doc: Doc;
  past: { doc: Doc; label: string }[];
  future: { doc: Doc; label: string }[];
  /** naik setiap dokumen berubah (dipakai autosave) */
  rev: number;
}

type Action = { type: 'apply'; label: string; fn: (d: Doc) => Doc } | { type: 'undo' } | { type: 'redo' } | { type: 'reset'; doc: Doc };

const LIMIT = 200;

function reducer(h: Hist, a: Action): Hist {
  switch (a.type) {
    case 'apply': {
      const doc = a.fn(h.doc);
      if (doc === h.doc || JSON.stringify(doc) === JSON.stringify(h.doc)) return h;
      return { doc, past: [...h.past, { doc: h.doc, label: a.label }].slice(-LIMIT), future: [], rev: h.rev + 1 };
    }
    case 'undo': {
      const prev = h.past[h.past.length - 1];
      if (!prev) return h;
      return { doc: prev.doc, past: h.past.slice(0, -1), future: [{ doc: h.doc, label: prev.label }, ...h.future], rev: h.rev + 1 };
    }
    case 'redo': {
      const next = h.future[0];
      if (!next) return h;
      return { doc: next.doc, past: [...h.past, { doc: h.doc, label: next.label }], future: h.future.slice(1), rev: h.rev + 1 };
    }
    case 'reset':
      return { doc: a.doc, past: [], future: [], rev: 0 };
  }
}

export function useDocHistory(initial: Doc) {
  const [h, dispatch] = useReducer(reducer, { doc: initial, past: [], future: [], rev: 0 });
  const apply = useCallback((label: string, fn: (d: Doc) => Doc) => dispatch({ type: 'apply', label, fn }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((doc: Doc) => dispatch({ type: 'reset', doc }), []);
  return {
    doc: h.doc,
    rev: h.rev,
    apply,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    undoLabel: h.past[h.past.length - 1]?.label,
    redoLabel: h.future[0]?.label,
  };
}
