// Stand-in cloud used only by the automated browser tests. It talks to a tiny
// key-value server that the test harness starts (tests/e2e/fakecloud.cjs), so
// several browsers (students, a teacher) share one "cloud" like real devices.
// Enabled only when a page sets window.__DBWOW_FAKE_CLOUD__ to that server's
// URL before loading. Never used in production. It mirrors firestore.rules:
// students never receive the marking key, and marks reach an attempt only on release.
import type { LearnState } from '@/learning/achievements';
import type { CloudBackend, CloudDbInfo, CloudUser } from './backend';
import { MAX_CLOUD_BYTES } from './backend';
import { newCode, startWindow, zeroCounters, type Attempt, type AttemptEvent, type ClassInfo, type DayStats, type Member, type SchoolBackend, type StoredGrade, type TestKey, type TestPublic } from './school';

type W = Window & { __DBWOW_TEST_TEACHERS__?: string[] };
interface UserRec { name: string; email: string; password: string; progress?: string; classIds?: string[]; anonymous?: boolean }

function kv(base: string) {
  const u = (k: string) => `${base}/kv/${encodeURIComponent(k)}`;
  return {
    async get<T>(k: string): Promise<T | null> { const r = await fetch(u(k)); return (await r.json()) as T | null; },
    async set(k: string, v: unknown) { await fetch(u(k), { method: 'PUT', body: JSON.stringify(v) }); },
    async del(k: string) { await fetch(u(k), { method: 'DELETE' }); },
    async list<T>(prefix: string): Promise<{ key: string; value: T }[]> { const r = await fetch(`${base}/list?prefix=${encodeURIComponent(prefix)}`); return (await r.json()) as { key: string; value: T }[]; },
  };
}
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const err = (code: string, message = code) => Object.assign(new Error(message), { code });
const SESSION = 'dbwow.__testsession';

export function createTestBackend(url: string): CloudBackend {
  const db = kv(url.replace(/\/$/, ''));
  const listeners = new Set<(u: CloudUser | null) => void>();
  const sessionUid = () => { try { return localStorage.getItem(SESSION); } catch { return null; } };
  const current = async (): Promise<CloudUser | null> => {
    const uid = sessionUid(); if (!uid) return null;
    const u = await db.get<UserRec>(`user/${uid}`);
    return u ? { uid, name: u.name, email: u.email, emailVerified: true, ...(u.anonymous ? { anonymous: true } : {}) } : null;
  };
  const emit = async () => { const u = await current(); listeners.forEach((l) => l(u)); };
  const need = async () => { const u = await current(); if (!u) throw err('auth/not-signed-in', 'Sign in first.'); return u; };
  const teacherEmails = () => ((window as W).__DBWOW_TEST_TEACHERS__ ?? []).map((e) => e.toLowerCase());
  const isTeacherUid = async (u: CloudUser) => teacherEmails().includes(u.email) || !!(await db.get(`teacher/${u.uid}`));
  const needTeacher = async () => { const u = await need(); if (!(await isTeacherUid(u))) throw err('permission-denied'); return u; };

  const school: SchoolBackend = {
    async isTeacher() { return isTeacherUid(await need()); },
    async addTeacher(email) {
      await needTeacher();
      const hit = (await db.list<UserRec>('user/')).find((x) => x.value.email === email.trim().toLowerCase());
      if (!hit) throw new Error(`No DBWOW account uses ${email}. Ask them to register first.`);
      const uid = hit.key.slice(5); await db.set(`teacher/${uid}`, { email }); return uid;
    },
    async createClass(name) {
      const u = await needTeacher();
      const c: ClassInfo = { id: 'c' + Date.now().toString(36), name: name.trim(), code: newCode(), ownerUid: u.uid, ownerName: u.name, created: new Date().toISOString() };
      await db.set(`class/${c.id}`, c); return c;
    },
    async listClasses() { const u = await needTeacher(); return (await db.list<ClassInfo>('class/')).map((x) => x.value).filter((c) => c.ownerUid === u.uid); },
    async myClasses() {
      const u = await need(); const rec = await db.get<UserRec>(`user/${u.uid}`);
      return (await Promise.all((rec?.classIds ?? []).map((id) => db.get<ClassInfo>(`class/${id}`)))).filter((x): x is ClassInfo => !!x);
    },
    async joinClass(code) {
      const u = await need();
      const c = (await db.list<ClassInfo>('class/')).map((x) => x.value).find((x) => x.code === code.trim().toUpperCase());
      if (!c) throw new Error('No class has that code. Check it with your teacher.');
      await db.set(`member/${c.id}/${u.uid}`, { uid: u.uid, name: u.name, email: u.email, joined: new Date().toISOString() });
      const rec = (await db.get<UserRec>(`user/${u.uid}`))!; rec.classIds = [...new Set([...(rec.classIds ?? []), c.id])]; await db.set(`user/${u.uid}`, rec);
      return c;
    },
    async classMembers(cid) { await needTeacher(); return (await db.list<Member>(`member/${cid}/`)).map((x) => x.value); },
    async removeMember(cid, uid) { await needTeacher(); await db.del(`member/${cid}/${uid}`); },
    async deleteClass(cid) { await needTeacher(); for (const m of await db.list(`member/${cid}/`)) await db.del(m.key); await db.del(`class/${cid}`); },

    async saveTest(t, key, start) {
      const u = await needTeacher();
      const id = t.id || 't' + Date.now().toString(36);
      await db.set(`test/${id}`, { ...t, id, ownerUid: u.uid, ownerName: u.name });
      await db.set(`key/${id}`, key);
      if (start) await db.set(`teststart/${id}`, b64(start));
      return id;
    },
    async listTests() { const u = await needTeacher(); return (await db.list<TestPublic>('test/')).map((x) => x.value).filter((t) => t.ownerUid === u.uid).sort((a, b) => b.created.localeCompare(a.created)); },
    async findTest(code) { await need(); return (await db.list<TestPublic>('test/')).map((x) => x.value).find((t) => t.code === code.trim().toUpperCase() && t.status === 'open') ?? null; },
    async getTest(id) { await need(); return db.get<TestPublic>(`test/${id}`); },
    async getKey(id) { await needTeacher(); return db.get<TestKey>(`key/${id}`); },
    async loadTestStart(id) { await need(); const s = await db.get<string>(`teststart/${id}`); return s ? unb64(s) : null; },
    async setTestStatus(id, status) { await needTeacher(); const t = (await db.get<TestPublic>(`test/${id}`))!; await db.set(`test/${id}`, { ...t, status }); },
    async deleteTest(id) { await needTeacher(); await db.del(`test/${id}`); await db.del(`key/${id}`); await db.del(`teststart/${id}`); },

    async startAttempt(t, info) {
      const u = await need(); const id = `${t.id}_${u.uid}`;
      const old = await db.get<Attempt>(`attempt/${id}`);
      if (old) return { attempt: old, resumed: true };
      const fresh = await db.get<TestPublic>(`test/${t.id}`);
      if (!fresh || startWindow(fresh) !== 'open') throw err('permission-denied', 'This test is not open.');
      const now = Date.now();
      const a: Attempt = { id, testId: t.id, uid: u.uid, name: info?.name ?? u.name, email: u.email, classId: t.classId, status: 'in-progress', startedAt: new Date(now).toISOString(), deadline: new Date(now + t.durationMin * 60000).toISOString(), lastSeen: new Date(now).toISOString(), counters: zeroCounters(), details: info?.details ?? {}, ...(info ? { pledge: { text: info.pledge, at: new Date(now).toISOString() } } : {}) };
      await db.set(`attempt/${id}`, a); return { attempt: a, resumed: false };
    },
    async getAttempt(id) { await need(); return db.get<Attempt>(`attempt/${id}`); },
    async updateAttempt(id, patch) {
      const u = await need(); const a = (await db.get<Attempt>(`attempt/${id}`))!;
      if (a.uid !== u.uid && !(await isTeacherUid(u))) throw err('permission-denied');
      if (a.uid === u.uid && a.status === 'submitted' && patch.status !== 'submitted') throw err('permission-denied');
      await db.set(`attempt/${id}`, { ...a, ...patch });
    },
    async saveAttemptSnapshot(id, bytes) {
      const u = await need(); const a = (await db.get<Attempt>(`attempt/${id}`))!;
      if (a.uid !== u.uid || a.status !== 'in-progress' || Date.now() > Date.parse(a.deadline) + 300000) throw err('permission-denied');
      await db.set(`snap/${id}`, b64(bytes)); await db.set(`attempt/${id}`, { ...a, snapshotAt: new Date().toISOString() });
    },
    async loadAttemptSnapshot(id) { await need(); const s = await db.get<string>(`snap/${id}`); return s ? unb64(s) : null; },
    async logEvents(id, items) { if (!items.length) return; await need(); await db.set(`events/${id}/${Date.now()}${Math.random().toString(36).slice(2, 5)}`, items); },
    async attemptEvents(id) { await needTeacher(); return (await db.list<AttemptEvent[]>(`events/${id}/`)).flatMap((x) => x.value).sort((a, b) => a.t.localeCompare(b.t)); },
    async listAttempts(testId) { await needTeacher(); return (await db.list<Attempt>('attempt/')).map((x) => x.value).filter((a) => a.testId === testId); },
    watchAttempts(testId, cb) {
      let dead = false;
      const tick = async () => { if (dead) return; try { cb(await school.listAttempts(testId)); } catch { /* ignore */ } if (!dead) setTimeout(tick, 1000); };
      void tick(); return () => { dead = true; };
    },
    async myAttempts() {
      const u = await need();
      const list = (await db.list<Attempt>('attempt/')).map((x) => x.value).filter((a) => a.uid === u.uid);
      return Promise.all(list.map(async (a) => ({ ...a, testTitle: (await db.get<TestPublic>(`test/${a.testId}`))?.title })));
    },
    async reopenAttempt(id, extra) { await needTeacher(); const a = (await db.get<Attempt>(`attempt/${id}`))!; const { submittedAt: _s, ...rest } = a; void _s; await db.set(`attempt/${id}`, { ...rest, status: 'in-progress', deadline: new Date(Date.now() + extra * 60000).toISOString() }); },

    async saveGrade(testId, g) { await needTeacher(); await db.set(`grade/${testId}/${g.uid}`, g); },
    async listGrades(testId) { await needTeacher(); return (await db.list<StoredGrade>(`grade/${testId}/`)).map((x) => x.value); },
    async releaseResults(testId) {
      await needTeacher();
      for (const g of await school.listGrades(testId)) {
        const a = await db.get<Attempt>(`attempt/${testId}_${g.uid}`);
        if (a) await db.set(`attempt/${a.id}`, { ...a, score: Math.max(0, Math.min(g.max, g.score + (g.teacherAdjust ?? 0))), max: g.max, taskResults: g.tasks, teacherAdjust: g.teacherAdjust ?? 0, comment: g.comment ?? '' });
      }
      const t = (await db.get<TestPublic>(`test/${testId}`))!; await db.set(`test/${testId}`, { ...t, resultsReleased: true });
    },

    async addDay(date, inc, xp) {
      const u = await need(); const k = `day/${u.uid}/${date}`;
      const d = (await db.get<DayStats>(k)) ?? { date, activeSec: 0, idleSec: 0, hiddenSec: 0, sessions: 0, actions: 0, steps: 0, quizAnswered: 0, quizCorrect: 0, sqlRuns: 0, xp: 0 };
      for (const [f, v] of Object.entries(inc)) (d as unknown as Record<string, number>)[f] += v as number;
      d.xp = xp; await db.set(k, d);
    },
    async studentDays(uid, since) { const u = await need(); if (u.uid !== uid) await needTeacher(); return (await db.list<DayStats>(`day/${uid}/`)).map((x) => x.value).filter((d) => d.date >= since).sort((a, b) => a.date.localeCompare(b.date)); },
    async studentProgress(uid) { await needTeacher(); return (await db.get<UserRec>(`user/${uid}`))?.progress ?? null; },
  };

  return {
    kind: 'test',
    school,
    onUser(cb) { listeners.add(cb); void current().then(cb); return () => listeners.delete(cb); },
    async signInAsGuest(name) {
      let uid = sessionUid();
      if (!uid || !(await db.get(`user/${uid}`))) { uid = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); localStorage.setItem(SESSION, uid); }
      const rec = await db.get<UserRec>(`user/${uid}`);
      if (!rec || rec.anonymous) await db.set(`user/${uid}`, { name: name.trim(), email: '', password: '', anonymous: true });
      await emit(); return (await current())!;
    },
    async register(name, email, password) {
      const e = email.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(e)) throw err('auth/invalid-email');
      if (password.length < 6) throw err('auth/weak-password');
      const all = await db.list<UserRec>('user/');
      if (all.some((x) => x.value.email === e)) throw err('auth/email-already-in-use');
      const uid = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      await db.set(`user/${uid}`, { name: name.trim(), email: e, password });
      localStorage.setItem(SESSION, uid); await emit();
      return { uid, name: name.trim(), email: e, emailVerified: true };
    },
    async signIn(email, password) {
      const e = email.trim().toLowerCase();
      const hit = (await db.list<UserRec>('user/')).find((x) => x.value.email === e);
      if (!hit || hit.value.password !== password) throw err('auth/invalid-credential');
      localStorage.setItem(SESSION, hit.key.slice(5)); await emit();
      return { uid: hit.key.slice(5), name: hit.value.name, email: e, emailVerified: true };
    },
    async resetPassword() { /* nothing to send in tests */ },
    async signOut() { localStorage.removeItem(SESSION); await emit(); },
    async listDatabases() { const u = await need(); return (await db.list<CloudDbInfo & { b64: string }>(`db/${u.uid}/`)).map(({ value: { b64: _b, ...i } }) => { void _b; return i; }).sort((a, b) => b.modified.localeCompare(a.modified)); },
    async saveDatabase(id, name, bytes) {
      if (bytes.length > MAX_CLOUD_BYTES) throw new Error('too large');
      const u = await need(); const prev = await db.get<CloudDbInfo>(`db/${u.uid}/${id}`);
      const info: CloudDbInfo = { id, name, modified: new Date().toISOString(), size: bytes.length, shareId: prev?.shareId };
      await db.set(`db/${u.uid}/${id}`, { ...info, b64: b64(bytes) });
      if (prev?.shareId) { const s = await db.get<Record<string, unknown>>(`share/${prev.shareId}`); await db.set(`share/${prev.shareId}`, { ...s, name, modified: info.modified, b64: b64(bytes) }); }
      return info;
    },
    async loadDatabase(id) { const u = await need(); const d = await db.get<{ b64: string }>(`db/${u.uid}/${id}`); return d ? unb64(d.b64) : null; },
    async deleteDatabase(id) { const u = await need(); const d = await db.get<CloudDbInfo>(`db/${u.uid}/${id}`); if (d?.shareId) await db.del(`share/${d.shareId}`); await db.del(`db/${u.uid}/${id}`); },
    async shareDatabase(id, name, bytes) {
      const u = await need(); const d = await db.get<CloudDbInfo & { b64: string }>(`db/${u.uid}/${id}`);
      const shareId = d?.shareId ?? 's' + Date.now().toString(36);
      await db.set(`share/${shareId}`, { ownerUid: u.uid, ownerName: u.name, dbId: id, name, modified: new Date().toISOString(), b64: b64(bytes) });
      if (d) await db.set(`db/${u.uid}/${id}`, { ...d, shareId });
      return shareId;
    },
    async unshareDatabase(id) { const u = await need(); const d = await db.get<CloudDbInfo & { b64: string }>(`db/${u.uid}/${id}`); if (d?.shareId) { await db.del(`share/${d.shareId}`); const { shareId: _s, ...rest } = d; void _s; await db.set(`db/${u.uid}/${id}`, rest); } },
    async loadShared(shareId) { const x = await db.get<{ name: string; ownerName: string; modified: string; b64: string }>(`share/${shareId}`); return x ? { id: shareId, name: x.name, ownerName: x.ownerName, modified: x.modified, size: x.b64.length, bytes: unb64(x.b64) } : null; },
    async loadProgress() { const u = await need(); const p = (await db.get<UserRec>(`user/${u.uid}`))?.progress; return p ? JSON.parse(p) as LearnState : null; },
    async saveProgress(p) { const u = await need(); const rec = (await db.get<UserRec>(`user/${u.uid}`))!; await db.set(`user/${u.uid}`, { ...rec, progress: JSON.stringify(p) }); },
  };
}
