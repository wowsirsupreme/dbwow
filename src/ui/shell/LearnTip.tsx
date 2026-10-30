'use client';
import React from 'react';
import { Lightbulb } from 'lucide-react';
import { useApp } from '../store';
import { CONTEXT_TIPS } from '@/learning/content';

/** Contextual help strip shown while Learning Mode is on. */
export function LearnTip({ k }: { k: string }) {
  const on = useApp((s) => s.learningMode);
  if (!on || !CONTEXT_TIPS[k]) return null;
  return <div className="learn-bar"><Lightbulb size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{CONTEXT_TIPS[k]}</span></div>;
}
