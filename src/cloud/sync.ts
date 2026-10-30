// Keeps a signed-in student's work in their account:
//   * the open database is uploaded a few seconds after each change,
//   * learning progress (steps, quiz answers, trophies) is merged and synced,
//   * shared links open a copy of someone else's database.
import { create } from 'zustand';
import type { LearnState } from '@/learning/achievements';
import { useApp } from '@/ui/store';
import { useLearning } from '@/ui/learning';
import { cloudMessage, type CloudBackend, type CloudDbInfo, type CloudUser } from './backend';
import { FIREBASE_CONFIG } from './config';
import { createFirebaseBackend } from './firebase';
import { createTestBackend } from './testBackend';
import { mergeProgress } from './merge';
export { mergeProgress };

type W = Window & { __DBWOW_FAKE_CLOUD__?: boolean };
let backend: CloudBackend | null | undefined;
export function getBackend(): CloudBackend | null {
  if (backend !== undefined) return backend;
  if (typeof window === 'undefined') return null;
  const w = window as W;
  const web = /^https?:$/.test(location.protocol) && !/claude\.ai|claudeusercontent|anthropic/.test(location.hostname);
  backend = w.__DBWOW_FAKE_CLOUD__ ? createTestBackend() : FIREBASE_CONFIG && web ? createFirebaseBackend(FIREBASE_CONFIG) : null;
  return backend;
}

export interface CloudState {
  available: boolean;
  ready: boolean;               // first auth state received
  user: CloudUser | null;
  status: 'idle' | 'saving' | 'saved' | 'error' | 'offline';
  lastSaved: string | null;
  message: string | null;
}
export const useCloud = create<CloudState>(() => ({ available: false, ready: false, user: null, status: 'idle', lastSaved: null, message: null }));

let started = false;
let dbTimer: ReturnType<typeof setTimeout> | null = null;
let progTimer: ReturnType<typeof setTimeout> | null = null;
let pullingProgress = false;

export function startCloud() {
  if (started) return; started = true;
  const be = getBackend();
  useCloud.setState({ available: !!be });
  if (!be) return;
  be.onUser((u) => {
    const was = useCloud.getState().user;
    useCloud.setState({ user: u, ready: true, status: u ? useCloud.getState().status : 'idle', message: null });
    if (u && u.uid !== was?.uid) void onSignedIn();
  });
  // upload the open database a few seconds after it changes
  useApp.subscribe((s, prev) => {
    if (!useCloud.getState().user || !s.project || !s.projectId) return;
    if (s.version !== prev.version || s.projectId !== prev.projectId) scheduleDbUpload();
  });
  // keep learning progress in the account
  useLearning.subscribe((s, prev) => {
    if (pullingProgress || s.progress === prev.progress || !useCloud.getState().user) return;
    if (progTimer) clearTimeout(progTimer);
    progTimer = setTimeout(() => { void be.saveProgress(useLearning.getState().progress).catch(() => undefined); }, 1500);
  });
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { if (dbTimer) void uploadNow(); });
}

async function onSignedIn() {
  const be = getBackend(); if (!be) return;
  try {
    pullingProgress = true;
    const cloud = await be.loadProgress();
    const local = useLearning.getState().progress;
    const merged = cloud ? mergeProgress(local, cloud) : local;
    useLearning.getState().setProgress(merged);
    pullingProgress = false;
    await be.saveProgress(merged);
  } catch (e) { pullingProgress = false; useCloud.setState({ status: 'error', message: cloudMessage(e) }); }
  if (useApp.getState().project) scheduleDbUpload(300);
}

export function scheduleDbUpload(delay = 3000) {
  if (dbTimer) clearTimeout(dbTimer);
  useCloud.setState({ status: 'saving' });
  dbTimer = setTimeout(() => { void uploadNow(); }, delay);
}

export async function uploadNow(): Promise<CloudDbInfo | null> {
  if (dbTimer) { clearTimeout(dbTimer); dbTimer = null; }
  const be = getBackend(); const { project, projectId } = useApp.getState();
  if (!be || !useCloud.getState().user || !project || !projectId) return null;
  try {
    useCloud.setState({ status: 'saving' });
    const info = await be.saveDatabase(projectId, project.name, project.db.export());
    useCloud.setState({ status: 'saved', lastSaved: new Date().toLocaleTimeString(), message: null });
    return info;
  } catch (e) {
    const msg = cloudMessage(e);
    useCloud.setState({ status: /internet|reachable/.test(msg) ? 'offline' : 'error', message: msg });
    return null;
  }
}

export function shareLink(shareId: string) {
  return `${location.origin}${location.pathname}?share=${encodeURIComponent(shareId)}`;
}
