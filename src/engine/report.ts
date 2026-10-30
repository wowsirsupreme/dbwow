// Report engine: fetch real records, group/sort them, lay bands out onto pages
// and evaluate expressions (=Sum([Fee]), ="Page " & [Page] & " of " & [Pages]).
// The same page model drives Print Preview, printing and PDF export.
import { jsPDF } from 'jspdf';
import type { ControlDef, ReportDef, SectionDef } from './types';
import { WowProject, WowError } from './project';
import { evalControlSource, formatValue } from './expr';

export const PAGE_SIZES = { A4: { w: 794, h: 1123 }, Letter: { w: 816, h: 1056 } };

export interface PageItem { control: ControlDef; x: number; y: number; text: string; }
export interface PageBand { section: SectionDef; y: number; height: number; }
export interface ReportPage { number: number; bands: PageBand[]; items: PageItem[]; }
export interface ReportLayout { pages: ReportPage[]; width: number; height: number; margin: number; recordCount: number; }

type Rec = Record<string, unknown>;

export function pageSize(def: ReportDef) {
  const s = PAGE_SIZES[def.page.size] ?? PAGE_SIZES.A4;
  return def.page.orientation === 'Landscape' ? { w: s.h, h: s.w } : s;
}

export function fetchRecords(p: WowProject, source: string, params: Record<string, unknown> = {}): Rec[] {
  if (!source) return [];
  const s = p.sourceSql(source);
  const bind: Record<string, unknown> = {};
  s.params.forEach((x) => { bind[x.name] = params[x.prompt] ?? null; });
  return p.db.all(s.sql, s.params.length ? (bind as never) : undefined);
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
function fieldVal(r: Rec, f: string): unknown {
  if (f in r) return r[f];
  const k = Object.keys(r).find((x) => x.toLowerCase() === f.toLowerCase());
  return k ? r[k] : null;
}

interface Band { section: SectionDef; record?: Rec; records: Rec[]; }

/** Expand the report into an ordered list of bands (before pagination). */
export function buildBands(def: ReportDef, records: Rec[]): Band[] {
  const levels = def.groups.filter((g) => g.field);
  const sorted = [...records].sort((a, b) => {
    for (const g of levels) {
      const c = cmp(fieldVal(a, g.field), fieldVal(b, g.field));
      if (c) return g.order === 'Descending' ? -c : c;
    }
    return 0;
  });
  const sec = (kind: SectionDef['kind'], gi?: number) => def.sections.find((s) => s.kind === kind && (gi === undefined || s.groupIndex === gi) && s.visible !== false);
  const bands: Band[] = [];
  const rh = sec('reportHeader'); if (rh) bands.push({ section: rh, records: sorted, record: sorted[0] });
  const groupLevels = levels.map((g, i) => ({ g, i })).filter((x) => !x.g.isSort && (x.g.header || x.g.footer));
  const walk = (recs: Rec[], depth: number) => {
    if (depth >= groupLevels.length) {
      const d = sec('detail');
      for (const r of recs) if (d) bands.push({ section: d, record: r, records: [r] });
      return;
    }
    const { g, i } = groupLevels[depth];
    let start = 0;
    while (start < recs.length) {
      const key = fieldVal(recs[start], g.field);
      let end = start + 1;
      while (end < recs.length && cmp(fieldVal(recs[end], g.field), key) === 0) end++;
      const chunk = recs.slice(start, end);
      const h = g.header ? sec('groupHeader', i) : undefined;
      if (h) bands.push({ section: h, record: chunk[0], records: chunk });
      walk(chunk, depth + 1);
      const f = g.footer ? sec('groupFooter', i) : undefined;
      if (f) bands.push({ section: f, record: chunk[chunk.length - 1], records: chunk });
      start = end;
    }
  };
  walk(sorted, 0);
  const rf = sec('reportFooter'); if (rf) bands.push({ section: rf, records: sorted, record: sorted[sorted.length - 1] });
  return bands;
}

export function layoutReport(p: WowProject, def: ReportDef, params: Record<string, unknown> = {}, preloaded?: Rec[]): ReportLayout {
  const records = preloaded ?? fetchRecords(p, def.recordSource, params);
  const { w, h } = pageSize(def);
  const margin = def.page.margin ?? 48;
  const bands = buildBands(def, records);
  const ph = def.sections.find((s) => s.kind === 'pageHeader' && s.visible !== false);
  const pf = def.sections.find((s) => s.kind === 'pageFooter' && s.visible !== false);
  const bottomLimit = h - margin - (pf?.height ?? 0);
  if ((ph?.height ?? 0) + (pf?.height ?? 0) + margin * 2 >= h) throw new WowError('The page header and footer are taller than the page. Make them smaller or reduce the margins.');

  type Placed = { band: Band; y: number };
  const pages: { placed: Placed[]; recs: Rec[] }[] = [];
  let cur: { placed: Placed[]; recs: Rec[] } | null = null;
  let y = 0;
  const newPage = (first = false) => {
    cur = { placed: [], recs: [] };
    pages.push(cur);
    y = margin;
    // on page 1 the Report Header prints first, then the Page Header
    if (ph && !(first && bands[0]?.section.kind === 'reportHeader')) { cur.placed.push({ band: { section: ph, records: [] }, y }); y += ph.height; }
  };
  newPage(true);
  for (const b of bands) {
    if (b.section.forceNewPage === 'Before Section' && cur!.placed.some((x) => x.band.section.kind !== 'pageHeader')) newPage();
    const bh = b.section.height;
    if (y + bh > bottomLimit && cur!.placed.some((x) => x.band.section.kind !== 'pageHeader')) newPage();
    if (bh > bottomLimit - margin) throw new WowError(`The "${b.section.name}" section is taller than the printable page.`);
    cur!.placed.push({ band: b, y });
    if (b.section.kind === 'detail' && b.record) cur!.recs.push(b.record);
    y += bh;
    if (b.section.kind === 'reportHeader' && ph && pages.length === 1 && b.section.forceNewPage !== 'After Section') { cur!.placed.push({ band: { section: ph, records: [] }, y }); y += ph.height; }
    if (b.section.forceNewPage === 'After Section' && b !== bands[bands.length - 1]) newPage();
  }
  const total = pages.length;
  const out: ReportPage[] = pages.map((pg, idx) => {
    const number = idx + 1;
    const placed = [...pg.placed];
    if (pf) placed.push({ band: { section: pf, records: pg.recs, record: pg.recs[0] }, y: h - margin - pf.height });
    const items: PageItem[] = [];
    for (const pl of placed) {
      for (const c of def.controls.filter((x) => x.section === pl.band.section.id)) {
        if (c.props.visible === false) continue;
        items.push({ control: c, x: margin + c.x, y: pl.y + c.y, text: controlText(c, { record: pl.band.record, records: pl.band.records, page: number, pages: total, params }) });
      }
    }
    return { number, bands: placed.map((pl) => ({ section: pl.band.section, y: pl.y, height: pl.band.section.height })), items };
  });
  return { pages: out, width: w, height: h, margin, recordCount: records.length };
}

/** Text shown by a report/form control for a given context. */
export function controlText(c: ControlDef, ctx: { record?: Rec; records?: Rec[]; page?: number; pages?: number; params?: Record<string, unknown> }): string {
  switch (c.type) {
    case 'label': case 'button': case 'toggle': return String(c.props.caption ?? '');
    case 'pagenumber': {
      const fmt = String(c.props.pageFormat ?? 'Page N of M');
      return fmt === 'Page N' ? `Page ${ctx.page ?? 1}` : fmt === 'N' ? String(ctx.page ?? 1) : `Page ${ctx.page ?? 1} of ${ctx.pages ?? 1}`;
    }
    case 'datetime': {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const date = formatValue(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, String(c.props.format ?? 'Long Date'));
      return c.props.showTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
    }
    case 'textbox': case 'combobox': case 'datepicker': case 'listbox': {
      const src = String(c.props.controlSource ?? '');
      const v = evalControlSource(src, ctx);
      return formatValue(v, String(c.props.format ?? ''), c.props.decimalPlaces === undefined || c.props.decimalPlaces === 'Auto' ? undefined : Number(c.props.decimalPlaces));
    }
    case 'checkbox': case 'option': {
      const v = evalControlSource(String(c.props.controlSource ?? ''), ctx);
      return v && v !== '0' ? '☑' : '☐';
    }
    default: return '';
  }
}

// ---------------- PDF ----------------
function hexToRgb(hex: string | undefined): [number, number, number] | null {
  if (!hex || hex === 'transparent') return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function reportToPdf(layout: ReportLayout, title: string): jsPDF {
  const k = 0.75; // px → pt
  const orientation = layout.width > layout.height ? 'landscape' : 'portrait';
  const doc = new jsPDF({ unit: 'pt', format: [layout.width * k, layout.height * k], orientation });
  doc.setProperties({ title, creator: 'DBWOW' });
  layout.pages.forEach((pg, i) => {
    if (i > 0) doc.addPage([layout.width * k, layout.height * k], orientation);
    for (const b of pg.bands) {
      const bg = hexToRgb(b.section.backColor);
      if (bg && b.section.backColor?.toLowerCase() !== '#ffffff') { doc.setFillColor(...bg); doc.rect(layout.margin * k, b.y * k, (layout.width - layout.margin * 2) * k, b.height * k, 'F'); }
    }
    for (const it of pg.items) drawItem(doc, it, k);
  });
  return doc;
}

function drawItem(doc: jsPDF, it: PageItem, k: number) {
  const c = it.control, pr = c.props;
  const x = it.x * k, y = it.y * k, w = c.w * k, h = c.h * k;
  if (c.type === 'line') {
    const col = hexToRgb(String(pr.borderColor ?? '#000000')) ?? [0, 0, 0];
    doc.setDrawColor(...col); doc.setLineWidth(Number(pr.borderWidth ?? 1) * k);
    if (c.w >= c.h) doc.line(x, y + h / 2, x + w, y + h / 2); else doc.line(x + w / 2, y, x + w / 2, y + h);
    return;
  }
  const bg = hexToRgb(String(pr.backColor ?? ''));
  const bc = pr.borderStyle && pr.borderStyle !== 'Transparent' ? hexToRgb(String(pr.borderColor ?? '#000000')) : null;
  if (bg && pr.backStyle !== 'Transparent') { doc.setFillColor(...bg); doc.rect(x, y, w, h, 'F'); }
  if (bc) { doc.setDrawColor(...bc); doc.setLineWidth(Number(pr.borderWidth ?? 1) * k); doc.rect(x, y, w, h, 'S'); }
  if (c.type === 'image') {
    const src = String(pr.picture ?? '');
    if (src.startsWith('data:image/')) {
      try { doc.addImage(src, src.includes('png') ? 'PNG' : 'JPEG', x, y, w, h); } catch { /* unsupported image */ }
    }
    return;
  }
  if (c.type === 'rectangle' || !it.text) return;
  const fs = Number(pr.fontSize ?? 11);
  const weight = String(pr.fontWeight ?? 'Normal');
  const style = (weight === 'Bold' || weight === 'Semi-bold' ? 'bold' : 'normal') + (pr.italic ? 'italic' : '');
  doc.setFont(String(pr.fontName ?? '').toLowerCase().includes('times') ? 'times' : String(pr.fontName ?? '').toLowerCase().includes('courier') ? 'courier' : 'helvetica', style === 'normalitalic' ? 'italic' : style);
  doc.setFontSize(fs);
  const fc = hexToRgb(String(pr.foreColor ?? '#000000')) ?? [0, 0, 0];
  doc.setTextColor(...fc);
  const align = String(pr.textAlign ?? 'Left').toLowerCase();
  const pad = 2;
  const lines = doc.splitTextToSize(it.text, Math.max(1, w - pad * 2)) as string[];
  const lineH = fs * 1.15;
  const maxLines = Math.max(1, Math.floor((h - pad) / lineH));
  const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - pad : x + pad;
  lines.slice(0, maxLines).forEach((ln, i) => {
    doc.text(ln, tx, y + pad + fs * 0.85 + i * lineH, { align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left' });
  });
}
