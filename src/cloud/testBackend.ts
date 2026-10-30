// Stand-in cloud used only by the automated browser tests. The "server" is a
// JSON object kept in localStorage under dbwow.__testcloud, so a test can copy
// it into a second browser to act as another device. Never used in production.
import type { LearnState } from '@/learning/achievements';
import type { CloudBackend, CloudDbInfo, CloudUser } from './backend';
import { MAX_CLOUD_BYTES } from './backend';

interface Server {
  users: Record<string, { name: string; email: string; password: string; progress?: string; dbs: Record<string, CloudDbInfo & { b64: string }> }>;
  shares: Record<string, { ownerUid: string; ownerName: string; dbId: string; name: string; modified: string; b64: string }>;
  session?: string;
}
const KEY = 'dbwow.__testcloud';
const load = (): Server => { try { return JSON.parse(localStorage.getItem(KEY) || '') as Server; } catch { return { users: {}, shares: {} }; } };
const store = (s: Server) => localStorage.setItem(KEY, JSON.stringify(s));
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const err = (code: string) => Object.assign(new Error(code), { code });

export function createTestBackend(): CloudBackend {
  const listeners = new Set<(u: CloudUser | null) => void>();
  const current = (): CloudUser | null => { const s = load(); const u = s.session ? s.users[s.session] : undefined; return u ? { uid: s.session!, name: u.name, email: u.email } : null; };
  const emit = () => { const u = current(); listeners.forEach((l) => l(u)); };
  const need = () => { const u = current(); if (!u) throw err('auth/not-signed-in'); return u; };
  return {
    kind: 'test',
    onUser(cb) { listeners.add(cb); setTimeout(() => cb(current()), 0); return () => listeners.delete(cb); },
    async register(name, email, password) {
      const s = load(); const e = email.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(e)) throw err('auth/invalid-email');
      if (password.length < 6) throw err('auth/weak-password');
      if (Object.values(s.users).some((u) => u.email === e)) throw err('auth/email-already-in-use');
      const uid = 'u' + Object.keys(s.users).length;
      s.users[uid] = { name: name.trim(), email: e, password, dbs: {} }; s.session = uid; store(s); emit();
      return { uid, name: name.trim(), email: e };
    },
    async signIn(email, password) {
      const s = load(); const e = email.trim().toLowerCase();
      const uid = Object.keys(s.users).find((k) => s.users[k].email === e);
      if (!uid || s.users[uid].password !== password) throw err('auth/invalid-credential');
      s.session = uid; store(s); emit();
      return { uid, name: s.users[uid].name, email: e };
    },
    async resetPassword() { /* nothing to send in tests */ },
    async signOut() { const s = load(); delete s.session; store(s); emit(); },
    async listDatabases() { const u = need(); return Object.values(load().users[u.uid].dbs).map(({ b64: _b, ...i }) => { void _b; return i; }).sort((a, b) => b.modified.localeCompare(a.modified)); },
    async saveDatabase(id, name, bytes) {
      if (bytes.length > MAX_CLOUD_BYTES) throw new Error('too large');
      const u = need(); const s = load(); const prev = s.users[u.uid].dbs[id];
      const info: CloudDbInfo = { id, name, modified: new Date().toISOString(), size: bytes.length, shareId: prev?.shareId };
      s.users[u.uid].dbs[id] = { ...info, b64: b64(bytes) };
      if (prev?.shareId) s.shares[prev.shareId] = { ...s.shares[prev.shareId], name, modified: info.modified, b64: b64(bytes) };
      store(s); return info;
    },
    async loadDatabase(id) { const u = need(); const d = load().users[u.uid].dbs[id]; return d ? unb64(d.b64) : null; },
    async deleteDatabase(id) { const u = need(); const s = load(); const d = s.users[u.uid].dbs[id]; if (d?.shareId) delete s.shares[d.shareId]; delete s.users[u.uid].dbs[id]; store(s); },
    async shareDatabase(id, name, bytes) {
      const u = need(); const s = load(); const d = s.users[u.uid].dbs[id];
      const shareId = d?.shareId ?? 's' + Date.now().toString(36);
      s.shares[shareId] = { ownerUid: u.uid, ownerName: u.name, dbId: id, name, modified: new Date().toISOString(), b64: b64(bytes) };
      if (d) d.shareId = shareId; store(s); return shareId;
    },
    async unshareDatabase(id) { const u = need(); const s = load(); const d = s.users[u.uid].dbs[id]; if (d?.shareId) { delete s.shares[d.shareId]; delete d.shareId; } store(s); },
    async loadShared(shareId) { const x = load().shares[shareId]; return x ? { id: shareId, name: x.name, ownerName: x.ownerName, modified: x.modified, size: x.b64.length, bytes: unb64(x.b64) } : null; },
    async loadProgress() { const u = need(); const p = load().users[u.uid].progress; return p ? JSON.parse(p) as LearnState : null; },
    async saveProgress(p) { const u = need(); const s = load(); s.users[u.uid].progress = JSON.stringify(p); store(s); },
  };
}
