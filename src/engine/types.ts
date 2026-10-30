// Core type definitions for DBWOW.
// The real data lives in SQLite tables. Object definitions (field metadata,
// queries, forms, reports, layouts) live in the `_wow_objects` catalogue table
// inside the SAME SQLite file, so one .dbwow file is the whole database project.

export type DataType =
  | 'Short Text'
  | 'Long Text'
  | 'Number'
  | 'Large Number'
  | 'Date/Time'
  | 'Currency'
  | 'AutoNumber'
  | 'Yes/No'
  | 'Hyperlink'
  | 'Attachment'
  | 'Calculated';

export const DATA_TYPES: DataType[] = [
  'Short Text', 'Long Text', 'Number', 'Large Number', 'Date/Time', 'Currency',
  'AutoNumber', 'Yes/No', 'Hyperlink', 'Attachment', 'Calculated',
];

export type NumberSize = 'Byte' | 'Integer' | 'Long Integer' | 'Single' | 'Double' | 'Decimal';
export type IndexedOption = 'No' | 'Yes (Duplicates OK)' | 'Yes (No Duplicates)';

export interface LookupDef {
  rowSourceType: 'Table/Query' | 'Value List';
  rowSource: string;          // table/query name, or "A;B;C" for value list
  boundField?: string;        // stored value field (table/query lookups)
  displayField?: string;      // shown value field
  limitToList?: boolean;
}

export interface FieldDef {
  id: string;
  name: string;
  type: DataType;
  description?: string;
  fieldSize?: number;          // Short Text length
  numberSize?: NumberSize;     // Number field size
  format?: string;
  inputMask?: string;
  caption?: string;
  defaultValue?: string;       // Access-style expression
  textAlign?: 'General' | 'Left' | 'Center' | 'Right';  // datasheet and new form controls
  validationRule?: string;     // Access-style expression
  validationText?: string;
  required?: boolean;
  allowZeroLength?: boolean;
  indexed?: IndexedOption;
  decimalPlaces?: number | 'Auto';
  expression?: string;         // Calculated fields
  resultType?: 'Text' | 'Number' | 'Currency' | 'Date/Time' | 'Yes/No';
  lookup?: LookupDef;
  primaryKey?: boolean;
}

export interface DatasheetLayout {
  widths?: Record<string, number>;
  order?: string[];
  hidden?: string[];
}

export interface TableDef {
  name: string;
  description?: string;
  fields: FieldDef[];
  datasheet?: DatasheetLayout;
}

export interface RelationshipDef {
  id: string;
  name: string;
  primaryTable: string;
  relatedTable: string;
  fields: { primary: string; related: string }[];
  enforce: boolean;
  cascadeUpdate: boolean;
  cascadeDelete: boolean;
  joinType: 'inner' | 'left' | 'right'; // default join used by the Query Designer
}

export type ObjectType = 'table' | 'query' | 'form' | 'report' | 'macro' | 'module';
export const OBJECT_TYPES: ObjectType[] = ['table', 'query', 'form', 'report', 'macro', 'module'];

// ---------- Queries ----------
export type QueryKind = 'select' | 'crosstab' | 'maketable' | 'append' | 'update' | 'delete';
export type TotalOp = 'Group By' | 'Sum' | 'Avg' | 'Min' | 'Max' | 'Count' | 'First' | 'Last' | 'Expression' | 'Where';
export type CrosstabRole = '' | 'Row Heading' | 'Column Heading' | 'Value';

export interface QueryColumn {
  id: string;
  field: string;              // field name, "*", or "Alias: expression"
  table?: string;             // source table/query (blank for expressions)
  alias?: string;
  sort?: '' | 'Ascending' | 'Descending';
  show: boolean;
  criteria: string[];         // [0] = Criteria row, [1..] = Or rows (Access syntax)
  total?: TotalOp;
  updateTo?: string;          // Update query
  appendTo?: string;          // Append query target field
  crosstab?: CrosstabRole;
}

export interface QueryTableRef { id: string; name: string; alias?: string; x: number; y: number; }
export interface QueryJoin {
  id: string;
  leftTable: string; leftField: string;
  rightTable: string; rightField: string;
  type: 'inner' | 'left' | 'right';
}

export interface QueryDesign {
  tables: QueryTableRef[];
  joins: QueryJoin[];
  columns: QueryColumn[];
  totals: boolean;
  distinct: boolean;
  top?: string;               // "", "5", "25", "100", "5%"...
  targetTable?: string;       // make table / append / update / delete target
}

export interface QueryDef {
  name: string;
  kind: QueryKind;
  sql: string;                // canonical SQL (always present)
  design?: QueryDesign;       // present when representable in Design View
  sqlOnly?: boolean;          // true = authored in SQL view and not representable visually
  description?: string;
}

// ---------- Forms and Reports (shared canvas model) ----------
export type ControlType =
  | 'label' | 'textbox' | 'combobox' | 'listbox' | 'checkbox' | 'option' | 'toggle'
  | 'button' | 'datepicker' | 'image' | 'line' | 'rectangle' | 'subform' | 'navigation'
  | 'pagenumber' | 'datetime';

export interface ControlDef {
  id: string;
  type: ControlType;
  section: string;            // section id
  x: number; y: number; w: number; h: number;
  name: string;
  groupId?: string;
  props: Record<string, string | number | boolean | undefined>;
}

export type SectionKind =
  | 'formHeader' | 'detail' | 'formFooter'
  | 'reportHeader' | 'pageHeader' | 'groupHeader' | 'groupFooter' | 'pageFooter' | 'reportFooter';

export interface SectionDef {
  id: string;
  kind: SectionKind;
  name: string;
  height: number;
  visible: boolean;
  backColor?: string;
  groupIndex?: number;        // for group header/footer
  forceNewPage?: 'None' | 'Before Section' | 'After Section';
  keepTogether?: boolean;
}

export interface GroupLevel {
  id: string;
  field: string;
  order: 'Ascending' | 'Descending';
  header: boolean;
  footer: boolean;
  isSort?: boolean;           // a sort-only level (no header/footer)
}

export interface FormDef {
  name: string;
  recordSource: string;       // table or query name (or SQL)
  caption?: string;
  defaultView: 'Single Form' | 'Continuous Forms' | 'Datasheet';
  allowAdditions: boolean;
  allowEdits: boolean;
  allowDeletions: boolean;
  navigationButtons: boolean;
  width: number;
  sections: SectionDef[];
  controls: ControlDef[];
  backColor?: string;
}

export interface ReportDef {
  name: string;
  recordSource: string;
  caption?: string;
  width: number;
  sections: SectionDef[];
  controls: ControlDef[];
  groups: GroupLevel[];
  page: { size: 'A4' | 'Letter'; orientation: 'Portrait' | 'Landscape'; margin: number };
}

export interface MacroDef { name: string; actions: { action: string; argument: string }[]; }
export interface ModuleDef { name: string; notes: string; }

export interface CatalogObject<T = unknown> {
  type: ObjectType | 'layout';
  name: string;
  def: T;
  created: string;
  modified: string;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  changes?: number;
  ms: number;
}
