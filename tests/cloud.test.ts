import { describe, expect, it } from 'vitest';
import { mergeProgress } from '@/cloud/merge';
import { cloudMessage } from '@/cloud/backend';

describe('cloud progress merge', () => {
  it('keeps everything earned on either device', () => {
    const a = { quizzes: { 'q:0': 1 }, steps: { 'p:0': true }, achievements: { x: '2026-10-02' }, events: { import: 1 } };
    const b = { quizzes: { 'q:0': 2, 'q:1': 0 }, steps: { 'p:1': true }, achievements: { x: '2026-10-01', y: '2026-10-03' }, events: { import: 3, pdf: 1 } };
    const m = mergeProgress(a, b);
    expect(m.steps).toEqual({ 'p:0': true, 'p:1': true });
    expect(m.quizzes).toEqual({ 'q:0': 1, 'q:1': 0 });          // this device's answer wins
    expect(m.achievements).toEqual({ x: '2026-10-01', y: '2026-10-03' }); // earliest unlock date kept
    expect(m.events).toEqual({ import: 3, pdf: 1 });
  });
  it('turns Firebase errors into plain language', () => {
    expect(cloudMessage({ code: 'auth/email-already-in-use' })).toMatch(/already exists/);
    expect(cloudMessage({ code: 'permission-denied' })).toMatch(/security rules/);
  });
});
