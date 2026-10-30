// Cloud accounts: one interface, two implementations.
//   * Firebase (Authentication + Cloud Firestore) for the real app.
//   * A local stand-in used by the automated browser tests (enabled only when
//     the page sets window.__DBWOW_FAKE_CLOUD__ before it loads).
// The rest of the app talks only to CloudBackend, so the cloud provider can
// change without touching the designers.
import type { LearnState } from '@/learning/achievements';

export interface CloudUser { uid: string; name: string; email: string; }
export interface CloudDbInfo { id: string; name: string; modified: string; size: number; shareId?: string; }
export interface SharedDb { id: string; name: string; ownerName: string; modified: string; size: number; bytes: Uint8Array; }

export interface CloudBackend {
  readonly kind: 'firebase' | 'test';
  onUser(cb: (u: CloudUser | null) => void): () => void;
  register(name: string, email: string, password: string): Promise<CloudUser>;
  signIn(email: string, password: string): Promise<CloudUser>;
  signInWithGoogle?(): Promise<CloudUser>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  listDatabases(): Promise<CloudDbInfo[]>;
  saveDatabase(id: string, name: string, bytes: Uint8Array): Promise<CloudDbInfo>;
  loadDatabase(id: string): Promise<Uint8Array | null>;
  deleteDatabase(id: string): Promise<void>;
  /** Publish (or refresh) a read-only copy anyone with the link can open. */
  shareDatabase(id: string, name: string, bytes: Uint8Array): Promise<string>;
  unshareDatabase(id: string): Promise<void>;
  loadShared(shareId: string): Promise<SharedDb | null>;
  loadProgress(): Promise<LearnState | null>;
  saveProgress(p: LearnState): Promise<void>;
}

/** Largest database that can be stored in the account (Firestore free tier friendly). */
export const MAX_CLOUD_BYTES = 15 * 1024 * 1024;

/** Plain-language messages for the errors students will actually meet. */
export function cloudMessage(e: unknown): string {
  const code = String((e as { code?: string })?.code ?? '');
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address is not valid.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead, or use "Forgot password".',
    'auth/invalid-credential': 'The email or password is not correct.',
    'auth/wrong-password': 'The email or password is not correct.',
    'auth/user-not-found': 'There is no account with that email. Register first.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No internet connection. Your work is still saved in this browser.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed.',
    'auth/unauthorized-domain': 'This website is not yet allowed to sign in. The teacher must add it under Firebase > Authentication > Settings > Authorized domains.',
    'auth/operation-not-allowed': 'This sign-in method is not switched on in Firebase (Authentication > Sign-in method).',
    'permission-denied': 'The cloud refused this request. The Firestore security rules may not be published yet.',
    'unavailable': 'The cloud is not reachable right now. Your work is still saved in this browser.',
    'resource-exhausted': 'The cloud storage quota has been reached.',
  };
  if (map[code]) return map[code];
  const msg = (e as Error)?.message ?? String(e);
  return msg.replace(/^Firebase:\s*/, '').replace(/\s*\(.*?\)\.?$/, '');
}
