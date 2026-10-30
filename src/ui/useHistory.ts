// Undo/redo history for designer state (table designs, queries, forms, reports).
import { useCallback, useRef, useState } from 'react';

export function useHistory<T>(initial: T, limit = 100) {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[] }>({ past: [], present: initial, future: [] });
  const lastPush = useRef(0);
  const set = useCallback((v: T | ((prev: T) => T), opts: { merge?: boolean } = {}) => {
    setState((s) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(s.present) : v;
      if (JSON.stringify(next) === JSON.stringify(s.present)) return s;
      const now = Date.now();
      // typing quickly in the same field merges into one undo step
      const merge = opts.merge ?? now - lastPush.current < 350;
      lastPush.current = now;
      if (merge && s.past.length) return { past: s.past, present: next, future: [] };
      return { past: [...s.past, s.present].slice(-limit), present: next, future: [] };
    });
  }, [limit]);
  const undo = useCallback(() => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);
  const reset = useCallback((v: T) => setState({ past: [], present: v, future: [] }), []);
  /** Record a step immediately (no merging), e.g. after a drag finishes. */
  const commit = useCallback((v: T) => { lastPush.current = 0; set(v, { merge: false }); }, [set]);
  return { value: state.present, set, commit, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
