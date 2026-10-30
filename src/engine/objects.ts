// Shared model for the Form and Report designers: section layouts, control
// defaults, property-sheet schema, and one-click / wizard generators.
import type { ControlDef, ControlType, FormDef, GroupLevel, ReportDef, SectionDef, FieldDef } from './types';
import { uid, WowProject } from './project';

export const GRID = 8;

export const CONTROL_LABELS: Record<ControlType, string> = {
  label: 'Label', textbox: 'Text Box', combobox: 'Combo Box', listbox: 'List Box', checkbox: 'Check Box',
  option: 'Option Button', toggle: 'Toggle Button', button: 'Command Button', datepicker: 'Date Picker',
  image: 'Image', line: 'Line', rectangle: 'Rectangle', subform: 'Subform/Subreport', navigation: 'Navigation Control',
  pagenumber: 'Page Number', datetime: 'Date and Time',
};

export const FORM_TOOLBOX: ControlType[] = ['label', 'textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'button', 'datepicker', 'image', 'line', 'rectangle', 'subform', 'navigation'];
export const REPORT_TOOLBOX: ControlType[] = ['label', 'textbox', 'image', 'line', 'rectangle', 'pagenumber', 'datetime', 'checkbox', 'subform'];

export const BUTTON_ACTIONS = ['None', 'Go To First Record', 'Go To Previous Record', 'Go To Next Record', 'Go To Last Record', 'New Record', 'Save Record', 'Delete Record', 'Undo Record', 'Refresh', 'Close Form', 'Open Form', 'Open Report', 'Run Query', 'Run Macro', 'Print Form', 'Show Message'];
export const MACRO_ACTIONS = ['OpenForm', 'OpenReport', 'OpenTable', 'OpenQuery', 'RunQuery', 'MessageBox', 'CloseActiveObject'];

const D = (type: ControlType): Partial<ControlDef> & { props: ControlDef['props'] } => {
  const base = { fontName: 'Segoe UI', fontSize: 10, foreColor: '#1f1f1f', textAlign: 'Left' as string };
  switch (type) {
    case 'label': return { w: 104, h: 22, props: { ...base, caption: 'Label', backStyle: 'Transparent', borderStyle: 'Transparent' } };
    case 'textbox': return { w: 168, h: 22, props: { ...base, controlSource: '', backColor: '#ffffff', backStyle: 'Normal', borderStyle: 'Solid', borderColor: '#a6a6a6' } };
    case 'combobox': return { w: 168, h: 22, props: { ...base, controlSource: '', rowSourceType: 'Table/Query', rowSource: '', boundField: '', displayField: '', limitToList: true, backColor: '#ffffff', borderStyle: 'Solid', borderColor: '#a6a6a6' } };
    case 'listbox': return { w: 168, h: 88, props: { ...base, controlSource: '', rowSourceType: 'Table/Query', rowSource: '', boundField: '', displayField: '', backColor: '#ffffff', borderStyle: 'Solid', borderColor: '#a6a6a6' } };
    case 'checkbox': return { w: 20, h: 20, props: { controlSource: '' } };
    case 'option': return { w: 20, h: 20, props: { controlSource: '', optionValue: 1 } };
    case 'toggle': return { w: 104, h: 26, props: { ...base, caption: 'Toggle', controlSource: '', textAlign: 'Center' } };
    case 'button': return { w: 112, h: 28, props: { ...base, caption: 'Command', onClick: 'None', onClickArgument: '', textAlign: 'Center', backColor: '#f3f3f3', borderStyle: 'Solid', borderColor: '#8a8a8a' } };
    case 'datepicker': return { w: 144, h: 22, props: { ...base, controlSource: '', format: 'Short Date', backColor: '#ffffff', borderStyle: 'Solid', borderColor: '#a6a6a6' } };
    case 'image': return { w: 120, h: 88, props: { picture: '', controlSource: '', sizeMode: 'Zoom', borderStyle: 'Solid', borderColor: '#c8c8c8' } };
    case 'line': return { w: 168, h: 8, props: { borderColor: '#404040', borderWidth: 1 } };
    case 'rectangle': return { w: 168, h: 80, props: { backStyle: 'Transparent', backColor: '#ffffff', borderStyle: 'Solid', borderColor: '#404040', borderWidth: 1 } };
    case 'subform': return { w: 400, h: 160, props: { sourceObject: '', linkMasterFields: '', linkChildFields: '', borderStyle: 'Solid', borderColor: '#a6a6a6' } };
    case 'navigation': return { w: 520, h: 240, props: { navTargets: '', borderStyle: 'Solid', borderColor: '#a6a6a6' } };
    case 'pagenumber': return { w: 176, h: 20, props: { ...base, pageFormat: 'Page N of M', textAlign: 'Right' } };
    case 'datetime': return { w: 200, h: 20, props: { ...base, format: 'Long Date', showTime: false, textAlign: 'Right' } };
  }
};

export function newControl(type: ControlType, section: string, x: number, y: number, existing: ControlDef[]): ControlDef {
  const d = D(type);
  const base = CONTROL_LABELS[type].replace(/[^A-Za-z]/g, '');
  let n = 1;
  const names = new Set(existing.map((c) => c.name.toLowerCase()));
  while (names.has((base + n).toLowerCase())) n++;
  return { id: uid('ctl'), type, section, x, y, w: d.w!, h: d.h!, name: base + n, props: { ...d.props, tabIndex: existing.filter((c) => isTabStop(c.type)).length } };
}

export function isTabStop(t: ControlType) { return ['textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'button', 'datepicker'].includes(t); }
export function isBindable(t: ControlType) { return ['textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'datepicker', 'image'].includes(t); }

export function section(kind: SectionDef['kind'], name: string, height: number, extra: Partial<SectionDef> = {}): SectionDef {
  return { id: uid('sec'), kind, name, height, visible: true, backColor: '#ffffff', ...extra };
}

export function newFormDef(name: string, recordSource = ''): FormDef {
  return {
    name, recordSource, caption: name, defaultView: 'Single Form', allowAdditions: true, allowEdits: true, allowDeletions: true, navigationButtons: true, width: 640,
    sections: [section('formHeader', 'Form Header', 64, { backColor: '#e8eef7' }), section('detail', 'Detail', 280), section('formFooter', 'Form Footer', 40, { backColor: '#f2f2f2' })],
    controls: [],
  };
}

export function newReportDef(name: string, recordSource = ''): ReportDef {
  return {
    name, recordSource, caption: name, width: 698,
    sections: [section('reportHeader', 'Report Header', 64), section('pageHeader', 'Page Header', 32, { backColor: '#f2f2f2' }), section('detail', 'Detail', 26), section('pageFooter', 'Page Footer', 32), section('reportFooter', 'Report Footer', 40)],
    controls: [], groups: [], page: { size: 'A4', orientation: 'Portrait', margin: 48 },
  };
}

/** Insert group header/footer sections for group level i in the right place. */
export function syncGroupSections(def: ReportDef): ReportDef {
  const groups = def.groups;
  let sections = def.sections.filter((s) => s.kind !== 'groupHeader' && s.kind !== 'groupFooter');
  const keep = def.sections.filter((s) => s.kind === 'groupHeader' || s.kind === 'groupFooter');
  const headers: SectionDef[] = [], footers: SectionDef[] = [];
  groups.forEach((g, i) => {
    if (g.isSort) return;
    if (g.header) headers.push(keep.find((s) => s.kind === 'groupHeader' && s.groupIndex === i) ?? section('groupHeader', `${g.field} Header`, 30, { groupIndex: i, backColor: '#ffffff' }));
    if (g.footer) footers.unshift(keep.find((s) => s.kind === 'groupFooter' && s.groupIndex === i) ?? section('groupFooter', `${g.field} Footer`, 30, { groupIndex: i }));
  });
  headers.forEach((s) => { s.name = `${groups[s.groupIndex!].field} Header`; });
  footers.forEach((s) => { s.name = `${groups[s.groupIndex!].field} Footer`; });
  const di = sections.findIndex((s) => s.kind === 'detail');
  sections = [...sections.slice(0, di), ...headers, sections[di], ...footers, ...sections.slice(di + 1)];
  const ids = new Set(sections.map((s) => s.id));
  return { ...def, sections, controls: def.controls.filter((c) => ids.has(c.section)) };
}

export function newGroup(field: string, isSort = false): GroupLevel {
  return { id: uid('g'), field, order: 'Ascending', header: !isSort, footer: false, isSort };
}

function controlForField(f: { name: string; type?: string; lookup?: FieldDef['lookup']; textAlign?: FieldDef['textAlign'] }, sectionId: string, x: number, y: number, all: ControlDef[]): ControlDef {
  const type: ControlType = f.type === 'Yes/No' ? 'checkbox' : f.lookup ? 'combobox' : f.type === 'Date/Time' ? 'datepicker' : f.type === 'Attachment' ? 'image' : 'textbox';
  const c = newControl(type, sectionId, x, y, all);
  c.name = f.name.replace(/\s+/g, '');
  if (all.some((o) => o.name.toLowerCase() === c.name.toLowerCase())) c.name += '_' + all.length;
  c.props.controlSource = f.name;
  if (type === 'combobox' && f.lookup) {
    c.props.rowSourceType = f.lookup.rowSourceType; c.props.rowSource = f.lookup.rowSource;
    c.props.boundField = f.lookup.boundField ?? ''; c.props.displayField = f.lookup.displayField ?? '';
  }
  if (f.type === 'Long Text') c.h = 66;
  if (f.type === 'Currency') { c.props.format = 'Currency'; c.props.textAlign = 'Right'; }
  if (f.textAlign && f.textAlign !== 'General') c.props.textAlign = f.textAlign;
  if (type === 'image') { c.w = 120; c.h = 88; }
  return c;
}

/** Create > Form: a single-record form with a label and control per field. */
export function autoForm(p: WowProject, source: string, name: string, fields?: string[], view: FormDef['defaultView'] = 'Single Form'): FormDef {
  const def = newFormDef(name, source);
  def.defaultView = view;
  const t = p.getTable(source);
  const all = (t ? t.fields.map((f) => ({ name: f.name, type: f.type, lookup: f.lookup, caption: f.caption })) : p.columnsOf(source).map((c) => ({ name: c, type: undefined, lookup: undefined, caption: undefined })))
    .filter((f) => !fields || fields.includes(f.name));
  const header = def.sections[0], detail = def.sections[1];
  const title = newControl('label', header.id, 16, 14, def.controls);
  title.name = 'Title'; title.w = 420; title.h = 34; title.props = { ...title.props, caption: name, fontSize: 18, fontWeight: 'Bold', foreColor: '#1e3a6e' };
  def.controls.push(title);
  if (view === 'Continuous Forms') {
    let x = 16;
    detail.height = 30;
    for (const f of all) {
      const lbl = newControl('label', header.id, x, 44, def.controls);
      lbl.props.caption = f.caption || f.name; lbl.w = 128; lbl.h = 18; lbl.props.fontWeight = 'Bold'; lbl.props.fontSize = 9;
      def.controls.push(lbl);
      const c = controlForField(f, detail.id, x, 4, def.controls); c.w = f.type === 'Yes/No' ? 20 : 128; c.h = f.type === 'Yes/No' ? 20 : 22;
      def.controls.push(c);
      x += 136;
    }
    header.height = 68;
    def.width = Math.max(640, x + 16);
    return def;
  }
  let y = 16;
  for (const f of all) {
    const lbl = newControl('label', detail.id, 16, y, def.controls);
    lbl.props.caption = (f.caption || f.name) + ':'; lbl.w = 136; lbl.name = 'Label_' + f.name.replace(/\s+/g, '');
    def.controls.push(lbl);
    const c = controlForField(f, detail.id, 160, y, def.controls);
    c.w = c.type === 'checkbox' ? 20 : c.w; if (c.type === 'textbox' || c.type === 'combobox') c.w = 240;
    def.controls.push(c);
    y += Math.max(c.h, 22) + 10;
  }
  detail.height = Math.max(120, y + 16);
  return def;
}

/** Create > Report: tabular report with column headings, optional grouping and totals. */
export function autoReport(p: WowProject, source: string, name: string, opts: { fields?: string[]; groupBy?: string; sortBy?: string; totals?: string[]; orientation?: 'Portrait' | 'Landscape' } = {}): ReportDef {
  let def = newReportDef(name, source);
  def.page.orientation = opts.orientation ?? 'Portrait';
  const t = p.getTable(source);
  const guess = (c: string) => { for (const tt of p.tables()) { const f = tt.fields.find((x) => x.name.toLowerCase() === c.toLowerCase()); if (f) return f.type === 'Calculated' ? (f.resultType === 'Currency' ? 'Currency' : f.resultType === 'Number' ? 'Number' : 'Short Text') : f.type; } return ''; };
  const cols = (t ? t.fields.map((f) => ({ name: f.name, type: f.type as string, caption: f.caption })) : p.columnsOf(source).map((c) => ({ name: c, type: guess(c) as string, caption: undefined })))
    .filter((f) => (!opts.fields || opts.fields.includes(f.name)) && f.name !== opts.groupBy);
  const width = (def.page.orientation === 'Landscape' ? 1123 : 794) - 96;
  def.width = width;
  if (opts.groupBy) { def.groups = [newGroup(opts.groupBy)]; def.groups[0].footer = !!opts.totals?.length; }
  if (opts.sortBy) def.groups.push(newGroup(opts.sortBy, true));
  def = syncGroupSections(def);
  const s = (k: SectionDef['kind']) => def.sections.find((x) => x.kind === k)!;
  const title = newControl('label', s('reportHeader').id, 0, 12, def.controls);
  title.name = 'Title'; title.w = 460; title.h = 34; title.props = { ...title.props, caption: name, fontSize: 18, fontWeight: 'Bold', foreColor: '#1e3a6e' };
  def.controls.push(title);
  const dt = newControl('datetime', s('reportHeader').id, width - 210, 18, def.controls); dt.w = 210;
  def.controls.push(dt);
  const colW = Math.max(60, Math.floor(width / Math.max(1, cols.length)));
  cols.forEach((f, i) => {
    const h = newControl('label', s('pageHeader').id, i * colW, 6, def.controls);
    h.w = colW - 6; h.h = 20; h.props.caption = f.caption || f.name; h.props.fontWeight = 'Bold'; h.name = 'Head_' + f.name.replace(/\s+/g, '');
    const num = ['Number', 'Currency', 'AutoNumber', 'Large Number'].includes(f.type);
    if (num) h.props.textAlign = 'Right';
    def.controls.push(h);
    const c = newControl('textbox', s('detail').id, i * colW, 2, def.controls);
    c.w = colW - 6; c.h = 20; c.props.controlSource = f.name; c.props.borderStyle = 'Transparent'; c.props.backStyle = 'Transparent'; c.name = f.name.replace(/\s+/g, '');
    if (f.type === 'Currency') c.props.format = 'Currency';
    if (f.type === 'Date/Time') c.props.format = 'Short Date';
    if (num) c.props.textAlign = 'Right';
    def.controls.push(c);
  });
  const line = newControl('line', s('pageHeader').id, 0, 28, def.controls); line.w = width; line.h = 4;
  def.controls.push(line);
  if (opts.groupBy) {
    const gh = def.sections.find((x) => x.kind === 'groupHeader')!;
    const g = newControl('textbox', gh.id, 0, 4, def.controls);
    g.w = 320; g.props.controlSource = opts.groupBy; g.props.fontWeight = 'Bold'; g.props.fontSize = 12; g.props.borderStyle = 'Transparent'; g.props.backStyle = 'Transparent'; g.name = 'Group_' + opts.groupBy.replace(/\s+/g, '');
    def.controls.push(g);
    const gf = def.sections.find((x) => x.kind === 'groupFooter');
    if (gf) addTotals(def, gf, cols, colW, opts.totals ?? [], 'Subtotal');
  }
  if (opts.totals?.length) addTotals(def, s('reportFooter'), cols, colW, opts.totals, 'Grand total');
  const cnt = newControl('textbox', s('reportFooter').id, 0, 22, def.controls); cnt.w = 240; cnt.props.controlSource = '="Records: " & Count(*)'; cnt.props.borderStyle = 'Transparent'; cnt.props.backStyle = 'Transparent'; cnt.name = 'RecordCount';
  def.controls.push(cnt);
  s('reportFooter').height = 46;
  const pn = newControl('pagenumber', s('pageFooter').id, width - 180, 8, def.controls);
  def.controls.push(pn);
  return def;
}

function addTotals(def: ReportDef, sec: SectionDef, cols: { name: string; type?: string }[], colW: number, totals: string[], label: string) {
  const lbl = newControl('label', sec.id, 0, 4, def.controls); lbl.props.caption = label; lbl.props.fontWeight = 'Bold'; lbl.w = 120;
  def.controls.push(lbl);
  cols.forEach((f, i) => {
    if (!totals.includes(f.name)) return;
    const c = newControl('textbox', sec.id, i * colW, 4, def.controls);
    c.w = colW - 6; c.h = 20; c.props.controlSource = `=Sum([${f.name}])`; c.props.fontWeight = 'Bold'; c.props.textAlign = 'Right'; c.props.borderStyle = 'Transparent'; c.props.backStyle = 'Transparent';
    const det = def.controls.find((x) => x.props.controlSource === f.name && def.sections.find((s) => s.id === x.section)?.kind === 'detail');
    c.props.format = det?.props.format ?? (f.type === 'Currency' ? 'Currency' : 'Standard');
    c.name = `${label.replace(/\s/g, '')}_${f.name.replace(/\s+/g, '')}`;
    def.controls.push(c);
  });
}

// ---------------- property sheet schema ----------------
export type PropKind = 'text' | 'number' | 'color' | 'select' | 'bool' | 'source' | 'field' | 'expr' | 'object' | 'image' | 'longtext';
export interface PropSpec { key: string; label: string; cat: 'Format' | 'Data' | 'Event' | 'Other'; kind: PropKind; options?: string[]; types?: ControlType[]; help?: string; }

const TEXTUAL: ControlType[] = ['label', 'textbox', 'combobox', 'listbox', 'button', 'toggle', 'datepicker', 'pagenumber', 'datetime'];
const BOUND: ControlType[] = ['textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'datepicker', 'image'];
const BOXED: ControlType[] = ['label', 'textbox', 'combobox', 'listbox', 'button', 'toggle', 'datepicker', 'image', 'rectangle', 'subform', 'navigation', 'pagenumber', 'datetime'];

export const CONTROL_PROPS: PropSpec[] = [
  { key: 'name', label: 'Name', cat: 'Other', kind: 'text' },
  { key: 'caption', label: 'Caption', cat: 'Format', kind: 'text', types: ['label', 'button', 'toggle'] },
  { key: 'format', label: 'Format', cat: 'Format', kind: 'select', options: ['', 'General Number', 'Currency', 'Fixed', 'Standard', 'Percent', 'Short Date', 'Medium Date', 'Long Date', 'Short Time', 'Yes/No'], types: ['textbox', 'combobox', 'datepicker', 'datetime'] },
  { key: 'decimalPlaces', label: 'Decimal Places', cat: 'Format', kind: 'select', options: ['Auto', '0', '1', '2', '3', '4'], types: ['textbox'] },
  { key: 'pageFormat', label: 'Page Format', cat: 'Format', kind: 'select', options: ['Page N of M', 'Page N', 'N'], types: ['pagenumber'] },
  { key: 'showTime', label: 'Show Time', cat: 'Format', kind: 'bool', types: ['datetime'] },
  { key: 'visible', label: 'Visible', cat: 'Format', kind: 'bool' },
  { key: 'x', label: 'Left', cat: 'Format', kind: 'number' },
  { key: 'y', label: 'Top', cat: 'Format', kind: 'number' },
  { key: 'w', label: 'Width', cat: 'Format', kind: 'number' },
  { key: 'h', label: 'Height', cat: 'Format', kind: 'number' },
  { key: 'backStyle', label: 'Back Style', cat: 'Format', kind: 'select', options: ['Normal', 'Transparent'], types: BOXED },
  { key: 'backColor', label: 'Back Color', cat: 'Format', kind: 'color', types: BOXED },
  { key: 'borderStyle', label: 'Border Style', cat: 'Format', kind: 'select', options: ['Transparent', 'Solid', 'Dashes', 'Dots'], types: BOXED },
  { key: 'borderWidth', label: 'Border Width', cat: 'Format', kind: 'select', options: ['1', '2', '3', '4'], types: [...BOXED, 'line'] },
  { key: 'borderColor', label: 'Border Color', cat: 'Format', kind: 'color', types: [...BOXED, 'line'] },
  { key: 'foreColor', label: 'Fore Color', cat: 'Format', kind: 'color', types: TEXTUAL },
  { key: 'fontName', label: 'Font Name', cat: 'Format', kind: 'select', options: ['Segoe UI', 'Calibri', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'], types: TEXTUAL },
  { key: 'fontSize', label: 'Font Size', cat: 'Format', kind: 'select', options: ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36'], types: TEXTUAL },
  { key: 'fontWeight', label: 'Font Weight', cat: 'Format', kind: 'select', options: ['Normal', 'Semi-bold', 'Bold'], types: TEXTUAL },
  { key: 'italic', label: 'Font Italic', cat: 'Format', kind: 'bool', types: TEXTUAL },
  { key: 'underline', label: 'Font Underline', cat: 'Format', kind: 'bool', types: TEXTUAL },
  { key: 'textAlign', label: 'Text Align', cat: 'Format', kind: 'select', options: ['Left', 'Center', 'Right'], types: TEXTUAL },
  { key: 'padding', label: 'Padding', cat: 'Format', kind: 'number', types: TEXTUAL, help: 'Inner spacing in pixels' },
  { key: 'picture', label: 'Picture', cat: 'Format', kind: 'image', types: ['image'] },
  { key: 'sizeMode', label: 'Size Mode', cat: 'Format', kind: 'select', options: ['Clip', 'Stretch', 'Zoom'], types: ['image'] },
  { key: 'controlSource', label: 'Control Source', cat: 'Data', kind: 'field', types: BOUND, help: 'A field name, or an expression starting with = (e.g. =[Qty]*[Price])' },
  { key: 'inputMask', label: 'Input Mask', cat: 'Data', kind: 'text', types: ['textbox'] },
  { key: 'defaultValue', label: 'Default Value', cat: 'Data', kind: 'expr', types: BOUND },
  { key: 'validationRule', label: 'Validation Rule', cat: 'Data', kind: 'expr', types: ['textbox', 'combobox', 'datepicker'] },
  { key: 'validationText', label: 'Validation Text', cat: 'Data', kind: 'text', types: ['textbox', 'combobox', 'datepicker'] },
  { key: 'rowSourceType', label: 'Row Source Type', cat: 'Data', kind: 'select', options: ['Table/Query', 'Value List'], types: ['combobox', 'listbox'] },
  { key: 'rowSource', label: 'Row Source', cat: 'Data', kind: 'source', types: ['combobox', 'listbox'], help: 'Table/query name, or values separated by ; for a Value List' },
  { key: 'boundField', label: 'Bound Field', cat: 'Data', kind: 'text', types: ['combobox', 'listbox'], help: 'Field of the row source stored in this control' },
  { key: 'displayField', label: 'Display Field', cat: 'Data', kind: 'text', types: ['combobox', 'listbox'], help: 'Field of the row source shown to the user' },
  { key: 'limitToList', label: 'Limit To List', cat: 'Data', kind: 'bool', types: ['combobox'] },
  { key: 'optionValue', label: 'Option Value', cat: 'Data', kind: 'text', types: ['option'] },
  { key: 'sourceObject', label: 'Source Object', cat: 'Data', kind: 'object', types: ['subform'] },
  { key: 'linkMasterFields', label: 'Link Master Fields', cat: 'Data', kind: 'text', types: ['subform'] },
  { key: 'linkChildFields', label: 'Link Child Fields', cat: 'Data', kind: 'text', types: ['subform'] },
  { key: 'navTargets', label: 'Navigation Targets', cat: 'Data', kind: 'longtext', types: ['navigation'], help: 'One per line: form:Name or report:Name' },
  { key: 'enabled', label: 'Enabled', cat: 'Data', kind: 'bool', types: BOUND.concat(['button']) },
  { key: 'locked', label: 'Locked', cat: 'Data', kind: 'bool', types: BOUND },
  { key: 'onClick', label: 'On Click', cat: 'Event', kind: 'select', options: BUTTON_ACTIONS, types: ['button', 'label', 'image'], help: 'Safe built-in actions only (no scripts are executed)' },
  { key: 'onClickArgument', label: 'On Click Argument', cat: 'Event', kind: 'text', types: ['button', 'label', 'image'], help: 'Object name or message for the action' },
  { key: 'tabIndex', label: 'Tab Index', cat: 'Other', kind: 'number', types: ['textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'button', 'datepicker'] },
  { key: 'tabStop', label: 'Tab Stop', cat: 'Other', kind: 'bool', types: ['textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'button', 'datepicker'] },
  { key: 'controlTipText', label: 'ControlTip Text', cat: 'Other', kind: 'text' },
];

export function propsFor(type: ControlType): PropSpec[] {
  return CONTROL_PROPS.filter((p) => !p.types || p.types.includes(type));
}
