// Classes, practical tests, attempts, integrity monitoring and study analytics.
//
// Who can see what (enforced by firestore.rules, mirrored by the test stand-in):
//   * Teachers (an email in TEACHER_EMAILS with a verified address, or a uid in
//     teachers/) create classes and tests, see every attempt and analytics.
//   * Students see the public part of a test (title, instructions, task text,
//     marks) only. The marking key is stored separately and is teacher-only.
//   * Marks are written into a student's attempt only when the teacher releases
//     results, so nothing can be read early.
import type { ExamTask, GradeResult } from '@/exam/checks';

export interface ClassInfo { id: string; name: string; code: string; ownerUid: string; ownerName: string; created: string; }
export interface Member { uid: string; name: string; email: string; joined: string; }

export type TestStatus = 'draft' | 'open' | 'closed';
export interface TestSettings {
  requireFullscreen: boolean;   // ask for full screen and record each exit
  allowLearning: boolean;       // Learning Centre and hints available during the test
}
export interface TestPublic {
  id: string;
  title: string;
  instructions: string;
  classId: string | null;
  durationMin: number;
  status: TestStatus;
  code: string;                 // join code students type
  tasks: { id: string; text: string; marks: number }[];
  start: { kind: 'blank' } | { kind: 'sample'; sample: string } | { kind: 'file'; name: string; size: number };
  settings: TestSettings;
  ownerUid: string;
  ownerName: string;
  created: string;
  resultsReleased: boolean;
}
export interface TestKey { tasks: Pick<ExamTask, 'id' | 'check'>[]; }

export interface Counters {
  tabSwitches: number;          // page hidden (another tab or app)
  focusLost: number;            // window lost focus without hiding (another window on top)
  fullscreenExits: number;
  pastes: number;
  pastedChars: number;
  copies: number;
  activeSec: number;
  idleSec: number;
  hiddenSec: number;
  actions: number;              // database changes made
  reloads: number;
}
export const zeroCounters = (): Counters => ({ tabSwitches: 0, focusLost: 0, fullscreenExits: 0, pastes: 0, pastedChars: 0, copies: 0, activeSec: 0, idleSec: 0, hiddenSec: 0, actions: 0, reloads: 0 });

export type AttemptStatus = 'in-progress' | 'submitted';
export interface Attempt {
  id: string;                   // `${testId}_${uid}`
  testId: string;
  uid: string;
  name: string;
  email: string;
  classId: string | null;
  status: AttemptStatus;
  startedAt: string;
  deadline: string;
  submittedAt?: string;
  autoSubmitted?: boolean;
  lastSeen: string;
  snapshotAt?: string;
  counters: Counters;
  // present only after the teacher releases results
  score?: number;
  max?: number;
  taskResults?: GradeResult['tasks'];
  teacherAdjust?: number;
  comment?: string;
}
export interface AttemptEvent { t: string; type: string; detail?: string; }
export interface StoredGrade extends GradeResult { uid: string; gradedAt: string; snapshotAt?: string; teacherAdjust?: number; comment?: string; }

/** One day of study activity for one student (all sums). */
export interface DayStats {
  date: string;                 // YYYY-MM-DD
  activeSec: number;            // interacting with DBWOW (input in the last 60 s, page visible)
  idleSec: number;              // DBWOW visible but no input
  hiddenSec: number;            // DBWOW open in a background tab
  sessions: number;
  actions: number;              // database changes
  steps: number;                // practical steps verified
  quizAnswered: number;
  quizCorrect: number;
  sqlRuns: number;
  xp: number;                   // XP at the end of the day
}

export interface SchoolBackend {
  isTeacher(): Promise<boolean>;
  addTeacher(email: string): Promise<string>;

  createClass(name: string): Promise<ClassInfo>;
  listClasses(): Promise<ClassInfo[]>;               // teacher: classes they own
  myClasses(): Promise<ClassInfo[]>;                 // student: classes joined
  joinClass(code: string): Promise<ClassInfo>;
  classMembers(classId: string): Promise<Member[]>;
  removeMember(classId: string, uid: string): Promise<void>;
  deleteClass(classId: string): Promise<void>;

  saveTest(t: TestPublic, key: TestKey, startBytes?: Uint8Array): Promise<string>;
  listTests(): Promise<TestPublic[]>;                // teacher
  findTest(code: string): Promise<TestPublic | null>; // student, open tests only
  getTest(id: string): Promise<TestPublic | null>;
  getKey(id: string): Promise<TestKey | null>;
  loadTestStart(id: string): Promise<Uint8Array | null>;
  setTestStatus(id: string, status: TestStatus): Promise<void>;
  deleteTest(id: string): Promise<void>;

  startAttempt(t: TestPublic): Promise<{ attempt: Attempt; resumed: boolean }>;
  getAttempt(id: string): Promise<Attempt | null>;
  updateAttempt(id: string, patch: Partial<Pick<Attempt, 'counters' | 'lastSeen' | 'status' | 'submittedAt' | 'autoSubmitted'>>): Promise<void>;
  saveAttemptSnapshot(id: string, bytes: Uint8Array): Promise<void>;
  loadAttemptSnapshot(id: string): Promise<Uint8Array | null>;
  logEvents(id: string, items: AttemptEvent[]): Promise<void>;
  attemptEvents(id: string): Promise<AttemptEvent[]>;
  listAttempts(testId: string): Promise<Attempt[]>;
  watchAttempts(testId: string, cb: (a: Attempt[]) => void): () => void;
  myAttempts(): Promise<(Attempt & { testTitle?: string })[]>;
  /** Teacher: let a student who submitted by mistake carry on (adds minutes). */
  reopenAttempt(id: string, extraMin: number): Promise<void>;

  saveGrade(testId: string, g: StoredGrade): Promise<void>;
  listGrades(testId: string): Promise<StoredGrade[]>;
  releaseResults(testId: string): Promise<void>;

  addDay(date: string, inc: Partial<Omit<DayStats, 'date' | 'xp'>>, xp: number): Promise<void>;
  studentDays(uid: string, sinceDate: string): Promise<DayStats[]>;
  studentProgress(uid: string): Promise<string | null>;  // JSON of LearnState
}

export function newCode(n = 6) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; const r = new Uint32Array(n); crypto.getRandomValues(r);
  for (const x of r) s += a[x % a.length];
  return s;
}
export const today = () => new Date().toISOString().slice(0, 10);
