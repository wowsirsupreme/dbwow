import type { LearnState } from '@/learning/achievements';

/** Merge two progress records so nothing earned on either device is lost. */
export function mergeProgress(a: LearnState, b: LearnState): LearnState {
  const steps = { ...a.steps }; for (const [k, v] of Object.entries(b.steps ?? {})) if (v) steps[k] = true;
  const quizzes = { ...(b.quizzes ?? {}), ...(a.quizzes ?? {}) };
  const achievements: Record<string, string> = { ...(a.achievements ?? {}) };
  for (const [k, v] of Object.entries(b.achievements ?? {})) if (!achievements[k] || v < achievements[k]) achievements[k] = v;
  const events: Record<string, number> = { ...(a.events ?? {}) };
  for (const [k, v] of Object.entries(b.events ?? {})) events[k] = Math.max(events[k] ?? 0, v);
  return { quizzes, steps, achievements, events };
}

