// Firebase implementation of SchoolBackend (classes, tests, attempts, analytics).
// Layout (see firestore.rules):
//   teachers/{uid}
//   classes/{cid}                 { name, code, ownerUid, ownerName, created }
//   classes/{cid}/members/{uid}   { name, email, joined }
//   tests/{tid}                   public part of a test (no answers) + startGen/startChunks
//   tests/{tid}/key/main          marking key (teachers only)
//   tests/{tid}/chunks/{gen_i}    starting database, when the teacher supplied one
//   tests/{tid}/grades/{uid}      marks (teachers only until released)
//   attempts/{tid_uid}            one student's attempt, counters, snapshot meta
//   attempts/{aid}/chunks/{…}     latest snapshot of the student's database
//   attempts/{aid}/events/{…}     batches of integrity events
//   users/{uid}/days/{date}       study activity per day
import type { CloudUser } from './backend';
import { firebaseContext, readChunks, writeChunks, deleteChunks, type Ctx, type FirebaseConfig } from './firebase';
import { TEACHER_EMAILS } from './config';
import { zeroCounters, type Attempt, type AttemptEvent, type ClassInfo, type DayStats, type Member, type SchoolBackend, type StoredGrade, type TestKey, type TestPublic } from './school';

export function createFirebaseSchool(config: FirebaseConfig): SchoolBackend {
  const me = async (): Promise<Ctx & { uid: string; user: CloudUser }> => {
    const c = await firebaseContext(config);
    const u = c.auth.currentUser;
    if (!u) throw Object.assign(new Error('Sign in first.'), { code: 'auth/not-signed-in' });
    return { ...c, uid: u.uid, user: { uid: u.uid, name: u.displayName || (u.email ?? '').split('@')[0], email: u.email ?? '', emailVerified: u.emailVerified } };
  };
  const data = <T>(d: { id: string; data(): unknown }): T => ({ id: d.id, ...(d.data() as object) }) as T;

  const api: SchoolBackend = {
    async isTeacher() {
      const c = await me();
      if (c.user.emailVerified && TEACHER_EMAILS.map((e) => e.toLowerCase()).includes(c.user.email.toLowerCase())) return true;
      try { return (await c.m.fs.getDoc(c.m.fs.doc(c.db, 'teachers', c.uid))).exists(); } catch { return false; }
    },
    async addTeacher(email) {
      const c = await me(); const { fs } = c.m;
      const snap = await fs.getDocs(fs.query(fs.collection(c.db, 'users'), fs.where('email', '==', email.trim()), fs.limit(1)));
      if (snap.empty) throw new Error(`No DBWOW account uses ${email}. Ask them to register first.`);
      await fs.setDoc(fs.doc(c.db, 'teachers', snap.docs[0].id), { email: email.trim(), addedBy: c.uid, added: new Date().toISOString() });
      return snap.docs[0].id;
    },

    async createClass(name) {
      const c = await me(); const { fs } = c.m;
      const ref = fs.doc(fs.collection(c.db, 'classes'));
      const { newCode } = await import('./school');
      const cls: ClassInfo = { id: ref.id, name: name.trim(), code: newCode(), ownerUid: c.uid, ownerName: c.user.name, created: new Date().toISOString() };
      const { id: _id, ...rest } = cls; void _id;
      await fs.setDoc(ref, rest);
      return cls;
    },
    async listClasses() {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.query(fs.collection(c.db, 'classes'), fs.where('ownerUid', '==', c.uid)));
      return s.docs.map((d) => data<ClassInfo>(d)).sort((a, b) => a.name.localeCompare(b.name));
    },
    async myClasses() {
      const c = await me(); const { fs } = c.m;
      const u = await fs.getDoc(fs.doc(c.db, 'users', c.uid));
      const ids = (u.get('classIds') as string[] | undefined) ?? [];
      const docs = await Promise.all(ids.map((id) => fs.getDoc(fs.doc(c.db, 'classes', id)).catch(() => null)));
      return docs.filter((d) => d?.exists()).map((d) => data<ClassInfo>(d!));
    },
    async joinClass(code) {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.query(fs.collection(c.db, 'classes'), fs.where('code', '==', code.trim().toUpperCase()), fs.limit(1)));
      if (s.empty) throw new Error('No class has that code. Check it with your teacher.');
      const cls = data<ClassInfo>(s.docs[0]);
      await fs.setDoc(fs.doc(c.db, 'classes', cls.id, 'members', c.uid), { name: c.user.name, email: c.user.email, joined: new Date().toISOString() });
      await fs.setDoc(fs.doc(c.db, 'users', c.uid), { classIds: fs.arrayUnion(cls.id), name: c.user.name, email: c.user.email }, { merge: true });
      return cls;
    },
    async classMembers(cid) {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.collection(c.db, 'classes', cid, 'members'));
      return s.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Member, 'uid'>) })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async removeMember(cid, uid) { const c = await me(); await c.m.fs.deleteDoc(c.m.fs.doc(c.db, 'classes', cid, 'members', uid)); },
    async deleteClass(cid) {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.collection(c.db, 'classes', cid, 'members'));
      const b = fs.writeBatch(c.db); s.docs.forEach((d) => b.delete(d.ref)); b.delete(fs.doc(c.db, 'classes', cid)); await b.commit();
    },

    async saveTest(t, key, startBytes) {
      const c = await me(); const { fs } = c.m;
      const ref = t.id ? fs.doc(c.db, 'tests', t.id) : fs.doc(fs.collection(c.db, 'tests'));
      const old = await fs.getDoc(ref);
      const { id: _id, ...pub } = { ...t, id: ref.id }; void _id;
      await fs.setDoc(ref, { ...pub, ownerUid: c.uid, ownerName: c.user.name }, { merge: true });
      await fs.setDoc(fs.doc(c.db, 'tests', ref.id, 'key', 'main'), key);
      if (startBytes) {
        await writeChunks(c, ['tests', ref.id], startBytes, async (gen, chunks) => { await fs.updateDoc(ref, { startGen: gen, startChunks: chunks }); }, old.get('startGen'), old.get('startChunks'));
      }
      return ref.id;
    },
    async listTests() {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.query(fs.collection(c.db, 'tests'), fs.where('ownerUid', '==', c.uid)));
      return s.docs.map((d) => data<TestPublic>(d)).sort((a, b) => b.created.localeCompare(a.created));
    },
    async findTest(code) {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.query(fs.collection(c.db, 'tests'), fs.where('code', '==', code.trim().toUpperCase()), fs.where('status', '==', 'open'), fs.limit(1)));
      return s.empty ? null : data<TestPublic>(s.docs[0]);
    },
    async getTest(id) { const c = await me(); const d = await c.m.fs.getDoc(c.m.fs.doc(c.db, 'tests', id)); return d.exists() ? data<TestPublic>(d) : null; },
    async getKey(id) { const c = await me(); const d = await c.m.fs.getDoc(c.m.fs.doc(c.db, 'tests', id, 'key', 'main')); return d.exists() ? (d.data() as TestKey) : null; },
    async loadTestStart(id) {
      const c = await me(); const d = await c.m.fs.getDoc(c.m.fs.doc(c.db, 'tests', id));
      if (!d.get('startGen')) return null;
      return readChunks(c, ['tests', id], String(d.get('startGen')), Number(d.get('startChunks')));
    },
    async setTestStatus(id, status) { const c = await me(); await c.m.fs.updateDoc(c.m.fs.doc(c.db, 'tests', id), { status }); },
    async deleteTest(id) {
      const c = await me(); const { fs } = c.m;
      const ref = fs.doc(c.db, 'tests', id); const d = await fs.getDoc(ref);
      if (d.get('startGen')) await deleteChunks(c, ['tests', id], String(d.get('startGen')), Number(d.get('startChunks'))).catch(() => undefined);
      await fs.deleteDoc(fs.doc(c.db, 'tests', id, 'key', 'main'));
      await fs.deleteDoc(ref);
    },

    async startAttempt(t) {
      const c = await me(); const { fs } = c.m;
      const id = `${t.id}_${c.uid}`;
      const ref = fs.doc(c.db, 'attempts', id);
      const d = await fs.getDoc(ref);
      if (d.exists()) return { attempt: data<Attempt>(d), resumed: true };
      const now = Date.now();
      const a: Attempt = { id, testId: t.id, uid: c.uid, name: c.user.name, email: c.user.email, classId: t.classId, status: 'in-progress', startedAt: new Date(now).toISOString(), deadline: new Date(now + t.durationMin * 60000).toISOString(), lastSeen: new Date(now).toISOString(), counters: zeroCounters() };
      const { id: _id, ...rest } = a; void _id;
      await fs.setDoc(ref, { ...rest, deadlineMs: now + t.durationMin * 60000 });
      return { attempt: a, resumed: false };
    },
    async getAttempt(id) { const c = await me(); const d = await c.m.fs.getDoc(c.m.fs.doc(c.db, 'attempts', id)); return d.exists() ? data<Attempt>(d) : null; },
    async updateAttempt(id, patch) { const c = await me(); await c.m.fs.updateDoc(c.m.fs.doc(c.db, 'attempts', id), patch as { [k: string]: never }); },
    async saveAttemptSnapshot(id, bytes) {
      const c = await me(); const { fs } = c.m;
      const ref = fs.doc(c.db, 'attempts', id); const old = await fs.getDoc(ref);
      await writeChunks(c, ['attempts', id], bytes, async (gen, chunks) => { await fs.updateDoc(ref, { gen, chunks, snapshotAt: new Date().toISOString() }); }, old.get('gen'), old.get('chunks'));
    },
    async loadAttemptSnapshot(id) {
      const c = await me(); const d = await c.m.fs.getDoc(c.m.fs.doc(c.db, 'attempts', id));
      if (!d.get('gen')) return null;
      return readChunks(c, ['attempts', id], String(d.get('gen')), Number(d.get('chunks')));
    },
    async logEvents(id, items) {
      if (!items.length) return;
      const c = await me(); await c.m.fs.addDoc(c.m.fs.collection(c.db, 'attempts', id, 'events'), { at: new Date().toISOString(), items });
    },
    async attemptEvents(id) {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.collection(c.db, 'attempts', id, 'events'));
      return s.docs.flatMap((d) => (d.get('items') as AttemptEvent[]) ?? []).sort((a, b) => a.t.localeCompare(b.t));
    },
    async listAttempts(testId) {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.query(fs.collection(c.db, 'attempts'), fs.where('testId', '==', testId)));
      return s.docs.map((d) => data<Attempt>(d));
    },
    watchAttempts(testId, cb) {
      let unsub: (() => void) | null = null; let dead = false;
      void me().then((c) => {
        if (dead) return;
        const { fs } = c.m;
        unsub = fs.onSnapshot(fs.query(fs.collection(c.db, 'attempts'), fs.where('testId', '==', testId)), (s) => cb(s.docs.map((d) => data<Attempt>(d))), () => undefined);
      });
      return () => { dead = true; unsub?.(); };
    },
    async myAttempts() {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.query(fs.collection(c.db, 'attempts'), fs.where('uid', '==', c.uid)));
      const list = s.docs.map((d) => data<Attempt>(d));
      const titles = await Promise.all(list.map((a) => fs.getDoc(fs.doc(c.db, 'tests', a.testId)).then((t) => t.get('title') as string).catch(() => undefined)));
      return list.map((a, i) => ({ ...a, testTitle: titles[i] })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
    async reopenAttempt(id, extraMin) {
      const c = await me(); const { fs } = c.m;
      const ms = Date.now() + extraMin * 60000;
      await fs.updateDoc(fs.doc(c.db, 'attempts', id), { status: 'in-progress', deadline: new Date(ms).toISOString(), deadlineMs: ms, submittedAt: fs.deleteField() });
    },

    async saveGrade(testId, g) { const c = await me(); await c.m.fs.setDoc(c.m.fs.doc(c.db, 'tests', testId, 'grades', g.uid), g); },
    async listGrades(testId) { const c = await me(); const s = await c.m.fs.getDocs(c.m.fs.collection(c.db, 'tests', testId, 'grades')); return s.docs.map((d) => d.data() as StoredGrade); },
    async releaseResults(testId) {
      const c = await me(); const { fs } = c.m;
      const grades = await api.listGrades(testId);
      const b = fs.writeBatch(c.db);
      for (const g of grades) b.update(fs.doc(c.db, 'attempts', `${testId}_${g.uid}`), { score: Math.max(0, Math.min(g.max, g.score + (g.teacherAdjust ?? 0))), max: g.max, taskResults: g.tasks });
      b.update(fs.doc(c.db, 'tests', testId), { resultsReleased: true });
      await b.commit();
    },

    async addDay(date, inc, xp) {
      const c = await me(); const { fs } = c.m;
      const upd: Record<string, unknown> = { date, xp };
      for (const [k, v] of Object.entries(inc)) if (v) upd[k] = fs.increment(v as number);
      await fs.setDoc(fs.doc(c.db, 'users', c.uid, 'days', date), upd, { merge: true });
    },
    async studentDays(uid, since) {
      const c = await me(); const { fs } = c.m;
      const s = await fs.getDocs(fs.query(fs.collection(c.db, 'users', uid, 'days'), fs.where('date', '>=', since)));
      return s.docs.map((d) => ({ activeSec: 0, idleSec: 0, hiddenSec: 0, sessions: 0, actions: 0, steps: 0, quizAnswered: 0, quizCorrect: 0, sqlRuns: 0, xp: 0, ...(d.data() as Partial<DayStats>), date: d.id }) as DayStats).sort((a, b) => a.date.localeCompare(b.date));
    },
    async studentProgress(uid) { const c = await me(); const d = await c.m.fs.getDoc(c.m.fs.doc(c.db, 'users', uid)); return (d.get('progress') as string | undefined) ?? null; },
  };
  return api;
}
