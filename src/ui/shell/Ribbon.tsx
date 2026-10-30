'use client';
import type { LucideIcon } from 'lucide-react';
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import * as I from 'lucide-react';
import { useApp } from '../store';
import { availableCommands, runCommand, runCommandValue, useCmdState } from '../commands';
import { showContextMenu } from '../dialogs';

type Icon = LucideIcon;
type Item =
  | { cmd: string; label: string; icon: Icon; size?: 'lg' | 'sm'; tip?: string }
  | { col: Item[] }
  | { row: Item[] }
  | { pick: string; kind: 'select' | 'color'; label: string; width?: number; options?: string[]; icon?: Icon }
  | { menu: { cmd: string; label: string }[]; label: string; icon: Icon; size?: 'lg' | 'sm'; cmd?: string };
interface Group { label: string; items: Item[]; }
interface RibbonTab { id: string; label: string; groups: Group[]; ctx?: string; }

const TOOL_NAMES: Record<string, string> = { label: 'Label', textbox: 'Text Box', combobox: 'Combo Box', listbox: 'List Box', checkbox: 'Check Box', option: 'Option Button', toggle: 'Toggle Button', button: 'Command Button', datepicker: 'Date Picker', image: 'Image', line: 'Line', rectangle: 'Rectangle', subform: 'Subform/Subreport', navigation: 'Navigation Control', pagenumber: 'Page Number', datetime: 'Date and Time' };
const lg = (cmd: string, label: string, icon: Icon, tip?: string): Item => ({ cmd, label, icon, size: 'lg', tip });
const sm = (cmd: string, label: string, icon: Icon, tip?: string): Item => ({ cmd, label, icon, size: 'sm', tip });
const col = (...items: Item[]): Item => ({ col: items });

const VIEW_MENU: Item = { menu: [{ cmd: 'view.design', label: 'Design View' }, { cmd: 'view.datasheet', label: 'Datasheet View' }, { cmd: 'view.sql', label: 'SQL View' }, { cmd: 'view.form', label: 'Form View' }, { cmd: 'view.preview', label: 'Print Preview' }], label: 'View', icon: I.LayoutGrid, size: 'lg', cmd: 'view.toggle' };

const RECORDS: Group = { label: 'Records', items: [col(sm('home.newRecord', 'New', I.Plus), sm('home.saveRecord', 'Save', I.Save), sm('home.deleteRecord', 'Delete', I.Trash2)), col(sm('home.refresh', 'Refresh All', I.RefreshCw), sm('home.undoRecord', 'Undo Record', I.Undo2))] };


const THEMES: Item = { menu: [{ cmd: 'fd.theme.wowdb', label: 'WOWDB Blue' }, { cmd: 'fd.theme.slate', label: 'Slate' }, { cmd: 'fd.theme.forest', label: 'Forest' }, { cmd: 'fd.theme.sunset', label: 'Sunset' }, { cmd: 'fd.theme.mono', label: 'Monochrome' }], label: 'Themes', icon: I.Palette, size: 'lg' };
const COLORS: Item = { menu: [{ cmd: 'fd.colors.wowdb', label: 'Blue' }, { cmd: 'fd.colors.slate', label: 'Slate' }, { cmd: 'fd.colors.forest', label: 'Green' }, { cmd: 'fd.colors.sunset', label: 'Orange' }, { cmd: 'fd.colors.mono', label: 'Grey' }], label: 'Colors', icon: I.SwatchBook, size: 'sm' };
const FONTS: Item = { menu: [{ cmd: 'fd.fonts.Segoe UI', label: 'Segoe UI' }, { cmd: 'fd.fonts.Calibri', label: 'Calibri' }, { cmd: 'fd.fonts.Arial', label: 'Arial' }, { cmd: 'fd.fonts.Times New Roman', label: 'Times New Roman' }, { cmd: 'fd.fonts.Georgia', label: 'Georgia' }], label: 'Fonts', icon: I.CaseSensitive, size: 'sm' };
const CONTROLS_FORM: Item = { menu: ['label', 'textbox', 'combobox', 'listbox', 'checkbox', 'option', 'toggle', 'button', 'datepicker', 'image', 'line', 'rectangle', 'subform', 'navigation'].map((t) => ({ cmd: `fd.tool.${t}`, label: TOOL_NAMES[t] })), label: 'Controls', icon: I.Wrench, size: 'lg' };
const CONTROLS_REPORT: Item = { menu: ['label', 'textbox', 'image', 'line', 'rectangle', 'pagenumber', 'datetime', 'checkbox', 'subform'].map((t) => ({ cmd: `fd.tool.${t}`, label: TOOL_NAMES[t] })), label: 'Controls', icon: I.Wrench, size: 'lg' };
const TOTALS: Item = { menu: [{ cmd: 'rd.totalSum', label: 'Sum' }, { cmd: 'rd.totalAvg', label: 'Average' }, { cmd: 'rd.totalCount', label: 'Count Records' }, { cmd: 'rd.totalMax', label: 'Max' }, { cmd: 'rd.totalMin', label: 'Min' }], label: 'Totals', icon: I.Sigma, size: 'sm' };
const PAGE_SIZE: Item = { menu: [{ cmd: 'rd.size.A4', label: 'A4 (210 × 297 mm)' }, { cmd: 'rd.size.Letter', label: 'Letter (8.5 × 11 in)' }], label: 'Size', icon: I.FileText, size: 'lg' };
const PAGE_MARGINS: Item = { menu: [{ cmd: 'rd.margin.24', label: 'Narrow (0.25")' }, { cmd: 'rd.margin.48', label: 'Normal (0.5")' }, { cmd: 'rd.margin.96', label: 'Wide (1")' }], label: 'Margins', icon: I.Ruler, size: 'lg' };
const ARRANGE_GROUPS: Group[] = [
  { label: 'Position', items: [{ menu: [{ cmd: 'fd.padding.0', label: 'None' }, { cmd: 'fd.padding.2', label: 'Narrow' }, { cmd: 'fd.padding.5', label: 'Medium' }, { cmd: 'fd.padding.9', label: 'Wide' }], label: 'Control Padding', icon: I.Scan, size: 'lg' }] },
  { label: 'Sizing & Ordering', items: [
    { menu: [{ cmd: 'fd.size.tallest', label: 'To Tallest' }, { cmd: 'fd.size.shortest', label: 'To Shortest' }, { cmd: 'fd.size.widest', label: 'To Widest' }, { cmd: 'fd.size.narrowest', label: 'To Narrowest' }, { cmd: 'fd.toGrid', label: 'To Grid' }, { cmd: 'fd.distH', label: 'Equal Horizontal' }, { cmd: 'fd.distV', label: 'Equal Vertical' }], label: 'Size/ Space', icon: I.Scaling, size: 'lg' },
    { menu: [{ cmd: 'fd.alignLeft', label: 'Left' }, { cmd: 'fd.alignRight', label: 'Right' }, { cmd: 'fd.alignTop', label: 'Top' }, { cmd: 'fd.alignBottom', label: 'Bottom' }, { cmd: 'fd.toGrid', label: 'To Grid' }], label: 'Align', icon: I.AlignStartVertical, size: 'lg' },
    lg('fd.front', 'Bring to Front', I.BringToFront), lg('fd.back', 'Send to Back', I.SendToBack)] },
  { label: 'Align', items: [col(sm('fd.alignLeft', 'Align Left', I.AlignStartVertical), sm('fd.alignRight', 'Align Right', I.AlignEndVertical), sm('fd.alignTop', 'Align Top', I.AlignStartHorizontal)), col(sm('fd.alignBottom', 'Align Bottom', I.AlignEndHorizontal), sm('fd.distH', 'Distribute Across', I.AlignHorizontalDistributeCenter), sm('fd.distV', 'Distribute Down', I.AlignVerticalDistributeCenter)), col(sm('fd.sameWidth', 'Same Width', I.MoveHorizontal), sm('fd.sameHeight', 'Same Height', I.MoveVertical), sm('fd.toGrid', 'To Grid', I.Grid3x3))] },
  { label: 'Group & Edit', items: [col(sm('fd.group', 'Group', I.Group), sm('fd.ungroup', 'Ungroup', I.Ungroup), sm('fd.selectAll', 'Select All', I.SquareDashedMousePointer)), col(sm('fd.duplicate', 'Duplicate', I.Copy), sm('fd.delete', 'Delete', I.Trash2))] },
];
const FONT_NAMES = ['Segoe UI', 'Calibri', 'Arial', 'Tahoma', 'Verdana', 'Times New Roman', 'Georgia', 'Courier New'];
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '36'];
const FORMAT_GROUPS: Group[] = [
  { label: 'Selection', items: [col({ pick: 'fmt.select', kind: 'select', label: 'Object', width: 150 }, sm('fd.selectAll', 'Select All', I.SquareDashedMousePointer))] },
  { label: 'Font', items: [col(
      { row: [{ pick: 'fmt.fontName', kind: 'select', label: 'Font', width: 130, options: FONT_NAMES }, { pick: 'fmt.fontSize', kind: 'select', label: 'Size', width: 52, options: FONT_SIZES }] },
      { row: [sm('fmt.bold', '', I.Bold, 'Bold'), sm('fmt.italic', '', I.Italic, 'Italic'), sm('fmt.underline', '', I.Underline, 'Underline'), { pick: 'fmt.foreColor', kind: 'color', label: 'Font Color', icon: I.Baseline }, sm('fmt.alignL', '', I.AlignLeft, 'Align Left'), sm('fmt.alignC', '', I.AlignCenter, 'Center'), sm('fmt.alignR', '', I.AlignRight, 'Align Right')] }) ] },
  { label: 'Number', items: [col({ pick: 'fmt.format', kind: 'select', label: 'Format', width: 120, options: ['', 'General Number', 'Currency', 'Fixed', 'Standard', 'Percent', 'Short Date', 'Medium Date', 'Long Date', 'Yes/No'] }, { row: [sm('fmt.currency', '', I.DollarSign, 'Currency'), sm('fmt.percent', '', I.Percent, 'Percent'), sm('fmt.comma', '', I.Hash, 'Standard (thousands separator)')] })] },
  { label: 'Background', items: [col({ pick: 'fmt.backColor', kind: 'color', label: 'Background Color', icon: I.PaintBucket }, sm('fmt.transparent', 'Transparent', I.Droplet))] },
  { label: 'Control Formatting', items: [col({ pick: 'fmt.borderColor', kind: 'color', label: 'Shape Outline', icon: I.SquareDashed }, { pick: 'fmt.borderStyle', kind: 'select', label: 'Border', width: 110, options: ['Transparent', 'Solid', 'Dashes', 'Dots'] })] },
];

const TABS: RibbonTab[] = [
  { id: 'home', label: 'HOME', groups: [
    { label: 'Views', items: [VIEW_MENU] },
    { label: 'Clipboard', items: [lg('home.paste', 'Paste', I.ClipboardPaste), col(sm('home.cut', 'Cut', I.Scissors), sm('home.copy', 'Copy', I.Copy))] },
    { label: 'Sort & Filter', items: [lg('home.filter', 'Filter', I.Filter), col(sm('home.sortAsc', 'Ascending', I.ArrowUpAZ), sm('home.sortDesc', 'Descending', I.ArrowDownAZ), sm('home.removeSort', 'Remove Sort', I.ArrowUpDown)), col(sm('home.filterSelection', 'Selection', I.SquareMousePointer), sm('home.toggleFilter', 'Toggle Filter', I.FilterX))] },
    RECORDS,
    { label: 'Find', items: [lg('home.find', 'Find', I.Search), col(sm('home.replace', 'Replace', I.Replace), sm('home.first', 'First Record', I.ChevronsLeft), sm('home.last', 'Last Record', I.ChevronsRight))] },
    { label: 'Navigate', items: [col(sm('home.prev', 'Previous', I.ChevronLeft), sm('home.next', 'Next', I.ChevronRight))] },
  ] },
  { id: 'create', label: 'CREATE', groups: [
    { label: 'Tables', items: [lg('create.table', 'Table', I.Table), lg('create.tableDesign', 'Table Design', I.PencilRuler)] },
    { label: 'Queries', items: [lg('create.queryWizard', 'Query Wizard', I.Wand2), lg('create.queryDesign', 'Query Design', I.Network), lg('create.sql', 'SQL Query', I.Code2)] },
    { label: 'Forms', items: [lg('create.form', 'Form', I.FormInput), lg('create.formDesign', 'Form Design', I.PanelsTopLeft), lg('create.formWizard', 'Form Wizard', I.Wand2)] },
    { label: 'Reports', items: [lg('create.report', 'Report', I.FileBarChart), lg('create.reportDesign', 'Report Design', I.ScrollText), lg('create.reportWizard', 'Report Wizard', I.Wand2)] },
    { label: 'Relationships', items: [lg('create.relationships', 'Relation-ships', I.GitFork)] },
    { label: 'Macros & Code', items: [col(sm('create.macro', 'Macro', I.Workflow), sm('create.module', 'SQL Module', I.FileCode))] },
  ] },
  { id: 'external', label: 'EXTERNAL DATA', groups: [
    { label: 'Import', items: [lg('ext.importWizard', 'Import Wizard', I.Upload), col(sm('ext.importCsv', 'CSV / Text', I.FileText), sm('ext.importExcel', 'Excel', I.FileSpreadsheet), sm('ext.importJson', 'JSON', I.FileJson)), col(sm('ext.importSql', 'SQL Script', I.FileCode), sm('ext.openSqlite', 'SQLite File', I.Database))] },
    { label: 'Export', items: [lg('ext.exportWizard', 'Export Wizard', I.Download), col(sm('ext.exportCsv', 'CSV', I.FileText), sm('ext.exportExcel', 'Excel', I.FileSpreadsheet), sm('ext.exportJson', 'JSON', I.FileJson)), col(sm('ext.exportSql', 'SQL Script', I.FileCode), sm('ext.exportPdf', 'PDF (report)', I.FileDown), sm('ext.exportWorkbook', 'All tables (Excel)', I.Boxes))] },
  ] },
  { id: 'tools', label: 'DATABASE TOOLS', groups: [
    { label: 'Tools', items: [lg('tools.compact', 'Compact & Repair', I.Archive)] },
    { label: 'Relationships', items: [lg('tools.relationships', 'Relation-ships', I.GitFork), lg('tools.dependencies', 'Object Dependencies', I.ListTree)] },
    { label: 'Analyze', items: [lg('tools.documenter', 'Database Documenter', I.ClipboardList), lg('tools.performance', 'Analyze Performance', I.Gauge), lg('tools.integrity', 'Integrity Checker', I.ShieldCheck), lg('tools.statistics', 'Statistics', I.Sigma)] },
    { label: 'Backup', items: [lg('tools.backup', 'Back Up Database', I.Archive), lg('tools.restore', 'Restore', I.ArchiveRestore)] },
  ] },
  { id: 'help', label: 'HELP', groups: [
    { label: 'Learn', items: [lg('help.learning', 'Learning Centre', I.GraduationCap), lg('help.tutorials', 'Tutorials', I.BookOpen), lg('help.exercises', 'Practical Exercises', I.ListChecks), lg('help.learningMode', 'Learning Mode', I.Lightbulb)] },
    { label: 'Reference', items: [lg('help.sqlref', 'SQL Reference', I.Braces), lg('help.shortcuts', 'Keyboard Shortcuts', I.Keyboard), lg('help.about', 'About WOWDB', I.Info)] },
  ] },
  // ---- contextual tabs ----
  { id: 'ctx-table-design', label: 'DESIGN', ctx: 'TABLE TOOLS', groups: [
    { label: 'Views', items: [VIEW_MENU] },
    { label: 'Tools', items: [lg('td.primaryKey', 'Primary Key', I.KeyRound), col(sm('td.builder', 'Builder', I.Wand), sm('td.testRules', 'Test Validation Rules', I.TestTube2), sm('td.lookup', 'Modify Lookups', I.Wand2)), col(sm('td.insertRows', 'Insert Rows', I.ListPlus), sm('td.deleteRows', 'Delete Rows', I.ListX), sm('td.duplicate', 'Duplicate Field', I.Copy))] },
    { label: 'Show/Hide', items: [lg('td.propertySheet', 'Property Sheet', I.TableProperties), lg('td.indexes', 'Indexes', I.ListOrdered)] },
    { label: 'Relationships', items: [lg('tools.relationships', 'Relation-ships', I.GitFork), lg('tools.dependencies', 'Object Dependencies', I.ListTree)] },
  ] },
  { id: 'ctx-table-fields', label: 'FIELDS', ctx: 'TABLE TOOLS', groups: [
    { label: 'Views', items: [VIEW_MENU] },
    { label: 'Add & Delete', items: [col(sm('ds.addText', 'Short Text', I.Type), sm('ds.addNumber', 'Number', I.Hash), sm('ds.addCurrency', 'Currency', I.Sigma)), col(sm('ds.addDate', 'Date & Time', I.Calendar), sm('ds.addYesNo', 'Yes/No', I.CheckSquare), sm('ds.addLongText', 'Long Text', I.ScrollText)), col(sm('ds.renameField', 'Name & Caption', I.Pencil), sm('ds.deleteField', 'Delete Field', I.Trash2))] },
    { label: 'Fields', items: [col(sm('ds.hideFields', 'Hide Fields', I.EyeOff), sm('ds.unhideFields', 'Unhide Fields', I.Eye), sm('ds.resetLayout', 'Reset Layout', I.Columns3))] },
    { label: 'Sort & Filter', items: [col(sm('home.sortAsc', 'Ascending', I.ArrowUpAZ), sm('home.sortDesc', 'Descending', I.ArrowDownAZ), sm('home.toggleFilter', 'Toggle Filter', I.FilterX))] },
    RECORDS,
  ] },
  { id: 'ctx-query', label: 'DESIGN', ctx: 'QUERY TOOLS', groups: [
    { label: 'Results', items: [VIEW_MENU, lg('q.run', 'Run', I.Play)] },
    { label: 'Query Type', items: [lg('q.type.select', 'Select', I.Table2), lg('q.type.maketable', 'Make Table', I.Table), lg('q.type.append', 'Append', I.ListPlus), lg('q.type.update', 'Update', I.Pencil), lg('q.type.crosstab', 'Crosstab', I.Grid3x3), lg('q.type.delete', 'Delete', I.ListX), col(sm('q.union', 'Union', I.Combine), sm('q.dataDefinition', 'Data Definition', I.FileCode))] },
    { label: 'Query Setup', items: [lg('q.showTable', 'Show Table', I.Table2), col(sm('q.insertRows', 'Insert Rows', I.ListPlus), sm('q.deleteRows', 'Delete Rows', I.ListX), sm('q.builder', 'Builder', I.SquareFunction)), col(sm('q.insertColumn', 'Insert Columns', I.Columns3), sm('q.deleteColumn', 'Delete Columns', I.X)), { menu: [{ cmd: 'q.top.all', label: 'All' }, { cmd: 'q.top.5', label: '5' }, { cmd: 'q.top.25', label: '25' }, { cmd: 'q.top.100', label: '100' }, { cmd: 'q.top.5p', label: '5%' }, { cmd: 'q.top.25p', label: '25%' }], label: 'Return', icon: I.ListOrdered, size: 'sm' }] },
    { label: 'Show/Hide', items: [lg('q.totals', 'Totals', I.Sigma), lg('q.parameters', 'Para-meters', I.TextCursorInput), col(sm('q.distinct', 'Unique Values', I.Boxes), sm('q.tableNames', 'Table Names', I.Table2), sm('q.saveAs', 'Save As', I.Save))] },
  ] },
  { id: 'ctx-relationships', label: 'DESIGN', ctx: 'RELATIONSHIP TOOLS', groups: [
    { label: 'Tools', items: [lg('rel.edit', 'Edit Relation-ships', I.Pencil), lg('rel.clear', 'Clear Layout', I.X), lg('rel.junction', 'Junction Table', I.Combine), lg('rel.report', 'Relationship Report', I.FileBarChart)] },
    { label: 'Relationships', items: [lg('rel.showTable', 'Show Table', I.Table2), col(sm('rel.hideTable', 'Hide Table', I.EyeOff), sm('rel.direct', 'Direct Relationships', I.Link2), sm('rel.all', 'All Relationships', I.Network)), col(sm('rel.zoomIn', 'Zoom In', I.ZoomIn), sm('rel.zoomOut', 'Zoom Out', I.ZoomOut), sm('rel.save', 'Save Layout', I.Save))] },
  ] },
  { id: 'ctx-form-design', label: 'DESIGN', ctx: 'FORM DESIGN TOOLS', groups: [
    { label: 'Views', items: [VIEW_MENU] },
    { label: 'Themes', items: [THEMES, col(COLORS, FONTS)] },
    { label: 'Controls', items: [CONTROLS_FORM, col(sm('fd.tool.label', 'Label', I.Type), sm('fd.tool.textbox', 'Text Box', I.TextCursorInput), sm('fd.tool.button', 'Button', I.MousePointerClick)), col(sm('fd.tool.combobox', 'Combo Box', I.ChevronsUpDown), sm('fd.tool.checkbox', 'Check Box', I.CheckSquare), sm('fd.tool.subform', 'Subform', I.SquareStack)), lg('fd.insertImage', 'Insert Image', I.ImagePlus)] },
    { label: 'Header / Footer', items: [col(sm('fd.logo', 'Logo', I.Image), sm('fd.title', 'Title', I.Heading), sm('fd.dateTime', 'Date and Time', I.Clock))] },
    { label: 'Tools', items: [lg('fd.fieldList', 'Add Existing Fields', I.List), lg('fd.propertySheet', 'Property Sheet', I.TableProperties), lg('fd.tabOrder', 'Tab Order', I.ListOrdered), col(sm('fd.grid', 'Grid', I.Grid3x3), sm('fd.snap', 'Snap to Grid', I.Magnet), sm('fd.save', 'Save', I.Save))] },
  ] },
  { id: 'ctx-form-arrange', label: 'ARRANGE', ctx: 'FORM DESIGN TOOLS', groups: ARRANGE_GROUPS },
  { id: 'ctx-form-format', label: 'FORMAT', ctx: 'FORM DESIGN TOOLS', groups: FORMAT_GROUPS },
  { id: 'ctx-report-design', label: 'DESIGN', ctx: 'REPORT DESIGN TOOLS', groups: [
    { label: 'Views', items: [VIEW_MENU] },
    { label: 'Themes', items: [THEMES, col(COLORS, FONTS)] },
    { label: 'Grouping & Totals', items: [lg('rd.groupSort', 'Group & Sort', I.ListTree), col(TOTALS, sm('rd.hideDetails', 'Hide Details', I.EyeOff))] },
    { label: 'Controls', items: [CONTROLS_REPORT, col(sm('fd.tool.label', 'Label', I.Type), sm('fd.tool.textbox', 'Text Box', I.TextCursorInput), sm('fd.tool.line', 'Line', I.Minus)), col(sm('fd.tool.rectangle', 'Rectangle', I.Square), sm('rd.calc', 'Calculated Field', I.SquareFunction), sm('fd.tool.checkbox', 'Check Box', I.CheckSquare)), lg('fd.insertImage', 'Insert Image', I.ImagePlus)] },
    { label: 'Header / Footer', items: [lg('rd.pageNumbers', 'Page Numbers', I.Hash), col(sm('fd.logo', 'Logo', I.Image), sm('fd.title', 'Title', I.Heading), sm('fd.dateTime', 'Date and Time', I.Clock))] },
    { label: 'Tools', items: [lg('fd.fieldList', 'Add Existing Fields', I.List), lg('fd.propertySheet', 'Property Sheet', I.TableProperties), col(sm('fd.grid', 'Grid', I.Grid3x3), sm('fd.snap', 'Snap to Grid', I.Magnet), sm('fd.save', 'Save', I.Save))] },
  ] },
  { id: 'ctx-report-arrange', label: 'ARRANGE', ctx: 'REPORT DESIGN TOOLS', groups: ARRANGE_GROUPS },
  { id: 'ctx-report-format', label: 'FORMAT', ctx: 'REPORT DESIGN TOOLS', groups: FORMAT_GROUPS },
  { id: 'ctx-report-page', label: 'PAGE SETUP', ctx: 'REPORT DESIGN TOOLS', groups: [
    { label: 'Page Size', items: [PAGE_SIZE, PAGE_MARGINS] },
    { label: 'Page Layout', items: [lg('rd.orient.Portrait', 'Portrait', I.RectangleVertical), lg('rd.orient.Landscape', 'Landscape', I.RectangleHorizontal)] },
  ] },
  { id: 'ctx-print-preview', label: 'PRINT PREVIEW', ctx: 'REPORT TOOLS', groups: [
    { label: 'Views', items: [VIEW_MENU] },
    { label: 'Print', items: [lg('pp.print', 'Print', I.Printer)] },
    { label: 'Page Size', items: [{ menu: [{ cmd: 'rd.size.A4', label: 'A4' }, { cmd: 'rd.size.Letter', label: 'Letter' }], label: 'Size', icon: I.FileText, size: 'lg' }, { menu: [{ cmd: 'rd.orient.Portrait', label: 'Portrait' }, { cmd: 'rd.orient.Landscape', label: 'Landscape' }], label: 'Orientation', icon: I.RectangleHorizontal, size: 'lg' }] },
    { label: 'Zoom', items: [col(sm('pp.zoomIn', 'Zoom In', I.ZoomIn), sm('pp.zoomOut', 'Zoom Out', I.ZoomOut), sm('pp.zoom100', '100%', I.Maximize2))] },
    { label: 'Data', items: [lg('ext.exportPdf', 'PDF', I.FileDown), lg('pp.refresh', 'Refresh', I.RefreshCw)] },
    { label: 'Close Preview', items: [lg('pp.close', 'Close Print Preview', I.X)] },
  ] },
];

/** Position of the contextual tab set, so the title bar can draw its "TABLE TOOLS" label above it. */
export const useCtxBand = create<{ band: { left: number; width: number; label: string } | null }>(() => ({ band: null }));

export function Ribbon() {
  const ribbonTab = useApp((s) => s.ribbonTab);
  const setRibbonTab = useApp((s) => s.setRibbonTab);
  const tabs = useApp((s) => s.tabs);
  const activeTabId = useApp((s) => s.activeTabId);
  const project = useApp((s) => s.project);
  useCmdState(); // re-render on command availability changes
  const [collapsed, setCollapsed] = useState(false);
  const active = tabs.find((t) => t.id === activeTabId);
  const ctxIds = ctxTabsFor(active?.kind, active?.view);
  const visible = TABS.filter((t) => !t.ctx || ctxIds.includes(t.id));
  const cur = visible.find((t) => t.id === ribbonTab) ?? visible[0];
  const ctxRef = useRef<HTMLDivElement>(null);
  const ctxTabs = visible.filter((t) => t.ctx);
  const ctxLabel = ctxTabs[0]?.ctx ?? '';
  useLayoutEffect(() => {
    const measure = () => {
      const el = ctxRef.current;
      const next = el && ctxLabel ? { left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width, label: ctxLabel } : null;
      const prev = useCtxBand.getState().band;
      if (JSON.stringify(prev) !== JSON.stringify(next)) useCtxBand.setState({ band: next });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
  const tabBtn = (t: RibbonTab) => (
    <button key={t.id} role="tab" title={t.ctx} className={'rtab' + (t.ctx ? ' ctx' : '') + (cur?.id === t.id && ribbonTab !== 'file' ? ' active' : '')}
      onClick={() => { setRibbonTab(t.id); setCollapsed(false); }} onDoubleClick={() => setCollapsed((c) => !c)}>{t.label}</button>
  );
  return (
    <>
      <div className="ribbon-tabs" role="tablist">
        <button className={'rtab file' + (ribbonTab === 'file' ? ' active' : '')} onClick={() => setRibbonTab('file')}>FILE</button>
        {visible.filter((t) => !t.ctx).map(tabBtn)}
        {ctxTabs.length > 0 && <div className="ctx-set" ref={ctxRef}>{ctxTabs.map(tabBtn)}</div>}
        {project && <TellMe tabId={activeTabId} />}
        <div style={{ flex: 1 }} />
        <button className="rtab" title={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'} onClick={() => setCollapsed((c) => !c)}>{collapsed ? <I.ChevronDown size={14} /> : <I.ChevronUp size={14} />}</button>
      </div>
      <div className={'ribbon' + (collapsed ? ' collapsed' : '')}>
        {project && cur && cur.groups.map((g, i) => (
          <div className="rgroup" key={i}>
            <div className="rgroup-body">{g.items.map((it, j) => <RItem key={j} item={it} tabId={activeTabId} />)}</div>
            <div className="rgroup-label">{g.label}</div>
          </div>
        ))}
        {!project && <div className="muted" style={{ padding: 20 }}>Create or open a database to use the ribbon commands.</div>}
      </div>
    </>
  );
}

/** Every ribbon command with a readable label, for the Tell Me box. */
function commandLabels(): { cmd: string; label: string; where: string }[] {
  const out = new Map<string, { cmd: string; label: string; where: string }>();
  const walk = (it: Item, where: string) => {
    if ('col' in it) it.col.forEach((c) => walk(c, where));
    else if ('row' in it) it.row.forEach((c) => walk(c, where));
    else if ('menu' in it) it.menu.forEach((m) => { if (!out.has(m.cmd)) out.set(m.cmd, { cmd: m.cmd, label: `${it.label.replace('-', '').replace('/ ', '/')}: ${m.label}`, where }); });
    else if ('cmd' in it) { const l = (it.tip ?? it.label).replace('-', ''); if (l && !out.has(it.cmd)) out.set(it.cmd, { cmd: it.cmd, label: l, where }); }
  };
  for (const t of TABS) for (const g of t.groups) for (const it of g.items) walk(it, `${t.ctx ? t.ctx + ' › ' : ''}${t.label} › ${g.label}`);
  return [...out.values()];
}

function TellMe({ tabId }: { tabId: string | null }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const all = useMemo(commandLabels, []);
  const avail = new Set(open ? availableCommands(tabId) : []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length ? all.filter((c) => avail.has(c.cmd) && words.every((w) => (c.label + ' ' + c.where).toLowerCase().includes(w))).slice(0, 8) : [];
  const run = (c: { cmd: string }) => { setQ(''); setOpen(false); runCommand(c.cmd, tabId); };
  return (
    <div className="tellme" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <I.Lightbulb size={14} />
      <input value={q} placeholder="Tell me what you want to do" aria-label="Tell me what you want to do"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); run(hits[hi]); }
          else if (e.key === 'Escape') { setQ(''); setOpen(false); }
        }} />
      {open && words.length > 0 && (
        <div className="tellme-list" role="listbox">
          {hits.length === 0 && <div className="tellme-empty">No command matches “{q}” for the object you are working on.</div>}
          {hits.map((c, i) => (
            <button key={c.cmd} role="option" aria-selected={i === hi} className={'tellme-item' + (i === hi ? ' hi' : '')} onMouseDown={(e) => { e.preventDefault(); run(c); }}>
              <span>{c.label}</span><span className="tellme-where">{c.where}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ctxTabsFor(kind?: string, view?: string): string[] {
  if (kind === 'table') return view === 'design' ? ['ctx-table-design'] : ['ctx-table-fields'];
  if (kind === 'query') return ['ctx-query'];
  if (kind === 'relationships') return ['ctx-relationships'];
  if (kind === 'form' && view === 'design') return ['ctx-form-design', 'ctx-form-arrange', 'ctx-form-format'];
  if (kind === 'report') return view === 'design' ? ['ctx-report-design', 'ctx-report-arrange', 'ctx-report-format', 'ctx-report-page'] : ['ctx-print-preview'];
  return [];
}

function useFlags(cmd: string, tabId: string | null) {
  const s = useCmdState();
  return (tabId ? s.editors[tabId]?.[cmd] : undefined) ?? s.global[cmd];
}

function RItem({ item, tabId }: { item: Item; tabId: string | null }) {
  if ('col' in item) return <div className="rcol">{item.col.map((c, i) => <RItem key={i} item={c} tabId={tabId} />)}</div>;
  if ('row' in item) return <div className="rrow">{item.row.map((c, i) => <RItem key={i} item={c} tabId={tabId} />)}</div>;
  if ('pick' in item) return <RPick item={item} tabId={tabId} />;
  if ('menu' in item) return <RMenu item={item} tabId={tabId} />;
  return <RButton item={item} tabId={tabId} />;
}

function RPick({ item, tabId }: { item: Extract<Item, { pick: string }>; tabId: string | null }) {
  const f = useFlags(item.pick, tabId);
  const disabled = !f || !f.enabled;
  const value = f?.value ?? '';
  if (item.kind === 'color') {
    const Ico = item.icon ?? I.Palette;
    return (
      <label className={'rbtn rbtn-sm rpick-color' + (disabled ? ' is-disabled' : '')} title={item.label}>
        <Ico /><span className="swatch-bar" style={{ background: value || 'transparent' }} />
        <input type="color" disabled={disabled} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} aria-label={item.label} data-cmd={item.pick}
          onChange={(e) => runCommandValue(item.pick, e.target.value, tabId)} />
      </label>
    );
  }
  // options come from the ribbon definition or, for lists that depend on the object (Selection), from the flag label
  const opts = item.options ?? (f?.label ? f.label.split('\n') : []);
  const list = value && !opts.includes(value) ? [value, ...opts] : opts;
  return (
    <select className="rpick" style={{ width: item.width ?? 110 }} disabled={disabled} value={value} title={item.label} aria-label={item.label} data-cmd={item.pick}
      onChange={(e) => runCommandValue(item.pick, e.target.value, tabId)}>
      {!value && <option value="">{item.label}</option>}
      {list.map((o) => <option key={o} value={o}>{o || '(none)'}</option>)}
    </select>
  );
}

function RButton({ item, tabId }: { item: Extract<Item, { cmd: string; icon: Icon; label: string; size?: 'lg' | 'sm' }>; tabId: string | null }) {
  const f = useFlags(item.cmd, tabId);
  const Ico = item.icon;
  return (
    <button className={`rbtn ${item.size === 'sm' ? 'rbtn-sm' : 'rbtn-lg'}${f?.checked ? ' checked' : ''}`} disabled={!f || !f.enabled} title={item.tip ?? f?.label ?? item.label.replace('-', '')}
      onClick={() => runCommand(item.cmd, tabId)} data-cmd={item.cmd}>
      <Ico />{item.label ? item.label.replace('-', '­') : null}
    </button>
  );
}

function RMenu({ item, tabId }: { item: Extract<Item, { menu: unknown }>; tabId: string | null }) {
  const s = useCmdState();
  const avail = item.menu.filter((m) => { const f = (tabId ? s.editors[tabId]?.[m.cmd] : undefined) ?? s.global[m.cmd]; return f && f.enabled; });
  const checked = item.menu.find((m) => { const f = (tabId ? s.editors[tabId]?.[m.cmd] : undefined) ?? s.global[m.cmd]; return f?.checked; });
  const Ico = item.icon;
  const open = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    showContextMenu({ clientX: r.left, clientY: r.bottom }, avail.map((m) => {
      const f = (tabId ? s.editors[tabId]?.[m.cmd] : undefined) ?? s.global[m.cmd];
      return { label: m.label, checked: f?.checked, onClick: () => runCommand(m.cmd, tabId) };
    }));
  };
  const primary = item.cmd && ((tabId ? s.editors[tabId]?.[item.cmd] : undefined) ?? s.global[item.cmd]);
  return (
    <button className={`rbtn ${item.size === 'sm' ? 'rbtn-sm' : 'rbtn-lg'}`} disabled={!avail.length} data-cmd={item.cmd ?? item.label}
      onClick={(e) => { const onArrow = (e.target as HTMLElement).closest('.rm-arrow'); if (!onArrow && primary && primary.enabled && item.cmd) runCommand(item.cmd, tabId); else open(e); }}
      onContextMenu={(e) => { e.preventDefault(); if (avail.length) open(e); }} title={primary ? `${item.label} (click the arrow for more views)` : item.label}>
      <Ico />{item.label.replace('/ ', '/\u00ad')}{item.size === 'sm' && checked ? `: ${checked.label}` : ''} <span className="rm-arrow" style={{ display: 'inline-flex', padding: '0 4px' }}><I.ChevronDown size={10} style={{ width: 10, height: 10, marginBottom: 0 }} /></span>
    </button>
  );
}
