'use client';
import type { LucideIcon } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Type, Hash, Calendar, CheckSquare, ScrollText, Sigma, Link2, Paperclip, SquareFunction, ListOrdered, Mail, Phone, User, MapPin } from 'lucide-react';
import type { WowProject } from '@/engine/project';
import { uid } from '@/engine/project';
import { DATA_TYPES, type DataType, type FieldDef, type TableDef } from '@/engine/types';
import { q } from '@/engine/sqlite';
import { parseCriteria, toSql } from '@/engine/expr';
import { useEditorCommands } from '../commands';
import { ExpressionBuilder } from '../dialogs/ExpressionBuilder';
import { confirmBox, errorBox, messageBox, openDialog, showContextMenu } from '../dialogs';

const HELP: Record<string, string> = {
  textAlign: 'How values line up in Datasheet View and in new form controls. General puts text on the left and numbers on the right.',
  name: 'A field name can be up to 64 characters long, including spaces. Press F1 for help on field names.',
  type: 'The data type determines the kind of values that users can store in the field.',
  description: 'The field description is optional. It helps you describe the field and is displayed as a tooltip.',
  fieldSize: 'The maximum number of characters you can enter in the field (1–255).',
  numberSize: 'Byte 0–255; Integer ±32,767; Long Integer ±2 billion (whole numbers). Single/Double/Decimal store fractions.',
  format: 'The display layout for the field. Values are stored unchanged.',
  inputMask: 'A pattern for data entry: 0 = required digit, 9 = optional digit, L = letter, A = letter or digit. Example: 000 000 0000',
  caption: 'The label used for the field in datasheets, forms and reports.',
  defaultValue: 'A value that is automatically entered for new records, e.g. 0, "Accra" or Date().',
  validationRule: 'An expression that limits the values that can be entered, e.g. >=0, Between 1 And 100, In ("M","F"), <Date().',
  validationText: 'The error message shown when a value breaks the Validation Rule.',
  required: 'Require data entry in this field? (Yes = NOT NULL in the database).',
  allowZeroLength: 'Allow zero-length (empty "") text?',
  indexed: 'An index speeds up searches and sorting. "No Duplicates" makes the field unique.',
  decimalPlaces: 'The number of decimal places displayed.',
  expression: 'The expression that calculates this field, e.g. [Quantity]*[UnitPrice].',
  resultType: 'The data type of the calculated result.',
  lookup: 'Display values from another table/query or a list in a combo box.',
};

const TEMPLATES: { label: string; icon: LucideIcon; field: Partial<FieldDef> }[] = [
  { label: 'ID (AutoNumber key)', icon: KeyRound, field: { name: 'ID', type: 'AutoNumber', primaryKey: true } },
  { label: 'Short Text', icon: Type, field: { type: 'Short Text', fieldSize: 255 } },
  { label: 'Long Text', icon: ScrollText, field: { type: 'Long Text' } },
  { label: 'Number', icon: Hash, field: { type: 'Number', numberSize: 'Long Integer' } },
  { label: 'Large Number', icon: Hash, field: { type: 'Large Number' } },
  { label: 'Currency', icon: Sigma, field: { type: 'Currency', format: 'Currency' } },
  { label: 'Date/Time', icon: Calendar, field: { type: 'Date/Time', format: 'Short Date' } },
  { label: 'Yes/No', icon: CheckSquare, field: { type: 'Yes/No' } },
  { label: 'Hyperlink', icon: Link2, field: { type: 'Hyperlink' } },
  { label: 'Attachment', icon: Paperclip, field: { type: 'Attachment' } },
  { label: 'Calculated', icon: SquareFunction, field: { type: 'Calculated', expression: '', resultType: 'Text' } },
  { label: 'Lookup (combo)', icon: ListOrdered, field: { type: 'Number', numberSize: 'Long Integer', lookup: { rowSourceType: 'Table/Query', rowSource: '', boundField: '', displayField: '' } } },
];
const QUICK: { label: string; icon: LucideIcon; field: Partial<FieldDef> }[] = [
  { label: 'First Name', icon: User, field: { name: 'FirstName', type: 'Short Text', fieldSize: 50 } },
  { label: 'Last Name', icon: User, field: { name: 'LastName', type: 'Short Text', fieldSize: 50 } },
  { label: 'Email', icon: Mail, field: { name: 'Email', type: 'Hyperlink' } },
  { label: 'Phone', icon: Phone, field: { name: 'Phone', type: 'Short Text', fieldSize: 15, inputMask: '000 000 0000' } },
  { label: 'Town', icon: MapPin, field: { name: 'Town', type: 'Short Text', fieldSize: 50 } },
  { label: 'Date of Birth', icon: Calendar, field: { name: 'DateOfBirth', type: 'Date/Time', format: 'Short Date', validationRule: '<Date()', validationText: 'Date of birth must be in the past.' } },
];

export interface TableDesignerProps {
  tabId: string; active: boolean; project: WowProject;
  def: TableDef; setDef: (d: TableDef, record?: boolean) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  save: () => Promise<boolean>;
  isNew: boolean;
}

export function TableDesigner(props: TableDesignerProps) {
  const { def, setDef, project: p } = props;
  const rows = useMemo(() => [...def.fields, blankField()], [def.fields]); // trailing blank row like Access
  const [sel, setSel] = useState<Set<string>>(new Set(def.fields[0] ? [def.fields[0].id] : []));
  const [cur, setCur] = useState<string | null>(def.fields[0]?.id ?? null);
  const [helpKey, setHelpKey] = useState('name');
  const [propTab, setPropTab] = useState<'general' | 'lookup'>('general');
  const [showProps, setShowProps] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const blankRef = useRef(rows[rows.length - 1]);
  blankRef.current = rows[rows.length - 1];
  const field = def.fields.find((f) => f.id === cur);

  const updateField = (id: string, patch: Partial<FieldDef>) => {
    const exists = def.fields.some((f) => f.id === id);
    if (!exists) {
      // typing in the blank row creates a new field
      const nf: FieldDef = { ...blankRef.current, ...patch, id };
      setDef({ ...def, fields: [...def.fields, nf] });
      setCur(id); setSel(new Set([id]));
      return;
    }
    setDef({ ...def, fields: def.fields.map((f) => (f.id === id ? cleanType({ ...f, ...patch }, f.type) : f)) });
  };

  const selectRow = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && cur) {
      const ids = def.fields.map((f) => f.id);
      const a = ids.indexOf(cur), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) { setSel(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1))); return; }
    }
    if (e.ctrlKey || e.metaKey) { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); setCur(id); return; }
    setSel(new Set([id])); setCur(id);
  };

  const togglePk = () => {
    const ids = sel.size ? sel : new Set(cur ? [cur] : []);
    if (!ids.size) return;
    const targets = def.fields.filter((f) => ids.has(f.id));
    if (targets.some((t) => t.type === 'Calculated')) { void messageBox('A calculated field cannot be a primary key.', 'Primary Key', 'warn'); return; }
    const allPk = targets.every((t) => t.primaryKey);
    setDef({ ...def, fields: def.fields.map((f) => ({ ...f, primaryKey: allPk ? (ids.has(f.id) ? false : f.primaryKey) : ids.has(f.id) })) });
  };
  const insertRow = () => {
    const at = cur ? def.fields.findIndex((f) => f.id === cur) : def.fields.length;
    const nf: FieldDef = { id: uid('f'), name: uniqueFieldName(def, 'Field'), type: 'Short Text', fieldSize: 255 };
    const fields = [...def.fields]; fields.splice(Math.max(0, at), 0, nf);
    setDef({ ...def, fields }); setCur(nf.id); setSel(new Set([nf.id]));
  };
  const deleteRows = async () => {
    const ids = sel.size ? sel : new Set(cur ? [cur] : []);
    const targets = def.fields.filter((f) => ids.has(f.id));
    if (!targets.length) return;
    if (!props.isNew) {
      const ok = await confirmBox(`Do you want to permanently delete the selected field(s) and all the data in them?\n\n${targets.map((t) => t.name).join(', ')}\n\nThe data is removed when you save the table.`, { danger: true, title: 'Delete Rows' });
      if (!ok) return;
    }
    const rest = def.fields.filter((f) => !ids.has(f.id));
    setDef({ ...def, fields: rest }); setSel(new Set()); setCur(rest[0]?.id ?? null);
  };
  const duplicate = () => {
    const ids = sel.size ? sel : new Set(cur ? [cur] : []);
    const fields: FieldDef[] = [];
    for (const f of def.fields) {
      fields.push(f);
      if (ids.has(f.id)) fields.push({ ...JSON.parse(JSON.stringify(f)), id: uid('f'), name: uniqueFieldName(def, f.name + 'Copy'), primaryKey: false, type: f.type === 'AutoNumber' ? 'Number' : f.type });
    }
    setDef({ ...def, fields });
  };
  const testRules = async () => {
    if (props.isNew) { await messageBox('Save the table and enter some data first. Then Test Validation Rules checks existing records against the rules.', 'Test Validation Rules'); return; }
    const lines: string[] = [];
    for (const f of def.fields) {
      const saved = p.getTable(def.name)?.fields.find((x) => x.id === f.id);
      if (!saved) continue;
      try {
        if (f.required) { const n = Number(p.db.scalar(`SELECT count(*) FROM ${q(def.name)} WHERE ${q(saved.name)} IS NULL`)); if (n) lines.push(`${f.name}: ${n} record(s) are empty but the field is Required.`); }
        if (f.validationRule) {
          const cond = toSql(parseCriteria(f.validationRule, 'validation'), { self: q(saved.name), resolve: (parts) => { const x = def.fields.find((y) => y.name.toLowerCase() === parts[parts.length - 1].toLowerCase()); return x ? q(x.name) : null; } });
          const n = Number(p.db.scalar(`SELECT count(*) FROM ${q(def.name)} WHERE ${q(saved.name)} IS NOT NULL AND NOT (${cond})`));
          if (n) lines.push(`${f.name}: ${n} record(s) break the rule "${f.validationRule}".`);
        }
        if (f.type === 'Short Text' && f.fieldSize) { const n = Number(p.db.scalar(`SELECT count(*) FROM ${q(def.name)} WHERE length(${q(saved.name)}) > ?`, [f.fieldSize])); if (n) lines.push(`${f.name}: ${n} value(s) are longer than ${f.fieldSize} characters.`); }
        if (f.indexed === 'Yes (No Duplicates)') { const n = Number(p.db.scalar(`SELECT count(*) FROM (SELECT ${q(saved.name)} FROM ${q(def.name)} WHERE ${q(saved.name)} IS NOT NULL GROUP BY ${q(saved.name)} HAVING count(*) > 1)`)); if (n) lines.push(`${f.name}: ${n} value(s) are duplicated but the index requires unique values.`); }
      } catch (e) { lines.push(`${f.name}: ${(e as Error).message}`); }
    }
    await messageBox(lines.length ? `Existing data does not meet these rules:\n\n${lines.join('\n')}\n\nSaving will fail until the data is corrected.` : 'All existing data meets the validation rules, Required settings and field sizes.', 'Test Validation Rules', lines.length ? 'warn' : 'info');
  };
  const indexes = async () => {
    await openDialog('Indexes: ' + (def.name || 'Table'), (close) => <IndexesDialog def={def} close={close} onChange={(fid, v) => updateField(fid, { indexed: v })} />, 520);
  };
  const lookupWizard = async () => {
    if (!field) { await messageBox('Select a field first.'); return; }
    const res = await openDialog<FieldDef['lookup'] | 'none'>('Lookup Wizard', (close) => <LookupWizard p={p} field={field} close={close} />, 480);
    if (!res) return;
    updateField(field.id, res === 'none' ? { lookup: undefined } : { lookup: res, type: res.rowSourceType === 'Value List' ? (field.type === 'AutoNumber' ? 'Short Text' : field.type) : (field.type === 'Short Text' && res.boundField && /id$/i.test(res.boundField) ? 'Number' : field.type) });
    setPropTab('lookup');
  };

  const builder = async () => {
    if (!field) return;
    const key: 'validationRule' | 'defaultValue' | 'expression' = helpKey === 'defaultValue' ? 'defaultValue' : helpKey === 'expression' || field.type === 'Calculated' ? 'expression' : 'validationRule';
    const names = def.fields.filter((x) => x.name && x.id !== field.id).map((x) => x.name);
    const res = await openDialog<string>(`Expression Builder: ${field.name} (${key === 'validationRule' ? 'Validation Rule' : key === 'defaultValue' ? 'Default Value' : 'Expression'})`, (close) => <ExpressionBuilder initial={String(field[key] ?? '')} fields={key === 'expression' ? names : []} close={close} />, 640);
    if (res !== null && res !== undefined) updateField(field.id, { [key]: res });
  };
  useEditorCommands(props.tabId, props.active, {
    'td.builder': { run: () => void builder(), enabled: !!field && field.type !== 'AutoNumber' },
    'td.primaryKey': { run: togglePk, enabled: !!cur, checked: !!field?.primaryKey },
    'td.insertRows': insertRow,
    'td.deleteRows': { run: () => void deleteRows(), enabled: !!cur || sel.size > 0 },
    'td.duplicate': { run: duplicate, enabled: !!cur },
    'td.testRules': () => void testRules(),
    'td.indexes': () => void indexes(),
    'td.lookup': { run: () => void lookupWizard(), enabled: !!field },
    'td.propertySheet': { run: () => setShowProps(!showProps), checked: showProps },
    'td.save': () => void props.save(),
    'home.cut': { run: () => void deleteRows(), enabled: !!cur },
    'home.copy': { run: duplicate, enabled: !!cur },
  }, 'design');

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); props.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); props.redo(); }
  };

  // drag-reorder: row selector drag; toolbox drag inserts template
  const onDropAt = (beforeId: string | null, data: DataTransfer) => {
    const tmpl = data.getData('application/x-wowdb-field');
    if (tmpl) {
      const t = JSON.parse(tmpl) as Partial<FieldDef>;
      const nf: FieldDef = { id: uid('f'), name: uniqueFieldName(def, t.name ?? (t.type === 'AutoNumber' ? 'ID' : t.type?.replace(/[^A-Za-z]/g, '') ?? 'Field')), type: 'Short Text', ...t, ...(t.primaryKey && def.fields.some((f) => f.primaryKey) ? { primaryKey: false } : {}) } as FieldDef;
      if (nf.type === 'AutoNumber' && def.fields.some((f) => f.type === 'AutoNumber')) { void messageBox('A table can only have one AutoNumber field.', 'WOWDB', 'warn'); return; }
      nf.name = uniqueFieldName(def, nf.name);
      const fields = [...def.fields];
      const at = beforeId ? fields.findIndex((f) => f.id === beforeId) : fields.length;
      fields.splice(at < 0 ? fields.length : at, 0, nf);
      setDef({ ...def, fields }); setCur(nf.id); setSel(new Set([nf.id]));
      return;
    }
    if (!dragId) return;
    const moving = sel.has(dragId) ? def.fields.filter((f) => sel.has(f.id)) : def.fields.filter((f) => f.id === dragId);
    const rest = def.fields.filter((f) => !moving.includes(f));
    let at = beforeId ? rest.findIndex((f) => f.id === beforeId) : rest.length;
    if (at < 0) at = rest.length;
    rest.splice(at, 0, ...moving);
    setDef({ ...def, fields: rest });
  };

  return (
    <div className="td" onKeyDown={onKey}>
      <div style={{ display: 'flex', flex: '1 1 55%', minHeight: 120 }}>
        <div className="toolbox-strip" aria-label="Field toolbox">
          <div className="tb-title">Field types</div>
          {TEMPLATES.map((t) => <ToolItem key={t.label} t={t} onAdd={() => onDropAtTemplate(t.field)} />)}
          <div className="tb-title" style={{ marginTop: 6 }}>Quick start</div>
          {QUICK.map((t) => <ToolItem key={t.label} t={t} onAdd={() => onDropAtTemplate(t.field)} />)}
        </div>
        <div className="td-top" style={{ flex: 1 }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-wowdb-field') || dragId) { e.preventDefault(); } }}
          onDrop={(e) => { e.preventDefault(); onDropAt(dropBefore, e.dataTransfer); setDropBefore(null); setDragId(null); }}>
          <table className="td-grid" data-testid="table-design-grid">
            <colgroup><col style={{ width: 24 }} /><col style={{ width: '30%' }} /><col style={{ width: '20%' }} /><col /></colgroup>
            <thead><tr><th /><th>Field Name</th><th>Data Type</th><th>Description (Optional)</th></tr></thead>
            <tbody>
              {rows.map((f, i) => {
                const isBlank = i === rows.length - 1;
                return (
                  <tr key={f.id} className={(sel.has(f.id) || cur === f.id ? 'is-sel ' : '') + (dropBefore === f.id ? 'drop-before' : '')}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-wowdb-field') || dragId) { e.preventDefault(); setDropBefore(isBlank ? null : f.id); } }}
                    onContextMenu={(e) => { if (isBlank) return; setCur(f.id); if (!sel.has(f.id)) setSel(new Set([f.id])); showContextMenu(e, [
                      { label: 'Primary Key', onClick: togglePk, checked: !!f.primaryKey }, { separator: true },
                      { label: 'Insert Rows', onClick: insertRow }, { label: 'Delete Rows', onClick: () => void deleteRows() }, { label: 'Duplicate Field', onClick: duplicate }, { separator: true },
                      { label: 'Lookup Wizard…', onClick: () => void lookupWizard() }, { label: 'Indexes…', onClick: () => void indexes() }]); }}>
                    <td className="rs" draggable={!isBlank} onDragStart={(e) => { setDragId(f.id); e.dataTransfer.setData('text/plain', f.name); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragId(null); setDropBefore(null); }}
                      onMouseDown={(e) => { if (!isBlank) selectRow(f.id, e); }} title={isBlank ? '' : 'Click to select, drag to move'}>
                      {f.primaryKey ? <KeyRound size={13} color="#b8860b" style={{ display: 'inline' }} /> : cur === f.id ? '▶' : ''}
                    </td>
                    <td><input value={f.name} placeholder={isBlank ? '' : 'Field name'} aria-label="Field Name" onFocus={() => { if (!isBlank) { setCur(f.id); setSel(new Set([f.id])); } setHelpKey('name'); }} onChange={(e) => updateField(f.id, { name: e.target.value })} maxLength={64} /></td>
                    <td>
                      <select value={isBlank && !f.name ? '' : f.type} aria-label="Data Type" onFocus={() => { if (!isBlank) { setCur(f.id); setSel(new Set([f.id])); } setHelpKey('type'); }}
                        onChange={(e) => { const t = e.target.value as DataType; if (!t) return; if (t === 'AutoNumber' && def.fields.some((x) => x.type === 'AutoNumber' && x.id !== f.id)) { void messageBox('A table can only have one AutoNumber field.', 'WOWDB', 'warn'); return; } updateField(f.id, { type: t, name: f.name || uniqueFieldName(def, 'Field') }); }}>
                        {isBlank && !f.name && <option value="" />}
                        {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td><input value={f.description ?? ''} aria-label="Description" onFocus={() => { if (!isBlank) setCur(f.id); setHelpKey('description'); }} onChange={(e) => updateField(f.id, { description: e.target.value, name: f.name || (isBlank ? uniqueFieldName(def, 'Field') : f.name) })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {showProps && (
        <div className="td-bottom">
          <div className="td-props">
            <div style={{ textAlign: 'center', fontSize: 12, color: '#555', padding: '4px 0 0' }}>Field Properties{field ? ` — ${field.name}` : ''}</div>
            <div className="tabs-mini"><button className={propTab === 'general' ? 'on' : ''} onClick={() => setPropTab('general')}>General</button><button className={propTab === 'lookup' ? 'on' : ''} onClick={() => setPropTab('lookup')}>Lookup</button></div>
            <div className="prop-table" data-testid="field-properties">
              {!field ? <div className="muted" style={{ padding: 10 }}>Select a field to see its properties.</div> : propTab === 'general' ? (
                <GeneralProps f={field} onChange={(patch) => updateField(field.id, patch)} onHelp={setHelpKey} />
              ) : (
                <LookupProps p={p} f={field} onChange={(patch) => updateField(field.id, patch)} onHelp={setHelpKey} onWizard={() => void lookupWizard()} />
              )}
            </div>
          </div>
          <div className="td-help">{HELP[helpKey] ?? ''}</div>
        </div>
      )}
    </div>
  );

  function onDropAtTemplate(t: Partial<FieldDef>) {
    const dt = new DataTransfer();
    dt.setData('application/x-wowdb-field', JSON.stringify(t));
    onDropAt(null, dt);
  }
}

function ToolItem({ t, onAdd }: { t: { label: string; icon: LucideIcon; field: Partial<FieldDef> }; onAdd: () => void }) {
  const Ico = t.icon;
  return (
    <div className="tb-item" draggable title="Drag into the design grid, or double-click to add"
      onDragStart={(e) => { e.dataTransfer.setData('application/x-wowdb-field', JSON.stringify(t.field)); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={onAdd}>
      <Ico size={15} />{t.label}
    </div>
  );
}

function blankField(): FieldDef { return { id: uid('f'), name: '', type: 'Short Text', fieldSize: 255 }; }
export function uniqueFieldName(def: TableDef, base: string) {
  const names = new Set(def.fields.map((f) => f.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let i = 1; while (names.has((base + i).toLowerCase())) i++;
  return base + i;
}
function cleanType(f: FieldDef, oldType: DataType): FieldDef {
  if (f.type === oldType) return f;
  const n: FieldDef = { ...f };
  if (f.type === 'Short Text') n.fieldSize = n.fieldSize ?? 255; else delete n.fieldSize;
  if (f.type === 'Number') n.numberSize = n.numberSize ?? 'Long Integer'; else delete n.numberSize;
  if (f.type === 'Currency') n.format = n.format || 'Currency';
  if (f.type === 'Date/Time') n.format = n.format || 'Short Date';
  if (f.type !== 'Calculated') { delete n.expression; delete n.resultType; } else { n.expression = n.expression ?? ''; n.resultType = n.resultType ?? 'Text'; n.primaryKey = false; }
  if (f.type === 'AutoNumber' || f.type === 'Yes/No' || f.type === 'Calculated') { delete n.defaultValue; delete n.validationRule; n.required = false; }
  return n;
}

function PropRow({ label, children, onFocus }: { label: string; children: React.ReactNode; onFocus?: () => void }) {
  return <div className="prop-row" onFocus={onFocus}><label>{label}</label><div>{children}</div></div>;
}
const yn = (v: boolean | undefined, set: (b: boolean) => void) => (
  <select value={v ? 'Yes' : 'No'} onChange={(e) => set(e.target.value === 'Yes')}><option>No</option><option>Yes</option></select>
);

function GeneralProps({ f, onChange, onHelp }: { f: FieldDef; onChange: (p: Partial<FieldDef>) => void; onHelp: (k: string) => void }) {
  const text = (k: keyof FieldDef, label: string, placeholder = '') => (
    <PropRow label={label} onFocus={() => onHelp(k)}><input value={String(f[k] ?? '')} placeholder={placeholder} onChange={(e) => onChange({ [k]: e.target.value || undefined } as Partial<FieldDef>)} aria-label={label} /></PropRow>
  );
  const formats: Partial<Record<DataType, string[]>> = {
    Number: ['', 'General Number', 'Currency', 'Fixed', 'Standard', 'Percent', 'Scientific'], 'Large Number': ['', 'General Number', 'Standard'], Currency: ['Currency', 'Fixed', 'Standard', 'General Number'],
    'Date/Time': ['Short Date', 'Medium Date', 'Long Date', 'General Date', 'Short Time', 'Long Time'], 'Yes/No': ['Yes/No', 'True/False', 'On/Off'],
  };
  return (
    <>
      {f.type === 'Short Text' && <PropRow label="Field Size" onFocus={() => onHelp('fieldSize')}><input type="number" min={1} max={255} value={f.fieldSize ?? 255} onChange={(e) => onChange({ fieldSize: Math.max(1, Math.min(255, Number(e.target.value) || 255)) })} aria-label="Field Size" /></PropRow>}
      {f.type === 'Number' && <PropRow label="Field Size" onFocus={() => onHelp('numberSize')}><select value={f.numberSize ?? 'Long Integer'} onChange={(e) => onChange({ numberSize: e.target.value as FieldDef['numberSize'] })} aria-label="Field Size">{['Byte', 'Integer', 'Long Integer', 'Single', 'Double', 'Decimal'].map((s) => <option key={s}>{s}</option>)}</select></PropRow>}
      {f.type === 'AutoNumber' && <PropRow label="New Values"><span className="ro">Increment</span></PropRow>}
      {f.type === 'Calculated' && <>
        <PropRow label="Expression" onFocus={() => onHelp('expression')}><input value={f.expression ?? ''} onChange={(e) => onChange({ expression: e.target.value })} placeholder="[Field1] & &quot; &quot; & [Field2]" aria-label="Expression" /></PropRow>
        <PropRow label="Result Type" onFocus={() => onHelp('resultType')}><select value={f.resultType ?? 'Text'} onChange={(e) => onChange({ resultType: e.target.value as FieldDef['resultType'] })}>{['Text', 'Number', 'Currency', 'Date/Time', 'Yes/No'].map((s) => <option key={s}>{s}</option>)}</select></PropRow>
      </>}
      {formats[f.type] ? <PropRow label="Format" onFocus={() => onHelp('format')}><select value={f.format ?? ''} onChange={(e) => onChange({ format: e.target.value || undefined })} aria-label="Format">{formats[f.type]!.map((s) => <option key={s} value={s}>{s}</option>)}</select></PropRow>
        : f.type !== 'Attachment' && text('format', 'Format')}
      {['Number', 'Currency', 'Calculated'].includes(f.type) && <PropRow label="Decimal Places" onFocus={() => onHelp('decimalPlaces')}><select value={String(f.decimalPlaces ?? 'Auto')} onChange={(e) => onChange({ decimalPlaces: e.target.value === 'Auto' ? 'Auto' : Number(e.target.value) })}>{['Auto', '0', '1', '2', '3', '4', '5'].map((s) => <option key={s}>{s}</option>)}</select></PropRow>}
      {['Short Text', 'Number', 'Date/Time', 'Currency', 'Large Number'].includes(f.type) && text('inputMask', 'Input Mask', 'e.g. 000 000 0000')}
      {text('caption', 'Caption')}
      {!['AutoNumber', 'Calculated', 'Attachment'].includes(f.type) && text('defaultValue', 'Default Value', f.type === 'Date/Time' ? 'Date()' : '')}
      {!['AutoNumber', 'Calculated', 'Yes/No', 'Attachment'].includes(f.type) && text('validationRule', 'Validation Rule', 'e.g. >=0')}
      {!['AutoNumber', 'Calculated', 'Yes/No', 'Attachment'].includes(f.type) && text('validationText', 'Validation Text')}
      {!['AutoNumber', 'Calculated', 'Yes/No'].includes(f.type) && <PropRow label="Required" onFocus={() => onHelp('required')}>{yn(f.required, (b) => onChange({ required: b }))}</PropRow>}
      {(f.type === 'Short Text' || f.type === 'Long Text') && <PropRow label="Allow Zero Length" onFocus={() => onHelp('allowZeroLength')}>{yn(f.allowZeroLength !== false, (b) => onChange({ allowZeroLength: b }))}</PropRow>}
      {!['Calculated', 'Attachment', 'Long Text'].includes(f.type) && <PropRow label="Indexed" onFocus={() => onHelp('indexed')}><select value={f.primaryKey ? 'Yes (No Duplicates)' : f.indexed ?? 'No'} disabled={f.primaryKey} onChange={(e) => onChange({ indexed: e.target.value as FieldDef['indexed'] })} aria-label="Indexed">{['No', 'Yes (Duplicates OK)', 'Yes (No Duplicates)'].map((s) => <option key={s}>{s}</option>)}</select></PropRow>}
      {!['Attachment'].includes(f.type) && <PropRow label="Text Align" onFocus={() => onHelp('textAlign')}><select value={f.textAlign ?? 'General'} onChange={(e) => onChange({ textAlign: e.target.value === 'General' ? undefined : e.target.value as FieldDef['textAlign'] })} aria-label="Text Align">{['General', 'Left', 'Center', 'Right'].map((s) => <option key={s}>{s}</option>)}</select></PropRow>}
      <PropRow label="Primary Key"><span className="ro">{f.primaryKey ? 'Yes' : 'No'}</span></PropRow>
    </>
  );
}

function LookupProps({ p, f, onChange, onHelp, onWizard }: { p: WowProject; f: FieldDef; onChange: (p: Partial<FieldDef>) => void; onHelp: (k: string) => void; onWizard: () => void }) {
  const lk = f.lookup;
  const sources = [...p.tableNames(), ...p.listObjects('query').map((o) => o.name)];
  const cols = lk && lk.rowSourceType === 'Table/Query' && lk.rowSource ? p.columnsOf(lk.rowSource) : [];
  const set = (patch: Partial<NonNullable<FieldDef['lookup']>>) => onChange({ lookup: { rowSourceType: 'Table/Query', rowSource: '', ...(lk ?? {}), ...patch } });
  return (
    <>
      <PropRow label="Display Control" onFocus={() => onHelp('lookup')}>
        <select value={lk ? 'Combo Box' : 'Text Box'} onChange={(e) => onChange({ lookup: e.target.value === 'Combo Box' ? { rowSourceType: 'Table/Query', rowSource: '' } : undefined })}><option>Text Box</option><option>Combo Box</option></select>
      </PropRow>
      {lk && <>
        <PropRow label="Row Source Type"><select value={lk.rowSourceType} onChange={(e) => set({ rowSourceType: e.target.value as 'Table/Query' | 'Value List', rowSource: '' })}><option>Table/Query</option><option>Value List</option></select></PropRow>
        {lk.rowSourceType === 'Table/Query' ? (
          <>
            <PropRow label="Row Source"><select value={lk.rowSource} onChange={(e) => set({ rowSource: e.target.value, boundField: '', displayField: '' })}><option value="" />{sources.map((s) => <option key={s}>{s}</option>)}</select></PropRow>
            <PropRow label="Bound Field"><select value={lk.boundField ?? ''} onChange={(e) => set({ boundField: e.target.value })}><option value="" />{cols.map((c) => <option key={c}>{c}</option>)}</select></PropRow>
            <PropRow label="Display Field"><select value={lk.displayField ?? ''} onChange={(e) => set({ displayField: e.target.value })}><option value="" />{cols.map((c) => <option key={c}>{c}</option>)}</select></PropRow>
          </>
        ) : <PropRow label="Row Source"><input value={lk.rowSource} placeholder="Value1;Value2;Value3" onChange={(e) => set({ rowSource: e.target.value })} /></PropRow>}
        <PropRow label="Limit To List"><select value={lk.limitToList ? 'Yes' : 'No'} onChange={(e) => set({ limitToList: e.target.value === 'Yes' })}><option>No</option><option>Yes</option></select></PropRow>
      </>}
      <div style={{ padding: 8 }}><button className="btn btn-sm" onClick={onWizard}>Lookup Wizard…</button></div>
    </>
  );
}

function IndexesDialog({ def, close, onChange }: { def: TableDef; close: (v: null) => void; onChange: (fid: string, v: FieldDef['indexed']) => void }) {
  const [, force] = useState(0);
  const pk = def.fields.filter((f) => f.primaryKey);
  return (
    <div>
      <table className="mini-grid" style={{ width: '100%' }}>
        <thead><tr><th>Index Name</th><th>Field Name</th><th>Unique</th><th>Indexed</th></tr></thead>
        <tbody>
          {pk.length > 0 && <tr><td>PrimaryKey</td><td>{pk.map((f) => f.name).join(' + ')}</td><td>Yes</td><td>Primary key</td></tr>}
          {def.fields.filter((f) => !f.primaryKey && !['Calculated', 'Attachment', 'Long Text'].includes(f.type)).map((f) => (
            <tr key={f.id}><td>{f.indexed && f.indexed !== 'No' ? `ix_${def.name}_${f.name}` : ''}</td><td>{f.name}</td><td>{f.indexed === 'Yes (No Duplicates)' ? 'Yes' : 'No'}</td>
              <td><select className="sel" value={f.indexed ?? 'No'} onChange={(e) => { onChange(f.id, e.target.value as FieldDef['indexed']); f.indexed = e.target.value as FieldDef['indexed']; force((x) => x + 1); }}>{['No', 'Yes (Duplicates OK)', 'Yes (No Duplicates)'].map((s) => <option key={s}>{s}</option>)}</select></td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small mt-2">Indexes are created in the SQLite database when you save the table.</p>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close(null)}>Close</button></div>
    </div>
  );
}

function LookupWizard({ p, field, close }: { p: WowProject; field: FieldDef; close: (v: FieldDef['lookup'] | 'none' | null) => void }) {
  const [kind, setKind] = useState<'table' | 'list'>(field.lookup?.rowSourceType === 'Value List' ? 'list' : 'table');
  const [src, setSrc] = useState(field.lookup?.rowSourceType === 'Table/Query' ? field.lookup.rowSource : '');
  const [bound, setBound] = useState(field.lookup?.boundField ?? '');
  const [disp, setDisp] = useState(field.lookup?.displayField ?? '');
  const [list, setList] = useState(field.lookup?.rowSourceType === 'Value List' ? field.lookup.rowSource.split(';').join('\n') : '');
  const sources = [...p.tableNames(), ...p.listObjects('query').map((o) => o.name)];
  const cols = src ? p.columnsOf(src) : [];
  useEffect(() => {
    if (!src) return;
    const t = p.getTable(src);
    const pk = t?.fields.find((f) => f.primaryKey)?.name ?? cols[0];
    if (!bound) setBound(pk ?? '');
    if (!disp) setDisp(t?.fields.find((f) => f.type === 'Short Text')?.name ?? pk ?? '');
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <p className="mb-2">This wizard creates a lookup column for <b>{field.name}</b>, which displays a list of values to choose from.</p>
      <label className="flex gap-2 items-center mb-1"><input type="radio" checked={kind === 'table'} onChange={() => setKind('table')} /> I want the lookup field to get the values from another table or query.</label>
      <label className="flex gap-2 items-center mb-3"><input type="radio" checked={kind === 'list'} onChange={() => setKind('list')} /> I will type in the values that I want.</label>
      {kind === 'table' ? (
        <>
          <div className="field-row"><label>Table or query</label><select className="sel" value={src} onChange={(e) => { setSrc(e.target.value); setBound(''); setDisp(''); }}><option value="" />{sources.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div className="field-row"><label>Value to store</label><select className="sel" value={bound} onChange={(e) => setBound(e.target.value)}>{cols.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div className="field-row"><label>Value to display</label><select className="sel" value={disp} onChange={(e) => setDisp(e.target.value)}>{cols.map((c) => <option key={c}>{c}</option>)}</select></div>
          <p className="muted small">Tip: store the key (e.g. ClassID) and display a name. Then create a relationship to enforce integrity.</p>
        </>
      ) : (
        <div><label className="block mb-1">One value per line:</label><textarea className="inp w-full" rows={6} value={list} onChange={(e) => setList(e.target.value)} data-autofocus /></div>
      )}
      <div className="dlg-buttons">
        {field.lookup && <button className="btn" onClick={() => close('none')}>Remove Lookup</button>}
        <button className="btn btn-primary" disabled={kind === 'table' ? !src || !bound : !list.trim()} onClick={() => close(kind === 'table' ? { rowSourceType: 'Table/Query', rowSource: src, boundField: bound, displayField: disp || bound, limitToList: true } : { rowSourceType: 'Value List', rowSource: list.split('\n').map((s) => s.trim()).filter(Boolean).join(';'), limitToList: true })}>Finish</button>
        <button className="btn" onClick={() => close(null)}>Cancel</button>
      </div>
    </div>
  );
}

export { errorBox };
