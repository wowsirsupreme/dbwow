// Printable test papers: the question paper students read before or during the
// test, and the teacher's mark scheme. Both are built as a list of plain
// blocks, then written as PDF (jsPDF, Times) or Word (.docx, Times New Roman).
import { jsPDF } from 'jspdf';
import { DEFAULT_DETAILS, type PaperSettings, type TestKey, type TestPublic } from '@/cloud/school';
import { describeCheck, type Check } from './checks';

export type Block =
  | { t: 'school'; name: string; logo?: string }
  | { t: 'title'; text: string }
  | { t: 'meta'; text: string }
  | { t: 'h'; text: string }
  | { t: 'p'; text: string; italic?: boolean }
  | { t: 'bullets'; items: string[] }
  | { t: 'fill'; labels: string[] }
  | { t: 'task'; n: number; text: string; marks: number; note?: string; code?: string }
  | { t: 'table'; head: string[]; rows: string[][]; widths: number[] }
  | { t: 'rule' }
  | { t: 'end'; text: string };

export interface StartTable { name: string; records: number; fields: { name: string; type: string; key: boolean }[] }
export interface PaperInfo { test: TestPublic; className?: string; startLabel: string; tables?: StartTable[] }

const schoolBlock = (p?: PaperSettings): Block[] => (p && (p.school.trim() || p.logo) ? [{ t: 'school', name: p.school.trim(), logo: p.logo }] : []);

/** Draw the school's logo and name at the top of a PDF page; returns the new y. */
export function drawSchool(doc: jsPDF, p: PaperSettings | undefined, x: number, y: number): number {
  if (!p || !(p.school.trim() || p.logo)) return y;
  let h = 0, w = 0;
  if (p.logo) { try { const ip = doc.getImageProperties(p.logo); h = 42; w = (ip.width / ip.height) * h; doc.addImage(p.logo, 'PNG', x, y - 12, w, h); } catch { h = 0; w = 0; } }
  if (p.school.trim()) { doc.setFont('times', 'bold'); doc.setFontSize(14); doc.text(clean(p.school.trim()), x + (w ? w + 12 : 0), y + (h ? h / 2 - 8 : 0)); }
  return y + Math.max(h, 18) + 4;
}

const total = (t: TestPublic) => t.tasks.reduce((s, x) => s + x.marks, 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** What students need on paper: rules, the database provided and the numbered tasks. */
export function questionPaper(info: PaperInfo): Block[] {
  const { test } = info; const m = total(test);
  const b: Block[] = [
    ...schoolBlock(test.paper),
    { t: 'title', text: test.title },
    { t: 'meta', text: `${info.className ? `${info.className}. ` : ''}Practical test. Time allowed: ${test.durationMin} minutes. Total: ${plural(m, 'mark')}.` },
    { t: 'rule' },
    { t: 'fill', labels: ['Name', ...(test.paper?.details ?? DEFAULT_DETAILS), 'Date'] },
    { t: 'h', text: 'Instructions' },
    { t: 'bullets', items: [
      'Sign in to DBWOW with your own account. Open File > Tests and enter the test code your teacher gives you.',
      `Read the rules on the screen, then press Start. The ${test.durationMin} minutes begin when you press Start and do not stop if you close the page.`,
      'Work only in the test database DBWOW opens for you. Use exactly the table, field, query, form and report names given in the tasks.',
      'Your work is saved automatically. Keep working even if a save message appears; it is kept on this computer as well.',
      `Stay in the DBWOW window${test.settings.requireFullscreen ? ' and keep it in full screen' : ''}. Switching to other tabs or programs, leaving full screen and pasting are recorded and shown to your teacher.`,
      ...(test.settings.allowLearning ? [] : ['The Learning Centre, hints and practical checklists are switched off during the test.']),
      'Press Submit when you have finished. When the time runs out your work is handed in automatically.',
      'The number of marks for each task is shown in brackets [ ].',
    ] },
  ];
  if (test.instructions.trim()) b.push({ t: 'p', text: test.instructions.trim() });
  b.push({ t: 'h', text: 'The database provided' }, { t: 'p', text: info.startLabel });
  for (const tb of info.tables ?? []) {
    b.push({ t: 'p', text: `${tb.name} (${plural(tb.records, 'record')})`, italic: true });
    b.push({ t: 'table', head: ['Field', 'Data type', 'Key'], rows: tb.fields.map((f) => [f.name, f.type, f.key ? 'Primary key' : '']), widths: [0.45, 0.35, 0.2] });
  }
  b.push({ t: 'h', text: 'Tasks' });
  test.tasks.forEach((x, i) => b.push({ t: 'task', n: i + 1, text: x.text, marks: x.marks }));
  b.push({ t: 'end', text: `Total: ${plural(m, 'mark')}. End of paper.` });
  return b;
}

const answerSql = (c: Check) => (c.kind === 'queryResult' || c.kind === 'parameter' || c.kind === 'sql' ? c.sql : undefined);

/** For the teacher: each task, its marks, how DBWOW marks it and the answer. */
export function markScheme(info: PaperInfo, key: TestKey): Block[] {
  const { test } = info;
  const b: Block[] = [
    ...schoolBlock(test.paper),
    { t: 'title', text: `${test.title}: mark scheme` },
    { t: 'meta', text: `Confidential: for teachers only. ${plural(test.tasks.length, 'task')}, ${plural(total(test), 'mark')}, ${test.durationMin} minutes. Test code ${test.code}.` },
    { t: 'rule' },
    { t: 'p', text: 'DBWOW marks each task automatically by checking the student\'s own database. A task earns all of its marks when the check is met and none when it is not. Query answers are compared by their results on the student\'s data, so any correct query earns the marks, whatever the column order. You can adjust any total and add a comment in Results before releasing.' },
    { t: 'h', text: 'Tasks and checks' },
  ];
  test.tasks.forEach((x, i) => {
    const c = key.tasks.find((k) => k.id === x.id)?.check;
    b.push({ t: 'task', n: i + 1, text: x.text, marks: x.marks, note: c ? `Checked: ${describeCheck(c)}${c.kind === 'parameter' ? ` (tried with "${c.value}")` : ''}.` : 'No check saved.', code: c ? answerSql(c) : undefined });
  });
  b.push({ t: 'end', text: `Total: ${plural(total(test), 'mark')}.` });
  return b;
}

// ---------------------------------------------------------------- PDF
const clean = (s: string) => s.replace(/\s*→\s*/g, ' to ').replace(/×/g, 'x').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...');

export function blocksToPdf(blocks: Block[], footerText: string): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 56, R = W - M;
  let y = M;
  const room = (h: number) => { if (y + h > H - 50) { doc.addPage('a4', 'portrait'); y = M; } };
  const lines = (s: string, w: number) => doc.splitTextToSize(clean(s), w) as string[];
  const font = (style: 'normal' | 'bold' | 'italic', size: number, face = 'times') => { doc.setFont(face, style); doc.setFontSize(size); };
  for (const b of blocks) {
    switch (b.t) {
      case 'school': y = drawSchool(doc, { school: b.name, logo: b.logo, details: [] }, M, y) + 6; break;
      case 'title': font('bold', 16); for (const l of lines(b.text, R - M)) { room(20); doc.text(l, M, y); y += 20; } break;
      case 'meta': font('normal', 11); for (const l of lines(b.text, R - M)) { room(14); doc.text(l, M, y); y += 14; } y += 2; break;
      case 'rule': doc.setLineWidth(0.6); doc.line(M, y, R, y); y += 18; break;
      case 'h': room(40); y += 8; font('bold', 12.5); doc.text(clean(b.text), M, y); y += 18; break;
      case 'p': font(b.italic ? 'italic' : 'normal', 11.5); { const l = lines(b.text, R - M); room(l.length * 14.5); doc.text(l, M, y); y += l.length * 14.5 + 5; } break;
      case 'bullets': font('normal', 11.5); for (const it of b.items) { const l = lines(it, R - M - 16); room(l.length * 14.5); doc.text('-', M + 2, y); doc.text(l, M + 16, y); y += l.length * 14.5 + 3; } y += 3; break;
      case 'fill': font('normal', 11.5); for (let r = 0; r < b.labels.length; r += 3) { const row = b.labels.slice(r, r + 3); room(30); const each = (R - M) / 3; row.forEach((lab, i) => { const x = M + i * each; doc.text(clean(`${lab}:`), x, y); const lw = doc.getTextWidth(`${lab}: `); doc.setLineWidth(0.4); doc.line(x + lw, y + 2, x + each - 14, y + 2); }); y += 26; } break;
      case 'table': {
        font('normal', 10.5); const ws = b.widths.map((f) => f * (R - M - 12));
        const row = (cells: string[], bold: boolean) => { font(bold ? 'bold' : 'normal', 10.5); room(14); let x = M + 12; cells.forEach((c, i) => { doc.text(clean(c), x, y); x += ws[i]; }); y += 13.5; };
        row(b.head, true); doc.setLineWidth(0.3); doc.line(M + 12, y - 10, R, y - 10); b.rows.forEach((r) => row(r, false)); y += 6; break;
      }
      case 'task': {
        font('normal', 11.5); const l = lines(b.text, R - M - 70);
        font('normal', 10.5); const note = b.note ? lines(b.note, R - M - 30) : [];
        doc.setFont('courier', 'normal'); doc.setFontSize(9); const code = b.code ? (doc.splitTextToSize(b.code, R - M - 40) as string[]) : [];
        room(l.length * 14.5 + note.length * 13 + code.length * 11 + 14);
        font('bold', 11.5); doc.text(`${b.n}`, M, y);
        font('normal', 11.5); doc.text(l, M + 24, y); doc.text(`[${b.marks}]`, R, y + (l.length - 1) * 14.5, { align: 'right' });
        y += l.length * 14.5;
        if (note.length) { font('italic', 10.5); doc.text(note, M + 24, y); y += note.length * 13; }
        if (code.length) { doc.setFont('courier', 'normal'); doc.setFontSize(9); y += 2; doc.text(code, M + 32, y); y += code.length * 11; }
        y += 10; break;
      }
      case 'end': y += 6; room(20); font('bold', 11.5); doc.text(clean(b.text), M, y); y += 18; break;
    }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); font('normal', 9); doc.text(clean(footerText), M, H - 28); doc.text(`Page ${i} of ${n}`, R, H - 28, { align: 'right' }); }
  return doc;
}

// ---------------------------------------------------------------- Word
export async function blocksToDocx(blocks: Block[], footerText: string): Promise<Uint8Array> {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, TabStopType, BorderStyle, Footer, AlignmentType, PageNumber, ImageRun } = d;
  const FONT = 'Times New Roman';
  const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; font?: string } = {}) => new TextRun({ text, font: o.font ?? FONT, size: o.size ?? 23, bold: o.bold, italics: o.italics });
  const RIGHT = 9020; // twips: A4 text width with 2.5 cm margins
  const kids: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  for (const b of blocks) {
    switch (b.t) {
      case 'school': {
        const parts: InstanceType<typeof TextRun | typeof ImageRun>[] = [];
        const img = b.logo ? pngFromDataUrl(b.logo) : null;
        if (img) parts.push(new ImageRun({ type: 'png', data: img.bytes, transformation: { width: Math.round((img.w / img.h) * 56), height: 56 } }), run('   '));
        if (b.name) parts.push(run(b.name, { bold: true, size: 28 }));
        kids.push(new Paragraph({ children: parts, spacing: { after: 160 } })); break;
      }
      case 'title': kids.push(new Paragraph({ children: [run(b.text, { bold: true, size: 32 })], spacing: { after: 80 } })); break;
      case 'meta': kids.push(new Paragraph({ children: [run(b.text, { size: 22 })], spacing: { after: 60 } })); break;
      case 'rule': kids.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } }, spacing: { after: 240 } })); break;
      case 'h': kids.push(new Paragraph({ children: [run(b.text, { bold: true, size: 25 })], spacing: { before: 240, after: 120 }, keepNext: true })); break;
      case 'p': kids.push(new Paragraph({ children: [run(b.text, { italics: b.italic })], spacing: { after: 120 }, keepNext: !!b.italic })); break;
      case 'bullets': for (const it of b.items) kids.push(new Paragraph({ children: [run(it)], bullet: { level: 0 }, spacing: { after: 60 } })); break;
      case 'fill': for (let r = 0; r < b.labels.length; r += 3) kids.push(new Paragraph({ children: b.labels.slice(r, r + 3).flatMap((l, i) => [...(i ? [run('\t')] : []), run(`${l}: ________________`)]), tabStops: [{ type: TabStopType.LEFT, position: 3100 }, { type: TabStopType.LEFT, position: 6100 }], spacing: { after: 240 } })); break;
      case 'table': kids.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [b.head, ...b.rows].map((r, ri) => new TableRow({ children: r.map((c, ci) => new TableCell({ width: { size: Math.round(b.widths[ci] * 100), type: WidthType.PERCENTAGE }, borders: { top: none, left: none, right: none, bottom: ri === 0 ? { style: BorderStyle.SINGLE, size: 4, color: '000000' } : none }, children: [new Paragraph({ children: [run(c, { bold: ri === 0, size: 21 })] })] })) })),
      }), new Paragraph({ children: [], spacing: { after: 120 } })); break;
      case 'task':
        kids.push(new Paragraph({ children: [run(`${b.n}`, { bold: true }), run('\t'), run(b.text), run('\t'), run(`[${b.marks}]`)], tabStops: [{ type: TabStopType.LEFT, position: 420 }, { type: TabStopType.RIGHT, position: RIGHT }], indent: { left: 420, hanging: 420 }, spacing: { after: b.note || b.code ? 40 : 200 } }));
        if (b.note) kids.push(new Paragraph({ children: [run(b.note, { italics: true, size: 21 })], indent: { left: 420 }, spacing: { after: b.code ? 40 : 200 } }));
        if (b.code) kids.push(new Paragraph({ children: [run(b.code, { font: 'Courier New', size: 18 })], indent: { left: 640 }, spacing: { after: 200 } }));
        break;
      case 'end': kids.push(new Paragraph({ children: [run(b.text, { bold: true })], spacing: { before: 240 } })); break;
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 23 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } } },
      footers: { default: new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: RIGHT }], children: [run(footerText, { size: 18 }), run('\tPage ', { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 })], alignment: AlignmentType.LEFT })] }) },
      children: kids,
    }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/** A PNG data URL as bytes, with its size read from the IHDR chunk. */
function pngFromDataUrl(url: string): { bytes: Uint8Array; w: number; h: number } | null {
  const m = /^data:image\/png;base64,(.+)$/.exec(url); if (!m) return null;
  const bin = atob(m[1]); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const dv = new DataView(bytes.buffer);
  return { bytes, w: dv.getUint32(16), h: dv.getUint32(20) };
}

/** Scale task marks so they add up to `total`, keeping whole numbers and at least 1 mark per task. */
export function spreadMarks(marks: number[], total: number): number[] {
  const sum = marks.reduce((a, b) => a + b, 0);
  if (!marks.length || total < marks.length) return marks;
  const raw = marks.map((m) => (sum ? (m / sum) * total : total / marks.length));
  const out = raw.map((r) => Math.max(1, Math.floor(r)));
  let diff = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; diff > 0; k = (k + 1) % order.length) { out[order[k].i]++; diff--; }
  const big = raw.map((r, i) => ({ i, r })).sort((a, b) => b.r - a.r);
  for (let k = 0; diff < 0; k = (k + 1) % big.length) { if (out[big[k].i] > 1) { out[big[k].i]--; diff++; } }
  return out;
}

/** Turn an uploaded image into a small PNG data URL (at most 240 px tall) for printing. */
export async function logoFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That file is not a picture DBWOW can read. Use a PNG or JPEG.')); i.src = url; });
    const h = Math.min(240, img.naturalHeight), w = Math.max(1, Math.round((img.naturalWidth / img.naturalHeight) * h));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
