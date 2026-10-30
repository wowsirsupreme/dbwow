// Firebase implementation of CloudBackend (Authentication + Cloud Firestore).
//
// Firestore layout (rules in firestore.rules):
//   users/{uid}                         { name, email, progress, updated }
//   users/{uid}/databases/{id}          { name, modified, size, gen, chunks, shareId? }
//   users/{uid}/databases/{id}/chunks/{gen_i}   { data: Bytes }
//   shares/{shareId}                    { ownerUid, ownerName, dbId, name, modified, size, gen, chunks }
//   shares/{shareId}/chunks/{gen_i}     { data: Bytes }
//
// A database file is split into chunks below Firestore's 1 MiB document
// limit. Each save writes a new generation of chunks first and switches the
// metadata to it last, so a reader never sees half of a save. Old chunks are
// deleted afterwards. This works on the free (Spark) plan: no Cloud Storage.
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { LearnState } from '@/learning/achievements';
import type { CloudBackend, CloudDbInfo, CloudUser, SharedDb } from './backend';
import { MAX_CLOUD_BYTES } from './backend';

export interface FirebaseConfig { apiKey: string; authDomain: string; projectId: string; appId: string; storageBucket?: string; messagingSenderId?: string; }

const CHUNK = 700_000;
const BATCH_BYTES = 6_000_000;   // stay well below Firestore's 10 MiB request limit

type Mods = { app: typeof import('firebase/app'); auth: typeof import('firebase/auth'); fs: typeof import('firebase/firestore') };

export function createFirebaseBackend(config: FirebaseConfig): CloudBackend {
  let ready: Promise<{ m: Mods; app: FirebaseApp; auth: Auth; db: Firestore }> | null = null;
  const init = () => {
    if (!ready) ready = (async () => {
      const [app, auth, fs] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]);
      const a = app.getApps()[0] ?? app.initializeApp(config);
      const au = auth.getAuth(a);
      await auth.setPersistence(au, auth.browserLocalPersistence);
      return { m: { app, auth, fs }, app: a, auth: au, db: fs.getFirestore(a) };
    })();
    return ready;
  };
  const toUser = (u: { uid: string; displayName: string | null; email: string | null } | null): CloudUser | null => (u ? { uid: u.uid, name: u.displayName || (u.email ?? '').split('@')[0] || 'Student', email: u.email ?? '' } : null);
  const me = async () => { const c = await init(); const u = c.auth.currentUser; if (!u) throw Object.assign(new Error('Sign in first.'), { code: 'auth/not-signed-in' }); return { ...c, uid: u.uid, user: toUser(u)! }; };

  /** Write `bytes` as a new chunk generation under `base`, then call `commitMeta` with the new gen. */
  async function writeChunks(c: Awaited<ReturnType<typeof init>>, base: string[], bytes: Uint8Array, commitMeta: (gen: string, chunks: number) => Promise<void>, oldGen?: string, oldChunks?: number) {
    const { fs } = c.m;
    if (bytes.length > MAX_CLOUD_BYTES) throw new Error(`This database is ${(bytes.length / 1048576).toFixed(1)} MB. The limit for the cloud is ${MAX_CLOUD_BYTES / 1048576} MB. Remove some large pictures, then use Compact & Repair.`);
    const gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
    let batch = fs.writeBatch(c.db); let inBatch = 0;
    for (let i = 0; i < n; i++) {
      const part = bytes.subarray(i * CHUNK, Math.min(bytes.length, (i + 1) * CHUNK));
      batch.set(fs.doc(c.db, ...(base as [string]), 'chunks', `${gen}_${i}`), { data: fs.Bytes.fromUint8Array(part), i });
      inBatch += part.length;
      if (inBatch >= BATCH_BYTES) { await batch.commit(); batch = fs.writeBatch(c.db); inBatch = 0; }
    }
    if (inBatch) await batch.commit();
    await commitMeta(gen, n);
    if (oldGen && oldChunks) {
      const del = fs.writeBatch(c.db);
      for (let i = 0; i < oldChunks; i++) del.delete(fs.doc(c.db, ...(base as [string]), 'chunks', `${oldGen}_${i}`));
      await del.commit().catch(() => undefined);   // leftovers are harmless
    }
  }
  async function readChunks(c: Awaited<ReturnType<typeof init>>, base: string[], gen: string, n: number): Promise<Uint8Array> {
    const { fs } = c.m;
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => fs.getDoc(fs.doc(c.db, ...(base as [string]), 'chunks', `${gen}_${i}`))));
    const arrays = parts.map((d, i) => { const b = d.get('data') as { toUint8Array(): Uint8Array } | undefined; if (!b) throw new Error(`Part ${i + 1} of the database is missing in the cloud.`); return b.toUint8Array(); });
    const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of arrays) { out.set(a, o); o += a.length; }
    return out;
  }
  async function deleteChunks(c: Awaited<ReturnType<typeof init>>, base: string[], gen: string, n: number) {
    const { fs } = c.m;
    const b = fs.writeBatch(c.db);
    for (let i = 0; i < n; i++) b.delete(fs.doc(c.db, ...(base as [string]), 'chunks', `${gen}_${i}`));
    await b.commit();
  }

  return {
    kind: 'firebase',
    onUser(cb) {
      let unsub: (() => void) | null = null; let dead = false;
      void init().then((c) => { if (!dead) unsub = c.m.auth.onAuthStateChanged(c.auth, (u) => cb(toUser(u))); }).catch(() => cb(null));
      return () => { dead = true; unsub?.(); };
    },
    async register(name, email, password) {
      const c = await init();
      const cred = await c.m.auth.createUserWithEmailAndPassword(c.auth, email.trim(), password);
      await c.m.auth.updateProfile(cred.user, { displayName: name.trim() });
      await c.m.fs.setDoc(c.m.fs.doc(c.db, 'users', cred.user.uid), { name: name.trim(), email: email.trim(), created: new Date().toISOString() }, { merge: true });
      return { uid: cred.user.uid, name: name.trim(), email: email.trim() };
    },
    async signIn(email, password) { const c = await init(); const cred = await c.m.auth.signInWithEmailAndPassword(c.auth, email.trim(), password); return toUser(cred.user)!; },
    async signInWithGoogle() {
      const c = await init();
      const cred = await c.m.auth.signInWithPopup(c.auth, new c.m.auth.GoogleAuthProvider());
      const u = toUser(cred.user)!;
      await c.m.fs.setDoc(c.m.fs.doc(c.db, 'users', u.uid), { name: u.name, email: u.email }, { merge: true });
      return u;
    },
    async resetPassword(email) { const c = await init(); await c.m.auth.sendPasswordResetEmail(c.auth, email.trim()); },
    async signOut() { const c = await init(); await c.m.auth.signOut(c.auth); },

    async listDatabases() {
      const c = await me(); const { fs } = c.m;
      const snap = await fs.getDocs(fs.collection(c.db, 'users', c.uid, 'databases'));
      return snap.docs.map((d) => ({ id: d.id, name: String(d.get('name')), modified: String(d.get('modified')), size: Number(d.get('size') ?? 0), shareId: d.get('shareId') || undefined }) as CloudDbInfo)
        .sort((a, b) => b.modified.localeCompare(a.modified));
    },
    async saveDatabase(id, name, bytes) {
      const c = await me(); const { fs } = c.m;
      const ref = fs.doc(c.db, 'users', c.uid, 'databases', id);
      const old = await fs.getDoc(ref);
      const modified = new Date().toISOString();
      await writeChunks(c, ['users', c.uid, 'databases', id], bytes, async (gen, chunks) => {
        await fs.setDoc(ref, { name, modified, size: bytes.length, gen, chunks }, { merge: true });
      }, old.get('gen'), old.get('chunks'));
      const shareId = old.get('shareId') as string | undefined;
      if (shareId) await this.shareDatabase(id, name, bytes).catch(() => undefined);   // keep the shared copy up to date
      return { id, name, modified, size: bytes.length, shareId };
    },
    async loadDatabase(id) {
      const c = await me(); const { fs } = c.m;
      const d = await fs.getDoc(fs.doc(c.db, 'users', c.uid, 'databases', id));
      if (!d.exists()) return null;
      return readChunks(c, ['users', c.uid, 'databases', id], String(d.get('gen')), Number(d.get('chunks')));
    },
    async deleteDatabase(id) {
      const c = await me(); const { fs } = c.m;
      const ref = fs.doc(c.db, 'users', c.uid, 'databases', id);
      const d = await fs.getDoc(ref);
      if (!d.exists()) return;
      if (d.get('shareId')) await this.unshareDatabase(id);
      await deleteChunks(c, ['users', c.uid, 'databases', id], String(d.get('gen')), Number(d.get('chunks')));
      await fs.deleteDoc(ref);
    },
    async shareDatabase(id, name, bytes) {
      const c = await me(); const { fs } = c.m;
      const dbRef = fs.doc(c.db, 'users', c.uid, 'databases', id);
      const dbDoc = await fs.getDoc(dbRef);
      const shareId = (dbDoc.get('shareId') as string | undefined) ?? (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      const sref = fs.doc(c.db, 'shares', shareId);
      const old = await fs.getDoc(sref);
      // the share document must exist before its chunks (the rules check its owner)
      if (!old.exists()) await fs.setDoc(sref, { ownerUid: c.uid, ownerName: c.user.name, dbId: id, name, modified: new Date().toISOString(), size: 0, gen: '', chunks: 0 });
      await writeChunks(c, ['shares', shareId], bytes, async (gen, chunks) => {
        await fs.setDoc(sref, { ownerUid: c.uid, ownerName: c.user.name, dbId: id, name, modified: new Date().toISOString(), size: bytes.length, gen, chunks });
      }, old.exists() ? old.get('gen') : undefined, old.exists() ? old.get('chunks') : undefined);
      if (dbDoc.exists() && dbDoc.get('shareId') !== shareId) await fs.setDoc(dbRef, { shareId }, { merge: true });
      return shareId;
    },
    async unshareDatabase(id) {
      const c = await me(); const { fs } = c.m;
      const dbRef = fs.doc(c.db, 'users', c.uid, 'databases', id);
      const d = await fs.getDoc(dbRef);
      const shareId = d.get('shareId') as string | undefined;
      if (!shareId) return;
      const sref = fs.doc(c.db, 'shares', shareId);
      const s = await fs.getDoc(sref);
      if (s.exists()) { await deleteChunks(c, ['shares', shareId], String(s.get('gen')), Number(s.get('chunks'))); await fs.deleteDoc(sref); }
      await fs.updateDoc(dbRef, { shareId: fs.deleteField() });
    },
    async loadShared(shareId) {
      const c = await init(); const { fs } = c.m;
      const s = await fs.getDoc(fs.doc(c.db, 'shares', shareId));
      if (!s.exists() || !s.get('chunks')) return null;
      const bytes = await readChunks(c, ['shares', shareId], String(s.get('gen')), Number(s.get('chunks')));
      return { id: shareId, name: String(s.get('name')), ownerName: String(s.get('ownerName') ?? ''), modified: String(s.get('modified')), size: bytes.length, bytes } as SharedDb;
    },
    async loadProgress() {
      const c = await me(); const { fs } = c.m;
      const d = await fs.getDoc(fs.doc(c.db, 'users', c.uid));
      const p = d.get('progress') as string | undefined;
      return p ? JSON.parse(p) as LearnState : null;
    },
    async saveProgress(p) {
      const c = await me(); const { fs } = c.m;
      // stored as JSON text: Firestore field names cannot contain the ":" used in step keys
      await fs.setDoc(fs.doc(c.db, 'users', c.uid), { progress: JSON.stringify(p), updated: new Date().toISOString(), name: c.user.name, email: c.user.email }, { merge: true });
    },
  };
}
