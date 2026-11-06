'use client';
import React from 'react';
import { Lightbulb } from 'lucide-react';
import { useApp } from '../store';
import { CONTEXT_TIPS } from '@/learning/content';
import { useExam } from '@/exam/session';

/** Contextual help strip shown while Learning Mode is on. */
export function LearnTip({ k }: { k: string }) {
  const on = useApp((s) => s.learningMode);
  const locked = useExam((s) => (s.phase === 'running' || s.phase === 'submitting') && !s.session?.test.settings.allowLearning);
  if (!on || locked || !CONTEXT_TIPS[k]) return null;
  return <div className="learn-bar"><Lightbulb size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{CONTEXT_TIPS[k]}</span></div>;
}
