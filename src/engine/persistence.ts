// Persistent storage for database projects.
// Each project is stored as the raw SQLite file bytes in IndexedDB, so data
// survives refreshes and restarts. Files can also be saved/opened as .dbwow
// (a standard SQLite file that any SQLite tool can read).

export interface StoredProject { id: string; name: string; bytes: Uint8Array; modified: string; size: number; }
export interface ProjectInfo { id: string; name: string; modified: string; size: number; }

const DB_NAME = 'wowdb-store';
const STORE = 'projects';
const BACKUPS = 'backups';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Browser storage is not available.')); return; }
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BACKUPS)) db.createObjectStore(BACKUPS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise<T | undefined>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    let result: T | undefined;
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error ?? new Error('Storage transaction aborted (the browser may be out of space).')); };
  }));
}

export async function saveProject(p: StoredProject): Promise<void> { await tx(STORE, 'readwrite', (s) => s.put(p)); }
export async function loadProject(id: string): Promise<StoredProject | undefined> { return tx<StoredProject>(STORE, 'readonly', (s) => s.get(id)); }
export async function deleteProject(id: string): Promise<void> { await tx(STORE, 'readwrite', (s) => s.delete(id)); }
export async function listProjects(): Promise<ProjectInfo[]> {
  const all = (await tx<StoredProject[]>(STORE, 'readonly', (s) => s.getAll())) ?? [];
  return all.map(({ id, name, modified, size }) => ({ id, name, modified, size })).sort((a, b) => b.modified.localeCompare(a.modified));
}

export interface BackupInfo { id: string; projectId: string; name: string; created: string; size: number; }
export async function saveBackup(projectId: string, name: string, bytes: Uint8Array): Promise<BackupInfo> {
  const b = { id: 'bk_' + Date.now().toString(36), projectId, name, created: new Date().toISOString(), size: bytes.length, bytes };
  await tx(BACKUPS, 'readwrite', (s) => s.put(b));
  return { id: b.id, projectId, name, created: b.created, size: b.size };
}
export async function listBackups(projectId?: string): Promise<BackupInfo[]> {
  const all = (await tx<(BackupInfo & { bytes: Uint8Array })[]>(BACKUPS, 'readonly', (s) => s.getAll())) ?? [];
  return all.filter((b) => !projectId || b.projectId === projectId).map(({ id, projectId: pid, name, created, size }) => ({ id, projectId: pid, name, created, size })).sort((a, b) => b.created.localeCompare(a.created));
}
export async function loadBackup(id: string): Promise<Uint8Array | undefined> {
  const b = await tx<{ bytes: Uint8Array }>(BACKUPS, 'readonly', (s) => s.get(id));
  return b?.bytes;
}
export async function deleteBackup(id: string): Promise<void> { await tx(BACKUPS, 'readwrite', (s) => s.delete(id)); }

/** Last opened project (per viewer convenience). */
export function rememberLast(id: string | null) { try { if (id) localStorage.setItem('wowdb.last', id); else localStorage.removeItem('wowdb.last'); } catch { /* ignore */ } }
export function lastOpened(): string | null { try { return localStorage.getItem('wowdb.last'); } catch { return null; } }

type HostDownloads = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
type HostWindow = { claude?: { use: (n: string) => Promise<unknown> } };
let notify: (msg: string) => void = () => undefined;
/** The UI registers how download problems are shown (an in-app message box). */
export function setDownloadNotifier(fn: (msg: string) => void) { notify = fn; }
/** True when DBWOW runs inside the claude.ai artifact viewer. */
export function isHosted(): boolean { return typeof window !== 'undefined' && !!(window as unknown as HostWindow).claude?.use; }
const HOSTED_OK = /\.(csv|json|xlsx|pdf|txt|zip|html|md)$/i;

/** Save a file for the user: a normal browser download, or the viewer's save prompt when hosted. */
export async function downloadBytes(bytes: Uint8Array | string, filename: string, mime = 'application/octet-stream'): Promise<void> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  if (isHosted()) {
    let name = filename;
    if (/\.sql$/i.test(name)) name += '.txt';
    if (!HOSTED_OK.test(name)) { notify(`The hosted page can't save "${filename}" files. Open the portable DBWOW file (or the Next.js version) on your computer to download the database file, or export the tables as Excel or SQL instead.`); return; }
    try {
      const dl = (await (window as unknown as HostWindow).claude!.use('downloads')) as HostDownloads | null;
      if (!dl) { notify('Saving files is not available in this view.'); return; }
      await dl.save({ filename: name, data: blob });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== 'declined') notify(`The file could not be saved (${code ?? (e as Error).message}).`);
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ask the user for a file. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function safeFileName(name: string) { return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Database'; }
