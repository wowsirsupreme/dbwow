// Printable practical-test results (PDF, Times, plain layout).
//   * resultsPdf: a class mark sheet with every checkpoint, followed by one
//     page per student with each checkpoint's mark and the reason.
//   * studentResultPdf: the same student page, for a student's own result.
import { jsPDF } from 'jspdf';
import type { Counters, TestPublic } from '@/cloud/school';

export interface PrintTask { text: string; marks: number; max: number; ok: boolean | null; reason: string; }
export interface PrintStudent {
  name: string; email: string; status: string; submittedAt?: string; autoSubmitted?: boolean;
  counters?: Counters;
  score: number | null; max: number; adjust?: number; comment?: string;
  tasks: PrintTask[];
}

const M = 48;                    // page margin (pt)
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function header(doc: jsPDF, title: string, sub: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.text(clean(title), M, M);
  doc.setFont('times', 'normal'); doc.setFontSize(10.5); doc.text(clean(sub), M, M + 16);
  doc.setLineWidth(0.6); doc.line(M, M + 24, w - M, M + 24);
  return M + 42;
}
function footer(doc: jsPDF, left: string) {
  const n = doc.getNumberOfPages(); const w = doc.internal.pageSize.getWidth(); const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('times', 'normal'); doc.setFontSize(9); doc.text(left, M, h - 24); doc.text(`Page ${i} of ${n}`, w - M, h - 24, { align: 'right' }); }
}
/** The built-in Times font has no arrows or other symbols: write them as words. */
const clean = (s: string) => s.replace(/\s*→\s*/g, ' to ').replace(/×/g, 'x').replace(/∅/g, '(empty)').replace(/[✓✔]/g, 'yes').replace(/[✗✘]/g, 'no').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
function wrap(doc: jsPDF, s: string, w: number): string[] { return doc.splitTextToSize(clean(s), w) as string[]; }

/** One student's page(s): every checkpoint with its mark and reason. */
function studentPages(doc: jsPDF, testTitle: string, s: PrintStudent, first: boolean) {
  if (!first) doc.addPage('a4', 'portrait');
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
  let y = header(doc, testTitle, `Result for ${s.name}${s.email ? ` (${s.email})` : ''}`);
  doc.setFontSize(11);
  const final = s.score === null ? null : Math.max(0, Math.min(s.max, s.score + (s.adjust ?? 0)));
  const lines = [
    `Status: ${s.status}${s.submittedAt ? ` (${fmtDate(s.submittedAt)})${s.autoSubmitted ? ', time ran out' : ''}` : ''}`,
    final === null ? 'Not marked yet.' : `Final mark: ${final} out of ${s.max} (${pct(final, s.max)}%)${s.adjust ? `, including a teacher adjustment of ${s.adjust > 0 ? '+' : ''}${s.adjust}` : ''}`,
  ];
  for (const l of lines) { doc.text(clean(l), M, y); y += 15; }
  y += 6;
  // checkpoint table
  const cNo = M, cTask = M + 28, cMark = w - M - 60, cRes = w - M;
  const head = () => { doc.setFont('times', 'bold'); doc.text('No.', cNo, y); doc.text('Checkpoint', cTask, y); doc.text('Mark', cMark, y); doc.text('Met', cRes, y, { align: 'right' }); doc.setFont('times', 'normal'); y += 5; doc.setLineWidth(0.4); doc.line(M, y, w - M, y); y += 13; };
  head();
  s.tasks.forEach((t, i) => {
    doc.setFontSize(11);
    const task = wrap(doc, t.text || `Task ${i + 1}`, cMark - cTask - 12);
    doc.setFontSize(9.5);
    const reason = t.reason ? wrap(doc, t.reason, cMark - cTask - 12) : [];
    const need = task.length * 13 + reason.length * 11.5 + 8;
    if (y + need > h - 48) { doc.addPage('a4', 'portrait'); y = header(doc, testTitle, `Result for ${s.name} (continued)`); head(); }
    doc.setFontSize(11);
    doc.text(String(i + 1), cNo, y);
    doc.text(task, cTask, y);
    doc.text(`${t.marks} / ${t.max}`, cMark, y);
    doc.text(t.ok === null ? '' : t.ok ? 'Yes' : 'No', cRes, y, { align: 'right' });
    y += task.length * 13;
    if (reason.length) { doc.setFontSize(9.5); doc.setFont('times', 'italic'); doc.text(reason, cTask, y - 2); doc.setFont('times', 'normal'); y += reason.length * 11.5; }
    doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(M, y - 4, w - M, y - 4); doc.setDrawColor(0);
    y += 8;
  });
  const extra: string[] = [];
  if (s.comment) extra.push(`Teacher's comment: ${s.comment}`);
  const c = s.counters;
  if (c) extra.push(`During the test: ${c.tabSwitches} tab switch(es), ${c.focusLost} time(s) another window was in front, ${c.fullscreenExits} full-screen exit(s), ${c.pastes} paste(s) (${c.pastedChars} characters), ${c.reloads} reload(s). Active ${Math.round(c.activeSec / 60)} min, idle ${Math.round(c.idleSec / 60)} min, away ${Math.round(c.hiddenSec / 60)} min.`);
  doc.setFontSize(11);
  for (const e of extra) { const l = wrap(doc, e, w - 2 * M); if (y + l.length * 14 > h - 48) { doc.addPage('a4', 'portrait'); y = header(doc, testTitle, `Result for ${s.name} (continued)`); } doc.text(l, M, y); y += l.length * 14 + 6; }
}

/** Class mark sheet (landscape) plus, optionally, one page per student. */
export function resultsPdf(test: TestPublic, students: PrintStudent[], opts: { className?: string; sheet?: boolean; pages?: boolean } = {}): jsPDF {
  const sheet = opts.sheet ?? true, pages = opts.pages ?? true;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: sheet ? 'landscape' : 'portrait' });
  const max = test.tasks.reduce((s, x) => s + x.marks, 0);
  const sub = `${opts.className ? `${opts.className}, ` : ''}${students.length} student(s), ${test.tasks.length} checkpoints, ${max} marks. Printed ${fmtDate(new Date().toISOString())}.`;
  if (sheet) {
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    let y = header(doc, `${test.title}: mark sheet`, sub);
    const nameW = 170, totW = 46, pW = 36, noW = 24;
    const colW = Math.max(18, Math.min(40, (w - 2 * M - noW - nameW - totW - pW) / Math.max(1, test.tasks.length)));
    const xTask = (i: number) => M + noW + nameW + i * colW;
    const xTot = xTask(test.tasks.length), xPct = xTot + totW;
    const head = () => {
      doc.setFont('times', 'bold'); doc.setFontSize(9.5);
      doc.text('No.', M, y); doc.text('Student', M + noW, y);
      test.tasks.forEach((t, i) => { doc.text(`T${i + 1}`, xTask(i) + colW / 2, y - 9, { align: 'center' }); doc.setFont('times', 'normal'); doc.text(`/${t.marks}`, xTask(i) + colW / 2, y, { align: 'center' }); doc.setFont('times', 'bold'); });
      doc.text('Total', xTot + totW - 4, y, { align: 'right' }); doc.text('%', xPct + pW - 4, y, { align: 'right' });
      doc.setFont('times', 'normal'); y += 5; doc.setLineWidth(0.5); doc.line(M, y, xPct + pW, y); y += 13;
    };
    y += 8; head();
    students.forEach((s, n) => {
      if (y > h - 60) { doc.addPage('a4', 'landscape'); y = header(doc, `${test.title}: mark sheet (continued)`, sub) + 8; head(); }
      doc.setFontSize(10);
      doc.text(String(n + 1), M, y);
      doc.text(wrap(doc, s.name, nameW - 8)[0], M + noW, y);
      s.tasks.forEach((t, i) => doc.text(s.score === null ? '' : String(t.marks), xTask(i) + colW / 2, y, { align: 'center' }));
      const final = s.score === null ? null : Math.max(0, Math.min(s.max, s.score + (s.adjust ?? 0)));
      doc.text(final === null ? 'not marked' : String(final), xTot + totW - 4, y, { align: 'right' });
      doc.text(final === null ? '' : String(pct(final, s.max)), xPct + pW - 4, y, { align: 'right' });
      doc.setDrawColor(210); doc.setLineWidth(0.3); doc.line(M, y + 5, xPct + pW, y + 5); doc.setDrawColor(0);
      y += 17;
    });
    // averages per checkpoint
    const marked = students.filter((s) => s.score !== null);
    if (marked.length) {
      doc.setFont('times', 'bold'); doc.setFontSize(10);
      doc.text('Average', M + noW, y);
      test.tasks.forEach((_, i) => { const a = marked.reduce((sum, s) => sum + (s.tasks[i]?.marks ?? 0), 0) / marked.length; doc.text(a.toFixed(1), xTask(i) + colW / 2, y, { align: 'center' }); });
      const avg = marked.reduce((sum, s) => sum + Math.max(0, Math.min(s.max, s.score! + (s.adjust ?? 0))), 0) / marked.length;
      doc.text(avg.toFixed(1), xTot + totW - 4, y, { align: 'right' }); doc.text(String(pct(avg, max)), xPct + pW - 4, y, { align: 'right' });
      doc.setFont('times', 'normal'); y += 22;
    }
    // checkpoint key
    const keyHead = () => { doc.setFont('times', 'bold'); doc.setFontSize(11.5); doc.text('Checkpoints', M, y); doc.setFont('times', 'normal'); y += 16; };
    if (y > h - 90) { doc.addPage('a4', 'landscape'); y = header(doc, `${test.title}: checkpoints`, sub); }
    keyHead();
    test.tasks.forEach((t, i) => {
      doc.setFontSize(10);
      const met = marked.filter((s) => s.tasks[i]?.ok).length;
      const l = wrap(doc, t.text, w - 2 * M - 150);
      if (y + l.length * 12.5 > h - 48) { doc.addPage('a4', 'landscape'); y = header(doc, `${test.title}: checkpoints (continued)`, sub); keyHead(); }
      doc.text(`T${i + 1}`, M, y); doc.text(l, M + 30, y);
      doc.text(`${t.marks} mark${t.marks === 1 ? '' : 's'}${marked.length ? `, met by ${met} of ${marked.length}` : ''}`, w - M, y, { align: 'right' });
      y += l.length * 12.5 + 5;
    });
  }
  if (pages) students.forEach((s, i) => studentPages(doc, test.title, s, !sheet && i === 0));
  footer(doc, test.title);
  return doc;
}

/** A single student's result sheet. */
export function studentResultPdf(testTitle: string, s: PrintStudent): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  studentPages(doc, testTitle, s, true);
  footer(doc, testTitle);
  return doc;
}

export const pdfBytes = (doc: jsPDF) => new Uint8Array(doc.output('arraybuffer'));
