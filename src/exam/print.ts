// Printable practical-test results (PDF, Times, plain layout).
//   * resultsPdf: a class mark sheet with every checkpoint and/or one marked
//     paper per student (each checkpoint's marks awarded and the reason).
//   * studentResultPdf: the same marked paper, for a student's own result.
import { jsPDF } from 'jspdf';
import type { Counters, PaperSettings, TestPublic } from '@/cloud/school';
import { drawSchool } from './paper';

export interface PrintTask { text: string; marks: number; max: number; ok: boolean | null; reason: string; }
export interface PrintStudent {
  name: string; email: string; status: string; details?: Record<string, string>; pledgeAt?: string; submittedAt?: string; autoSubmitted?: boolean;
  counters?: Counters;
  score: number | null; max: number; adjust?: number; comment?: string;
  tasks: PrintTask[];
}

const M = 48;                    // page margin (pt)
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

let paper: PaperSettings | undefined;   // school name and logo for the document being made
function header(doc: jsPDF, title: string, sub: string) {
  const w = doc.internal.pageSize.getWidth();
  const top = drawSchool(doc, paper, M, M);
  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.text(clean(title), M, top);
  doc.setFont('times', 'normal'); doc.setFontSize(10.5); doc.text(clean(sub), M, top + 16);
  doc.setLineWidth(0.6); doc.line(M, top + 24, w - M, top + 24);
  return top + 42;
}
const detailText = (s: PrintStudent) => Object.entries(s.details ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
function footer(doc: jsPDF, left: string) {
  const n = doc.getNumberOfPages(); const w = doc.internal.pageSize.getWidth(); const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('times', 'normal'); doc.setFontSize(9); doc.text(left, M, h - 24); doc.text(`Page ${i} of ${n}`, w - M, h - 24, { align: 'right' }); }
}
/** The built-in Times font has no arrows or other symbols: write them as words. */
const clean = (s: string) => s.replace(/\s*→\s*/g, ' to ').replace(/×/g, 'x').replace(/∅/g, '(empty)').replace(/[✓✔]/g, 'yes').replace(/[✗✘]/g, 'no').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
function wrap(doc: jsPDF, s: string, w: number): string[] { return doc.splitTextToSize(clean(s), w) as string[]; }

/** One student's marked paper: every checkpoint with the marks awarded and the reason. */
function studentPages(doc: jsPDF, testTitle: string, s: PrintStudent, first: boolean, className?: string) {
  if (!first) doc.addPage('a4', 'portrait');
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
  const title = `${testTitle}: marked paper`;
  const dt = detailText(s);
  let y = header(doc, title, `${s.name}${dt ? `. ${dt}` : className ? `, ${className}` : ''}${s.email ? `. ${s.email}` : ''}`);
  doc.setFontSize(11);
  const final = s.score === null ? null : Math.max(0, Math.min(s.max, s.score + (s.adjust ?? 0)));
  const lines = [
    `Handed in: ${s.submittedAt ? `${fmtDate(s.submittedAt)}${s.autoSubmitted ? ' (time ran out)' : ''}` : s.status}`,
    ...(s.pledgeAt ? [`Pledge not to cheat taken: ${fmtDate(s.pledgeAt)}`] : []),
    final === null ? 'Not marked yet.' : `Final mark: ${final} out of ${s.max} (${pct(final, s.max)}%)`,
  ];
  for (const l of lines) { doc.text(clean(l), M, y); y += 15; }
  y += 6;
  // checkpoint table
  const cNo = M, cTask = M + 26, cAv = w - M - 92, cAw = w - M;
  const textW = cAv - cTask - 40;
  const head = () => { doc.setFont('times', 'bold'); doc.setFontSize(10.5); doc.text('No.', cNo, y); doc.text('Checkpoint', cTask, y); doc.text('Available', cAv, y, { align: 'right' }); doc.text('Awarded', cAw, y, { align: 'right' }); doc.setFont('times', 'normal'); y += 5; doc.setLineWidth(0.4); doc.line(M, y, w - M, y); y += 13; };
  head();
  s.tasks.forEach((t, i) => {
    doc.setFontSize(11);
    const task = wrap(doc, t.text || `Task ${i + 1}`, textW);
    doc.setFontSize(9.5);
    const reason = t.reason ? wrap(doc, (t.ok === null ? '' : t.ok ? 'Met. ' : 'Not met. ') + t.reason, textW) : [];
    const need = task.length * 13 + reason.length * 11.5 + 8;
    if (y + need > h - 48) { doc.addPage('a4', 'portrait'); y = header(doc, title, `${s.name} (continued)`); head(); }
    doc.setFontSize(11);
    doc.text(String(i + 1), cNo, y);
    doc.text(task, cTask, y);
    doc.text(String(t.max), cAv, y, { align: 'right' });
    doc.setFont('times', 'bold'); doc.text(s.score === null ? '' : String(t.marks), cAw, y, { align: 'right' }); doc.setFont('times', 'normal');
    y += task.length * 13;
    if (reason.length) { doc.setFontSize(9.5); doc.setFont('times', 'italic'); doc.text(reason, cTask, y - 2); doc.setFont('times', 'normal'); y += reason.length * 11.5; }
    doc.setDrawColor(200); doc.setLineWidth(0.3); doc.line(M, y - 4, w - M, y - 4); doc.setDrawColor(0);
    y += 8;
  });
  // totals
  if (y + 70 > h - 48) { doc.addPage('a4', 'portrait'); y = header(doc, title, `${s.name} (continued)`); }
  const raw = s.tasks.reduce((n, t) => n + t.marks, 0);
  doc.setFontSize(11);
  const tot = (label: string, v: string, bold = false) => { doc.setFont('times', bold ? 'bold' : 'normal'); doc.text(label, cAv - 60, y, { align: 'right' }); doc.text(v, cAw, y, { align: 'right' }); y += 15; };
  if (s.score !== null) {
    tot('Checkpoint marks', `${raw} / ${s.max}`);
    if (s.adjust) tot('Teacher adjustment', `${s.adjust > 0 ? '+' : ''}${s.adjust}`);
    tot('Final mark', `${final} / ${s.max}`, true);
  }
  doc.setFont('times', 'normal'); y += 8;
  const extra: string[] = [];
  if (s.comment) extra.push(`Teacher's comment: ${s.comment}`);
  const c = s.counters;
  if (c) extra.push(`During the test: ${c.tabSwitches} tab switch(es), ${c.focusLost} time(s) another window was in front, ${c.fullscreenExits} full-screen exit(s), ${c.pastes} paste(s) (${c.pastedChars} characters), ${c.reloads} reload(s). Active ${Math.round(c.activeSec / 60)} min, idle ${Math.round(c.idleSec / 60)} min, away ${Math.round(c.hiddenSec / 60)} min.`);
  for (const e of extra) { const l = wrap(doc, e, w - 2 * M); if (y + l.length * 14 > h - 48) { doc.addPage('a4', 'portrait'); y = header(doc, title, `${s.name} (continued)`); } doc.text(l, M, y); y += l.length * 14 + 6; }
  if (y + 40 > h - 48) { doc.addPage('a4', 'portrait'); y = header(doc, title, `${s.name} (continued)`); }
  y += 18; doc.setLineWidth(0.4);
  doc.text('Marked by:', M, y); doc.line(M + 58, y + 2, M + 220, y + 2);
  doc.text('Date:', M + 240, y); doc.line(M + 268, y + 2, M + 360, y + 2);
  doc.text('Student:', M + 375, y); doc.line(M + 420, y + 2, w - M, y + 2);
}

/** Class mark sheet (landscape) plus, optionally, one page per student. */
export function resultsPdf(test: TestPublic, students: PrintStudent[], opts: { className?: string; sheet?: boolean; pages?: boolean } = {}): jsPDF {
  paper = test.paper;
  const sheet = opts.sheet ?? true, pages = opts.pages ?? true;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: sheet ? 'landscape' : 'portrait' });
  const max = test.tasks.reduce((s, x) => s + x.marks, 0);
  const sub = `${opts.className ? `${opts.className}, ` : ''}${students.length} student(s), ${test.tasks.length} checkpoints, ${max} marks. Printed ${fmtDate(new Date().toISOString())}.`;
  if (sheet) {
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    let y = header(doc, `${test.title}: mark sheet`, sub);
    const dKeys = (test.paper?.details ?? []).filter((k) => students.some((s) => s.details?.[k]));
    const nameW = dKeys.length ? 140 : 170, dW = dKeys.length ? 100 : 0, totW = 46, pW = 36, noW = 24;
    const colW = Math.max(18, Math.min(40, (w - 2 * M - noW - nameW - dW - totW - pW) / Math.max(1, test.tasks.length)));
    const xTask = (i: number) => M + noW + nameW + dW + i * colW;
    const xTot = xTask(test.tasks.length), xPct = xTot + totW;
    const head = () => {
      doc.setFont('times', 'bold'); doc.setFontSize(9.5);
      doc.text('No.', M, y); doc.text('Student', M + noW, y); if (dW) doc.text(clean(dKeys.join(' / ')), M + noW + nameW, y);
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
      if (dW) doc.text(wrap(doc, dKeys.map((k) => s.details?.[k] ?? '').join(' / '), dW - 6)[0] ?? '', M + noW + nameW, y);
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
  if (pages) students.forEach((s, i) => studentPages(doc, test.title, s, !sheet && i === 0, opts.className));
  footer(doc, test.title);
  return doc;
}

/** A single student's result sheet. */
export function studentResultPdf(testTitle: string, s: PrintStudent, settings?: PaperSettings): jsPDF {
  paper = settings;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  studentPages(doc, testTitle, s, true);
  footer(doc, testTitle);
  return doc;
}

export const pdfBytes = (doc: jsPDF) => new Uint8Array(doc.output('arraybuffer'));
