// WowProject = one database project. Owns the SQLite connection, the object
// catalogue, schema management (create / rebuild tables), relationships with
// real FOREIGN KEY constraints, saved queries (as SQLite views where possible),
// forms, reports and layouts.
import { WowDatabase, q, lit, type Params } from './sqlite';
import type {
  CatalogObject, FieldDef, FormDef, ObjectType, QueryDef, RelationshipDef, ReportDef, TableDef, MacroDef, ModuleDef,
} from './types';
import { parseCriteria, parseExpr, toSql, ExprError } from './expr';

export const SYS_PREFIX = '_wow_';
export const FORMAT_VERSION = 1;

export function uid(prefix = 'id'): string {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

export class WowError extends Error {
  constructor(message: string, public detail?: string) { super(message); }
}

export class WowProject {
  constructor(public db: WowDatabase) { this.ensureCatalog(); }

  static async create(name: string, description = ''): Promise<WowProject> {
    const p = new WowProject(await WowDatabase.create());
    p.setMeta('name', name);
    p.setMeta('description', description);
    p.setMeta('created', new Date().toISOString());
    return p;
  }

  static async open(bytes: Uint8Array): Promise<WowProject> {
    const db = await WowDatabase.create(bytes);
    const ok = db.scalar("SELECT count(*) FROM sqlite_master WHERE name='_wow_objects'");
    const p = new WowProject(db);
    if (!ok) p.adoptPlainSqlite();
    return p;
  }

  // ---------------- catalogue ----------------
  private ensureCatalog() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _wow_meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS _wow_objects (
        type TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, def TEXT NOT NULL,
        created TEXT NOT NULL, modified TEXT NOT NULL, PRIMARY KEY (type, name));
    `, true);
    if (!this.getMeta('format')) this.setMeta('format', String(FORMAT_VERSION), true);
  }

  getMeta(key: string): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM _wow_meta WHERE key=?', [key])?.value;
  }
  setMeta(key: string, value: string, silent = false) {
    this.db.run('INSERT INTO _wow_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value], silent);
  }
  get name() { return this.getMeta('name') || 'Database1'; }

  getObject<T>(type: string, name: string): CatalogObject<T> | undefined {
    const r = this.db.get<{ type: string; name: string; def: string; created: string; modified: string }>(
      'SELECT * FROM _wow_objects WHERE type=? AND name=?', [type, name]);
    return r ? { type: r.type as ObjectType, name: r.name, def: JSON.parse(r.def) as T, created: r.created, modified: r.modified } : undefined;
  }
  putObject(type: string, name: string, def: unknown) {
    const t = new Date().toISOString();
    this.db.run(`INSERT INTO _wow_objects(type,name,def,created,modified) VALUES(?,?,?,?,?)
      ON CONFLICT(type,name) DO UPDATE SET def=excluded.def, modified=excluded.modified, name=excluded.name`,
    [type, name, JSON.stringify(def), t, t]);
  }
  listObjects(type: string): { name: string; modified: string; created: string }[] {
    return this.db.all('SELECT name, modified, created FROM _wow_objects WHERE type=? ORDER BY name COLLATE NOCASE', [type]);
  }
  private deleteCatalog(type: string, name: string) { this.db.run('DELETE FROM _wow_objects WHERE type=? AND name=?', [type, name], true); }

  /** Names used by tables and queries share a namespace (as in Access and SQLite). */
  nameInUse(name: string, except?: { type: string; name: string }): string | null {
    const rows = this.db.all<{ type: string; name: string }>(
      "SELECT type, name FROM _wow_objects WHERE name=? AND type IN ('table','query','form','report','macro','module')", [name]);
    for (const r of rows) {
      if (except && r.type === except.type && r.name.toLowerCase() === except.name.toLowerCase()) continue;
      return r.type;
    }
    const sys = this.db.scalar('SELECT type FROM sqlite_master WHERE name=? COLLATE NOCASE', [name]);
    if (sys && !(except && except.name.toLowerCase() === name.toLowerCase())) return String(sys);
    return null;
  }

  validateObjectName(name: string, type: string, except?: { type: string; name: string }) {
    const n = name.trim();
    if (!n) throw new WowError('Please enter a name.');
    if (n.length > 64) throw new WowError('Object names can be at most 64 characters long.');
    if (/[.!`[\]"]/.test(n)) throw new WowError('Names cannot contain . ! ` [ ] or " characters.');
    if (n.toLowerCase().startsWith(SYS_PREFIX) || n.toLowerCase().startsWith('sqlite_')) throw new WowError('Names starting with "_wow_" or "sqlite_" are reserved for the system.');
    const clash = this.nameInUse(n, except);
    if (clash) {
      const shared = (type === 'table' || type === 'query') && (clash === 'table' || clash === 'query' || clash === 'view');
      if (clash === type || shared) throw new WowError(`An object named "${n}" already exists. Choose a different name.`);
    }
  }

  // ---------------- tables ----------------
  tables(): TableDef[] { return this.listObjects('table').map((o) => this.getTable(o.name)!).filter(Boolean); }
  tableNames(): string[] { return this.listObjects('table').map((o) => o.name); }
  getTable(name: string): TableDef | undefined { return this.getObject<TableDef>('table', name)?.def; }

  /** Create a new table or apply a changed design to an existing one (real ALTER via rebuild). */
  saveTableDesign(def: TableDef, originalName?: string): { rebuilt: boolean } {
    const d = normaliseTable(def);
    this.validateTable(d, originalName);
    const existing = originalName ? this.getTable(originalName) : undefined;
    if (!existing) {
      this.db.transaction(() => {
        this.db.exec(this.createTableSql(d), true);
        this.createIndexes(d);
        this.createTriggers(d);
        this.putObject('table', d.name, d);
      });
      return { rebuilt: false };
    }
    // rename relationships/queries referencing old name
    this.rebuildTable(existing, d);
    return { rebuilt: true };
  }

  private validateTable(d: TableDef, originalName?: string) {
    this.validateObjectName(d.name, 'table', originalName ? { type: 'table', name: originalName } : undefined);
    if (!d.fields.length) throw new WowError('A table must contain at least one field.');
    const seen = new Set<string>();
    for (const f of d.fields) {
      const n = f.name.trim();
      if (!n) throw new WowError('Every field needs a name. Remove empty rows or give them a name.');
      if (n.length > 64) throw new WowError(`Field name "${n}" is longer than 64 characters.`);
      if (/[.!`[\]]/.test(n)) throw new WowError(`Field name "${n}" contains a character that is not allowed (. ! \` [ ]).`);
      if (seen.has(n.toLowerCase())) throw new WowError(`The field name "${n}" is used more than once. Field names must be unique within a table.`);
      seen.add(n.toLowerCase());
      if (f.type === 'Calculated' && !f.expression) throw new WowError(`Calculated field "${n}" needs an Expression.`);
      if (f.primaryKey && f.type === 'Calculated') throw new WowError('A calculated field cannot be a primary key.');
      if (f.type === 'Short Text' && f.fieldSize !== undefined && (f.fieldSize < 1 || f.fieldSize > 255)) throw new WowError(`Field Size for "${n}" must be between 1 and 255.`);
    }
    if (d.fields.filter((f) => f.type === 'AutoNumber').length > 1) throw new WowError('A table can only have one AutoNumber field.');
    // validate expressions early so errors are clear
    for (const f of d.fields) {
      try {
        if (f.validationRule) this.fieldCheckSql(d, f);
        if (f.defaultValue) this.defaultSql(f);
        if (f.type === 'Calculated') this.calcSql(d, f);
      } catch (e) {
        throw new WowError(`Problem in field "${f.name}": ${(e as Error).message}`);
      }
    }
  }

  private resolver(d: TableDef) {
    return (parts: string[]) => {
      const n = parts[parts.length - 1].toLowerCase();
      const f = d.fields.find((x) => x.name.toLowerCase() === n);
      return f ? q(f.name) : null;
    };
  }
  fieldCheckSql(d: TableDef, f: FieldDef): string {
    return toSql(parseCriteria(f.validationRule!, 'validation'), { self: q(f.name), resolve: this.resolver(d) });
  }
  defaultSql(f: FieldDef): string {
    const v = f.defaultValue!.trim();
    const n = parseExpr(v);
    if (n.k === 'ref' && !n.bracket && n.parts.length === 1) return `'${n.parts[0].replace(/'/g, "''")}'`; // bare word = text
    const sql = toSql(n, {});
    return /^[-0-9.]+$|^'.*'$|^NULL$/s.test(sql) ? sql : `(${sql})`;
  }
  calcSql(d: TableDef, f: FieldDef): string {
    return toSql(parseExpr(f.expression!), { resolve: this.resolver(d) });
  }

  createTableSql(d: TableDef, tableName = d.name): string {
    const pk = d.fields.filter((f) => f.primaryKey);
    const singleAutoPk = pk.length === 1 && pk[0].type === 'AutoNumber';
    const cols: string[] = [];
    for (const f of d.fields) {
      const c = q(f.name);
      const parts: string[] = [c];
      const checks: string[] = [];
      switch (f.type) {
        case 'AutoNumber':
          parts.push('INTEGER');
          if (singleAutoPk) parts.push('PRIMARY KEY AUTOINCREMENT');
          else parts.push('NOT NULL');
          break;
        case 'Short Text':
          parts.push('TEXT COLLATE NOCASE');
          checks.push(`CONSTRAINT ${q('len:' + f.name)} CHECK (${c} IS NULL OR length(${c}) <= ${f.fieldSize ?? 255})`);
          break;
        case 'Long Text': case 'Hyperlink': case 'Attachment':
          parts.push('TEXT COLLATE NOCASE'); break;
        case 'Number': {
          const s = f.numberSize ?? 'Long Integer';
          if (s === 'Single' || s === 'Double' || s === 'Decimal') parts.push('REAL');
          else {
            parts.push('INTEGER');
            const range = s === 'Byte' ? [0, 255] : s === 'Integer' ? [-32768, 32767] : [-2147483648, 2147483647];
            checks.push(`CONSTRAINT ${q('range:' + f.name)} CHECK (${c} IS NULL OR ${c} BETWEEN ${range[0]} AND ${range[1]})`);
          }
          break;
        }
        case 'Large Number': parts.push('INTEGER'); break;
        case 'Currency': parts.push('REAL'); break;
        case 'Date/Time':
          parts.push('TEXT');
          checks.push(`CONSTRAINT ${q('date:' + f.name)} CHECK (${c} IS NULL OR datetime(${c}) IS NOT NULL)`);
          break;
        case 'Yes/No':
          parts.push(`INTEGER NOT NULL DEFAULT ${/^(yes|true|-1|1|on)$/i.test((f.defaultValue ?? '').trim()) ? 1 : 0}`);
          checks.push(`CONSTRAINT ${q('yn:' + f.name)} CHECK (${c} IN (0,1))`);
          break;
        case 'Calculated': {
          const rt = f.resultType ?? 'Text';
          parts.push(rt === 'Number' || rt === 'Currency' ? 'REAL' : rt === 'Yes/No' ? 'INTEGER' : 'TEXT');
          parts.push(`GENERATED ALWAYS AS (${this.calcSql(d, f)}) VIRTUAL`);
          break;
        }
      }
      if (f.type !== 'Calculated' && f.type !== 'Yes/No' && f.type !== 'AutoNumber') {
        if (f.required || (f.primaryKey && !singleAutoPk)) parts.push('NOT NULL');
        if (f.defaultValue) parts.push('DEFAULT ' + this.defaultSql(f));
        if ((f.type === 'Short Text' || f.type === 'Long Text') && f.allowZeroLength === false) {
          checks.push(`CONSTRAINT ${q('zl:' + f.name)} CHECK (${c} IS NULL OR ${c} <> '')`);
        }
        if (f.validationRule && !this.ruleNeedsTrigger(d, f)) checks.push(`CONSTRAINT ${q('vr:' + f.name)} CHECK (${c} IS NULL OR (${this.fieldCheckSql(d, f)}))`);
      }
      cols.push([...parts, ...checks].join(' '));
    }
    if (pk.length && !singleAutoPk) cols.push(`PRIMARY KEY (${pk.map((f) => q(f.name)).join(', ')})`);
    for (const r of this.relationships().filter((r) => r.enforce && r.relatedTable.toLowerCase() === d.name.toLowerCase())) {
      const fkCols = r.fields.map((p) => p.related);
      if (!fkCols.every((c) => d.fields.some((f) => f.name.toLowerCase() === c.toLowerCase()))) continue;
      const parentName = r.primaryTable.toLowerCase() === d.name.toLowerCase() ? tableName : r.primaryTable;
      cols.push(`CONSTRAINT ${q('fk:' + r.name)} FOREIGN KEY (${fkCols.map(q).join(', ')}) REFERENCES ${q(parentName)} (${r.fields.map((p) => q(p.primary)).join(', ')})` +
        ` ON UPDATE ${r.cascadeUpdate ? 'CASCADE' : 'NO ACTION'} ON DELETE ${r.cascadeDelete ? 'CASCADE' : 'NO ACTION'}`);
    }
    return `CREATE TABLE ${q(tableName)} (\n  ${cols.join(',\n  ')}\n) STRICT;`;
  }

  /** Rules using Date()/Now() are not allowed in SQLite CHECK constraints, so they are enforced by triggers. */
  ruleNeedsTrigger(d: TableDef, f: FieldDef): boolean {
    return !!f.validationRule && /'now'/.test(this.fieldCheckSql(d, f));
  }
  triggerSql(d: TableDef): string[] {
    const out: string[] = [];
    for (const f of d.fields) {
      if (!this.ruleNeedsTrigger(d, f)) continue;
      const self = `NEW.${q(f.name)}`;
      const cond = toSql(parseCriteria(f.validationRule!, 'validation'), { self, resolve: (parts) => { const n = parts[parts.length - 1].toLowerCase(); const x = d.fields.find((y) => y.name.toLowerCase() === n); return x ? `NEW.${q(x.name)}` : null; } });
      for (const ev of ['INSERT', 'UPDATE']) {
        out.push(`CREATE TRIGGER ${q(`_wow_vr_${d.name}_${f.name}_${ev.toLowerCase()}`)} BEFORE ${ev} ON ${q(d.name)} FOR EACH ROW WHEN NOT (${self} IS NULL OR (${cond})) BEGIN SELECT RAISE(ABORT, ${lit('CHECK constraint failed: vr:' + f.name)}); END;`);
      }
    }
    return out;
  }
  private createTriggers(d: TableDef) { for (const t of this.triggerSql(d)) this.db.exec(t, true); }

  private createIndexes(d: TableDef) {
    for (const f of d.fields) {
      if (!f.indexed || f.indexed === 'No' || f.type === 'Calculated') continue;
      const pk = d.fields.filter((x) => x.primaryKey);
      if (pk.length === 1 && pk[0].id === f.id) continue; // PK already indexed
      const unique = f.indexed === 'Yes (No Duplicates)';
      this.db.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${q(`ix_${d.name}_${f.name}`)} ON ${q(d.name)} (${q(f.name)});`, true);
    }
  }

  /**
   * The SQLite "12-step" table rebuild, used for any structural change.
   * Child tables whose FOREIGN KEYs point at this table are rebuilt in the
   * same transaction when the table or its key fields are renamed.
   */
  private rebuildTable(oldDef: TableDef, newDef: TableDef, extra?: () => void) {
    const oldName = oldDef.name;
    const renamed = oldName.toLowerCase() !== newDef.name.toLowerCase();
    this.db.raw.run('PRAGMA foreign_keys = OFF;');
    try {
      this.db.raw.run('BEGIN;');
      try {
        this.dropAllViews();
        if (renamed) {
          for (const r of this.relationships()) {
            let ch = false;
            if (r.primaryTable.toLowerCase() === oldName.toLowerCase()) { r.primaryTable = newDef.name; ch = true; }
            if (r.relatedTable.toLowerCase() === oldName.toLowerCase()) { r.relatedTable = newDef.name; ch = true; }
            if (ch) this.putRel(r);
          }
        }
        // keep relationship field names in sync with renamed fields
        let keyRenamed = false;
        for (const r of this.relationships()) {
          let ch = false;
          for (const pr of r.fields) {
            if (r.primaryTable.toLowerCase() === newDef.name.toLowerCase()) {
              const of = oldDef.fields.find((f) => f.name.toLowerCase() === pr.primary.toLowerCase());
              const nf = of && newDef.fields.find((f) => f.id === of.id);
              if (nf && nf.name !== pr.primary) { pr.primary = nf.name; ch = true; if (r.enforce) keyRenamed = true; }
            }
            if (r.relatedTable.toLowerCase() === newDef.name.toLowerCase()) {
              const of = oldDef.fields.find((f) => f.name.toLowerCase() === pr.related.toLowerCase());
              const nf = of && newDef.fields.find((f) => f.id === of.id);
              if (nf && nf.name !== pr.related) { pr.related = nf.name; ch = true; }
            }
          }
          if (ch) this.putRel(r);
        }
        for (const r of this.relationships()) {
          const touches = r.primaryTable.toLowerCase() === newDef.name.toLowerCase() || r.relatedTable.toLowerCase() === newDef.name.toLowerCase();
          if (!touches) continue;
          const okP = r.primaryTable.toLowerCase() !== newDef.name.toLowerCase() || r.fields.every((x) => newDef.fields.some((f) => f.name.toLowerCase() === x.primary.toLowerCase()));
          const okR = r.relatedTable.toLowerCase() !== newDef.name.toLowerCase() || r.fields.every((x) => newDef.fields.some((f) => f.name.toLowerCase() === x.related.toLowerCase()));
          if (!okP || !okR) throw new WowError(`Field(s) used in relationship "${r.name}" (${r.primaryTable} → ${r.relatedTable}) cannot be deleted. Delete the relationship in the Relationships window first.`);
        }
        extra?.();
        this.rebuildInner(oldDef, newDef);
        if (renamed || keyRenamed) {
          const kids = new Set(this.relationships().filter((r) => r.enforce && r.primaryTable.toLowerCase() === newDef.name.toLowerCase() && r.relatedTable.toLowerCase() !== newDef.name.toLowerCase()).map((r) => r.relatedTable));
          for (const k of kids) { const kd = this.getTable(k); if (kd) this.rebuildInner(kd, kd); }
        }
        const v = this.db.query('PRAGMA foreign_key_check;');
        if (v.rows.length) {
          const t = String(v.rows[0][0]);
          throw new WowError(`The change would break referential integrity: ${v.rows.length} record(s) in "${t}" have no matching record in the related table.`);
        }
        this.recreateViews();
        this.db.raw.run('COMMIT;');
      } catch (e) {
        try { this.db.raw.run('ROLLBACK;'); } catch { /* ignore */ }
        throw friendlyError(e, this, 'design');
      }
    } finally {
      this.db.raw.run('PRAGMA foreign_keys = ON;');
      this.db.notify();
    }
  }

  /** Copy a table into a freshly created one with the new definition (inside a transaction). */
  private rebuildInner(oldDef: TableDef, newDef: TableDef) {
    const tmp = '_wow_rebuild_' + Math.random().toString(36).slice(2, 7);
    const copyPairs: { from: string; to: string }[] = [];
    for (const nf of newDef.fields) {
      if (nf.type === 'Calculated') continue;
      const of = oldDef.fields.find((o) => o.id === nf.id) ?? oldDef.fields.find((o) => o.name.toLowerCase() === nf.name.toLowerCase());
      if (of && of.type !== 'Calculated') copyPairs.push({ from: of.name, to: nf.name });
    }
    this.db.exec(this.createTableSql(newDef, tmp), true);
    if (copyPairs.length) this.db.exec(`INSERT INTO ${q(tmp)} (${copyPairs.map((x) => q(x.to)).join(', ')}) SELECT ${copyPairs.map((x) => q(x.from)).join(', ')} FROM ${q(oldDef.name)};`, true);
    this.db.exec(`DROP TABLE ${q(oldDef.name)};`, true);
    this.db.exec(`ALTER TABLE ${q(tmp)} RENAME TO ${q(newDef.name)};`, true);
    this.createIndexes(newDef);
    this.createTriggers(newDef);
    if (oldDef.name.toLowerCase() !== newDef.name.toLowerCase()) this.deleteCatalog('table', oldDef.name);
    this.putObjectSilent('table', newDef.name, newDef);
  }

  private putObjectSilent(type: string, name: string, def: unknown) {
    const t = new Date().toISOString();
    this.db.run(`INSERT INTO _wow_objects(type,name,def,created,modified) VALUES(?,?,?,?,?)
      ON CONFLICT(type,name) DO UPDATE SET def=excluded.def, modified=excluded.modified, name=excluded.name`, [type, name, JSON.stringify(def), t, t], true);
  }

  /** Save only presentation info (datasheet column widths etc.) without touching schema. */
  saveTableLayout(name: string, layout: TableDef['datasheet']) {
    const t = this.getTable(name); if (!t) return;
    t.datasheet = layout; this.putObject('table', name, t);
  }

  deleteTable(name: string) {
    const rels = this.relationships().filter((r) => r.primaryTable.toLowerCase() === name.toLowerCase() || r.relatedTable.toLowerCase() === name.toLowerCase());
    if (rels.length) throw new WowError(`You can't delete the table "${name}" until its relationships to other tables have been deleted (${rels.map((r) => r.primaryTable + '→' + r.relatedTable).join(', ')}).`);
    this.db.transaction(() => {
      this.dropAllViews();
      this.db.exec(`DROP TABLE ${q(name)};`, true);
      this.deleteCatalog('table', name);
      this.recreateViews();
    });
  }

  // ---------------- relationships ----------------
  relationships(): RelationshipDef[] {
    return this.listObjects('relationship').map((o) => this.getObject<RelationshipDef>('relationship', o.name)!.def);
  }
  private putRel(r: RelationshipDef) { this.putObjectSilent('relationship', r.name, r); }

  /** Work out 1:1 / 1:∞ from unique indexes; returns null if invalid. */
  relationshipType(r: Pick<RelationshipDef, 'primaryTable' | 'relatedTable' | 'fields'>): 'One-To-One' | 'One-To-Many' | 'Indeterminate' {
    const pu = this.isUnique(r.primaryTable, r.fields.map((f) => f.primary));
    const ru = this.isUnique(r.relatedTable, r.fields.map((f) => f.related));
    if (pu && ru) return 'One-To-One';
    if (pu) return 'One-To-Many';
    return 'Indeterminate';
  }

  isUnique(table: string, cols: string[]): boolean {
    const t = this.getTable(table); if (!t) return false;
    const pk = t.fields.filter((f) => f.primaryKey).map((f) => f.name.toLowerCase());
    const c = cols.map((x) => x.toLowerCase()).sort();
    if (pk.length && pk.length === c.length && [...pk].sort().every((v, i) => v === c[i])) return true;
    if (c.length === 1) {
      const f = t.fields.find((x) => x.name.toLowerCase() === c[0]);
      if (f?.indexed === 'Yes (No Duplicates)') return true;
    }
    return false;
  }

  saveRelationship(input: Omit<RelationshipDef, 'id' | 'name'> & { id?: string; name?: string }): RelationshipDef {
    const P = this.getTable(input.primaryTable), R = this.getTable(input.relatedTable);
    if (!P || !R) throw new WowError('Both tables must exist before creating a relationship.');
    if (!input.fields.length || input.fields.some((f) => !f.primary || !f.related)) throw new WowError('Choose the matching fields in both tables.');
    for (const p of input.fields) {
      const pf = P.fields.find((f) => f.name.toLowerCase() === p.primary.toLowerCase());
      const rf = R.fields.find((f) => f.name.toLowerCase() === p.related.toLowerCase());
      if (!pf || !rf) throw new WowError('One of the selected fields does not exist.');
      if (!compatibleTypes(pf, rf)) throw new WowError(`Relationship must be on the same number of fields with the same data types. "${P.name}.${pf.name}" is ${pf.type} but "${R.name}.${rf.name}" is ${rf.type}. (An AutoNumber key matches a Number field.)`);
    }
    const type = this.relationshipType(input);
    if (input.enforce && type === 'Indeterminate') {
      throw new WowError(`No unique index found for the referenced field(s) of the primary table "${P.name}". Referential integrity needs the primary-table side to be its primary key or a unique index (Indexed: Yes (No Duplicates)).`);
    }
    const existing = this.relationships();
    const name = input.name || uniqueName(`${input.primaryTable}${input.relatedTable}`, existing.map((r) => r.name));
    const old = existing.find((r) => r.id === input.id || r.name === input.name);
    const dup = existing.find((r) => r !== old && r.primaryTable.toLowerCase() === input.primaryTable.toLowerCase() && r.relatedTable.toLowerCase() === input.relatedTable.toLowerCase() &&
      JSON.stringify(r.fields.map((f) => [f.primary.toLowerCase(), f.related.toLowerCase()])) === JSON.stringify(input.fields.map((f) => [f.primary.toLowerCase(), f.related.toLowerCase()])));
    if (dup) throw new WowError('A relationship between these fields already exists. Double-click its line to edit it.');
    const rel: RelationshipDef = { id: old?.id ?? input.id ?? uid('rel'), name: old?.name ?? name, primaryTable: P.name, relatedTable: R.name, fields: input.fields, enforce: input.enforce, cascadeUpdate: input.enforce && input.cascadeUpdate, cascadeDelete: input.enforce && input.cascadeDelete, joinType: input.joinType ?? 'inner' };
    if (rel.enforce) {
      // check existing data first, with a meaningful explanation
      const cond = rel.fields.map((f) => `c.${q(f.related)} = p.${q(f.primary)}`).join(' AND ');
      const notNull = rel.fields.map((f) => `c.${q(f.related)} IS NOT NULL`).join(' AND ');
      const orphans = Number(this.db.scalar(`SELECT count(*) FROM ${q(R.name)} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${q(P.name)} p WHERE ${cond})`));
      if (orphans > 0) throw new WowError(`WOWDB can't enforce referential integrity: ${orphans} record(s) in "${R.name}" have a ${rel.fields.map((f) => f.related).join('/')} value that does not exist in "${P.name}". Fix or delete those records, or create the relationship without enforcing integrity.`);
    }
    const needsRebuild = rel.enforce || (old?.enforce ?? false);
    if (needsRebuild) {
      this.putRel(rel); // createTableSql reads relationships
      try {
        this.rebuildTable(R, R);
      } catch (e) {
        if (old) this.putRel(old); else this.deleteCatalog('relationship', rel.name);
        throw e;
      }
    } else {
      this.putObject('relationship', rel.name, rel);
    }
    this.db.notify();
    return rel;
  }

  deleteRelationship(name: string) {
    const r = this.relationships().find((x) => x.name === name);
    if (!r) return;
    this.deleteCatalog('relationship', r.name);
    if (r.enforce) {
      const R = this.getTable(r.relatedTable);
      if (R) this.rebuildTable(R, R);
    }
    this.db.notify();
  }

  // ---------------- queries ----------------
  queries(): QueryDef[] { return this.listObjects('query').map((o) => this.getQuery(o.name)!).filter(Boolean); }
  getQuery(name: string): QueryDef | undefined { return this.getObject<QueryDef>('query', name)?.def; }

  saveQuery(def: QueryDef, originalName?: string) {
    this.validateObjectName(def.name, 'query', originalName ? { type: 'query', name: originalName } : undefined);
    if (!def.sql.trim()) throw new WowError('The query is empty. Add fields in Design View or write SQL.');
    this.db.transaction(() => {
      if (originalName && originalName.toLowerCase() !== def.name.toLowerCase()) {
        this.db.exec(`DROP VIEW IF EXISTS ${q(originalName)};`, true);
        this.deleteCatalog('query', originalName);
      }
      this.putObjectSilent('query', def.name, def);
      this.createView(def);
    });
  }

  /** A select query without parameters becomes a real SQLite VIEW so other queries, forms and reports can use it. */
  viewable(def: QueryDef): boolean {
    if (def.kind !== 'select' || !/^\s*(select|with)\b/i.test(def.sql)) return false;
    const s = stripStrings(def.sql);
    if (/:\w+|\?/.test(s.replace(/"(?:[^"]|"")*"/g, '""'))) return false;
    return prepareParams(s, this.knownIdentifiers()).params.length === 0;
  }
  /** Table, query and field names: [Name] matching one of these is an identifier, not a parameter. */
  knownIdentifiers(): Set<string> {
    const s = new Set<string>();
    for (const t of this.tables()) { s.add(t.name.toLowerCase()); t.fields.forEach((f) => s.add(f.name.toLowerCase())); }
    for (const o of this.listObjects('query')) s.add(o.name.toLowerCase());
    for (const v of this.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='view'")) {
      try { this.columnsOfView(v.name).forEach((c) => s.add(c.toLowerCase())); } catch { /* ignore */ }
    }
    return s;
  }
  private columnsOfView(name: string): string[] {
    const st = this.db.raw.prepare(`SELECT * FROM ${q(name)} LIMIT 0`);
    try { return st.getColumnNames(); } finally { st.free(); }
  }
  /** SQL of a saved query ready for SQLite ([Field] → "Field"). */
  viewSql(def: QueryDef): string { return prepareParams(def.sql.trim().replace(/;\s*$/, ''), this.knownIdentifiers()).sql; }
  private createView(def: QueryDef) {
    this.db.exec(`DROP VIEW IF EXISTS ${q(def.name)};`, true);
    if (this.viewable(def)) {
      try { this.db.exec(`CREATE VIEW ${q(def.name)} AS ${this.viewSql(def)};`, true); }
      catch (e) { throw new WowError(`The query could not be saved: ${(e as Error).message}`); }
    }
  }
  private dropAllViews() {
    const views = this.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='view'");
    for (const v of views) this.db.exec(`DROP VIEW IF EXISTS ${q(v.name)};`, true);
  }
  /** Recreate views in dependency order (queries can be built on queries). */
  recreateViews(): string[] {
    const pending = this.queries().filter((d) => this.viewable(d));
    const failed: string[] = [];
    for (let pass = 0; pass < pending.length + 1 && pending.length; pass++) {
      for (let i = pending.length - 1; i >= 0; i--) {
        try { this.db.exec(`DROP VIEW IF EXISTS ${q(pending[i].name)}; CREATE VIEW ${q(pending[i].name)} AS ${this.viewSql(pending[i])};`, true); pending.splice(i, 1); }
        catch { /* retry next pass */ }
      }
    }
    for (const p of pending) failed.push(p.name);
    return failed;
  }

  // ---------------- forms / reports / macros / modules ----------------
  getForm(name: string) { return this.getObject<FormDef>('form', name)?.def; }
  getReport(name: string) { return this.getObject<ReportDef>('report', name)?.def; }
  getMacro(name: string) { return this.getObject<MacroDef>('macro', name)?.def; }
  getModule(name: string) { return this.getObject<ModuleDef>('module', name)?.def; }
  saveForm(def: FormDef, originalName?: string) { this.saveSimple('form', def, originalName); }
  saveReport(def: ReportDef, originalName?: string) { this.saveSimple('report', def, originalName); }
  saveMacro(def: MacroDef, originalName?: string) { this.saveSimple('macro', def, originalName); }
  saveModule(def: ModuleDef, originalName?: string) { this.saveSimple('module', def, originalName); }
  private saveSimple(type: string, def: { name: string }, originalName?: string) {
    this.validateObjectName(def.name, type, originalName ? { type, name: originalName } : undefined);
    this.db.transaction(() => {
      if (originalName && originalName.toLowerCase() !== def.name.toLowerCase()) this.deleteCatalog(type, originalName);
      this.putObjectSilent(type, def.name, def);
    });
  }

  getLayout<T>(name: string): T | undefined { return this.getObject<T>('layout', name)?.def; }
  saveLayout(name: string, def: unknown) { this.putObject('layout', name, def); }

  // ---------------- generic object operations ----------------
  renameObject(type: ObjectType, oldName: string, newName: string) {
    if (oldName === newName) return;
    this.validateObjectName(newName, type, { type, name: oldName });
    if (type === 'table') {
      const t = this.getTable(oldName)!;
      this.rebuildTable(t, { ...t, name: newName });
      this.retargetReferences(oldName, newName);
      return;
    }
    if (type === 'query') {
      const d = this.getQuery(oldName)!;
      this.saveQuery({ ...d, name: newName }, oldName);
      this.retargetReferences(oldName, newName);
      return;
    }
    const o = this.getObject<{ name: string }>(type, oldName)!;
    this.saveSimple(type, { ...o.def, name: newName }, oldName);
  }

  /** Forms/reports/queries whose record source is a renamed table/query follow the rename. */
  private retargetReferences(oldName: string, newName: string) {
    for (const t of ['form', 'report'] as const) {
      for (const o of this.listObjects(t)) {
        const d = this.getObject<FormDef | ReportDef>(t, o.name)!.def;
        if (d.recordSource?.toLowerCase() === oldName.toLowerCase()) { d.recordSource = newName; this.putObjectSilent(t, o.name, d); }
      }
    }
    for (const qd of this.queries()) {
      if (!qd.design) continue;
      let ch = false;
      for (const t of qd.design.tables) if (t.name.toLowerCase() === oldName.toLowerCase()) { t.name = newName; ch = true; }
      for (const c of qd.design.columns) if (c.table?.toLowerCase() === oldName.toLowerCase()) { c.table = newName; ch = true; }
      for (const j of qd.design.joins) {
        if (j.leftTable.toLowerCase() === oldName.toLowerCase()) { j.leftTable = newName; ch = true; }
        if (j.rightTable.toLowerCase() === oldName.toLowerCase()) { j.rightTable = newName; ch = true; }
      }
      if (qd.design.targetTable?.toLowerCase() === oldName.toLowerCase()) { qd.design.targetTable = newName; ch = true; }
      if (ch && WowProject.sqlFromDesign) { try { qd.sql = WowProject.sqlFromDesign(this, qd.design, qd.kind); } catch { /* keep old SQL */ } }
      if (ch) this.putObjectSilent('query', qd.name, qd);
    }
    for (const qd of this.queries()) {
      if (qd.design && !qd.sqlOnly) continue;
      const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`("${esc}"|\\[${esc}\\]|\\b${esc}\\b)`, 'gi');
      const sql = qd.sql.replace(re, (m) => (m.startsWith('"') ? q(newName) : m.startsWith('[') ? `[${newName}]` : newName));
      if (sql !== qd.sql) this.putObjectSilent('query', qd.name, { ...qd, sql });
    }
    this.recreateViews();
    this.db.notify();
  }

  /** Set by queries.ts (avoids a circular import): regenerate SQL from a design. */
  static sqlFromDesign?: (p: WowProject, d: NonNullable<QueryDef['design']>, kind: QueryDef['kind']) => string;

  deleteObject(type: ObjectType, name: string) {
    if (type === 'table') return this.deleteTable(name);
    this.db.transaction(() => {
      if (type === 'query') this.db.exec(`DROP VIEW IF EXISTS ${q(name)};`, true);
      this.deleteCatalog(type, name);
    });
  }

  duplicateObject(type: ObjectType, name: string, newName: string, withData = true) {
    this.validateObjectName(newName, type);
    if (type === 'table') {
      const t = this.getTable(name)!;
      const copy: TableDef = JSON.parse(JSON.stringify({ ...t, name: newName }));
      this.saveTableDesign(copy);
      if (withData) {
        const cols = t.fields.filter((f) => f.type !== 'Calculated').map((f) => q(f.name)).join(', ');
        this.db.run(`INSERT INTO ${q(newName)} (${cols}) SELECT ${cols} FROM ${q(name)}`);
      }
      return;
    }
    const o = this.getObject<{ name: string }>(type, name)!;
    const def = JSON.parse(JSON.stringify({ ...o.def, name: newName }));
    if (type === 'query') this.saveQuery(def); else this.saveSimple(type, def);
  }

  // ---------------- data helpers ----------------
  /** SELECT statement for a table or query name used as a record source. */
  sourceSql(source: string): { sql: string; params: { prompt: string; name: string }[]; editableTable?: string } {
    const t = this.getTable(source);
    if (t) return { sql: `SELECT rowid AS "__rowid", * FROM ${q(t.name)}`, params: [], editableTable: t.name };
    const qd = this.getQuery(source);
    if (qd) {
      if (this.viewable(qd)) return { sql: `SELECT * FROM ${q(qd.name)}`, params: [] };
      if (qd.kind !== 'select') throw new WowError(`"${qd.name}" is an action query and cannot be used as a record source.`);
      return prepareParams(qd.sql.trim().replace(/;\s*$/, ''), this.knownIdentifiers());
    }
    if (/^\s*select\b/i.test(source)) return prepareParams(source, this.knownIdentifiers());
    throw new WowError(`The record source "${source}" does not exist.`);
  }

  /** Column names produced by a table or query. */
  columnsOf(source: string): string[] {
    const t = this.getTable(source);
    if (t) return t.fields.map((f) => f.name);
    try {
      const s = this.sourceSql(source);
      const params: Record<string, null> = {};
      s.params.forEach((p) => { params[p.name] = null; });
      const stmt = this.db.raw.prepare(`SELECT * FROM (${s.sql.replace(/;\s*$/, '')}) LIMIT 0`);
      try { return stmt.getColumnNames().filter((c) => c !== '__rowid'); } finally { stmt.free(); }
    } catch { return []; }
  }

  fieldDef(table: string, field: string): FieldDef | undefined {
    return this.getTable(table)?.fields.find((f) => f.name.toLowerCase() === field.toLowerCase());
  }

  // Record operations (used by datasheets and forms).
  insertRecord(table: string, values: Record<string, unknown>): number {
    const t = this.getTable(table)!;
    const cols = Object.keys(values).filter((k) => { const f = t.fields.find((x) => x.name === k); return f && f.type !== 'Calculated' && !(f.type === 'AutoNumber' && (values[k] === null || values[k] === '' || values[k] === undefined)); });
    const conv = cols.map((c) => coerceValue(t.fields.find((f) => f.name === c)!, values[c]));
    try {
      if (!cols.length) this.db.run(`INSERT INTO ${q(table)} DEFAULT VALUES`);
      else this.db.run(`INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, conv as Params);
      return this.db.lastInsertRowid();
    } catch (e) { throw friendlyError(e, this, 'insert', table); }
  }
  updateRecord(table: string, rowid: number, values: Record<string, unknown>) {
    const t = this.getTable(table)!;
    const cols = Object.keys(values).filter((k) => { const f = t.fields.find((x) => x.name === k); return f && f.type !== 'Calculated' && f.type !== 'AutoNumber'; });
    if (!cols.length) return;
    const conv = cols.map((c) => coerceValue(t.fields.find((f) => f.name === c)!, values[c]));
    try { this.db.run(`UPDATE ${q(table)} SET ${cols.map((c) => q(c) + ' = ?').join(', ')} WHERE rowid = ?`, [...conv, rowid] as Params); }
    catch (e) { throw friendlyError(e, this, 'update', table); }
  }
  deleteRecords(table: string, rowids: number[]) {
    if (!rowids.length) return 0;
    try {
      return this.db.transaction(() => {
        let n = 0;
        for (const id of rowids) n += this.db.run(`DELETE FROM ${q(table)} WHERE rowid = ?`, [id], true);
        return n;
      });
    } catch (e) { throw friendlyError(e, this, 'delete', table); }
  }

  /** Import a database that was not created by WOWDB: build catalogue entries from its schema. */
  adoptPlainSqlite() { this.syncCatalog(); }

  /** Keep the catalogue consistent after raw SQL DDL typed in SQL View (CREATE/DROP/ALTER TABLE). */
  syncCatalog(): { added: string[]; removed: string[] } {
    const added: string[] = [], removed: string[] = [];
    const real = this.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_wow\\_%' ESCAPE '\\'");
    const realSet = new Set(real.map((r) => r.name.toLowerCase()));
    for (const o of this.listObjects('table')) if (!realSet.has(o.name.toLowerCase())) { this.deleteCatalog('table', o.name); removed.push(o.name); }
    const known = new Set(this.listObjects('table').map((o) => o.name.toLowerCase()));
    // refresh columns of known tables whose columns changed via ALTER TABLE
    for (const o of this.listObjects('table')) {
      const def = this.getTable(o.name)!;
      const cols = this.db.all<{ name: string }>(`PRAGMA table_xinfo(${q(o.name)})`).map((c) => c.name);
      const missing = cols.filter((c) => !def.fields.some((f) => f.name.toLowerCase() === c.toLowerCase()));
      const gone = def.fields.filter((f) => !cols.some((c) => c.toLowerCase() === f.name.toLowerCase()));
      if (missing.length || gone.length) {
        def.fields = def.fields.filter((f) => !gone.includes(f));
        for (const m of missing) def.fields.push({ id: uid('f'), name: m, type: 'Short Text', fieldSize: 255 });
        this.putObjectSilent('table', o.name, def);
      }
    }
    const tables = real.filter((t) => !known.has(t.name.toLowerCase()));
    for (const t of tables) {
      added.push(t.name);
      const cols = this.db.all<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }>(`PRAGMA table_info(${q(t.name)})`);
      const fields: FieldDef[] = cols.map((c) => {
        const ty = (c.type || '').toUpperCase();
        const type: FieldDef['type'] = ty.includes('INT') ? (c.pk === 1 && cols.filter((x) => x.pk).length === 1 ? 'AutoNumber' : 'Number') : /REAL|FLOA|DOUB|NUM|DEC/.test(ty) ? 'Number' : /DATE|TIME/.test(ty) ? 'Date/Time' : /BOOL/.test(ty) ? 'Yes/No' : 'Short Text';
        return { id: uid('f'), name: c.name, type, numberSize: /REAL|FLOA|DOUB|NUM|DEC/.test(ty) ? 'Double' : undefined, fieldSize: type === 'Short Text' ? 255 : undefined, required: !!c.notnull, primaryKey: c.pk > 0 };
      });
      this.putObjectSilent('table', t.name, { name: t.name, fields });
    }
    const views = this.db.all<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type='view'");
    for (const v of views) {
      if (this.getQuery(v.name)) continue;
      const sql = v.sql.replace(/^\s*CREATE\s+VIEW\s+(IF\s+NOT\s+EXISTS\s+)?("[^"]+"|\S+)\s+AS\s+/i, '');
      this.putObjectSilent('query', v.name, { name: v.name, kind: 'select', sql, sqlOnly: true });
      added.push(v.name);
    }
    if (!this.getMeta('name')) this.setMeta('name', 'Imported database', true);
    return { added, removed };
  }
}

// ---------------- helpers ----------------
function normaliseTable(d: TableDef): TableDef {
  const fields = d.fields.filter((f) => f.name.trim() !== '' || f.type !== 'Short Text' || f.description).map((f) => ({ ...f, name: f.name.trim() }));
  return { ...d, name: d.name.trim(), fields };
}

export function compatibleTypes(a: FieldDef, b: FieldDef): boolean {
  const cls = (f: FieldDef) => {
    if (f.type === 'AutoNumber' || f.type === 'Large Number') return 'int';
    if (f.type === 'Number') return ['Single', 'Double', 'Decimal'].includes(f.numberSize ?? 'Long Integer') ? 'real' : 'int';
    if (f.type === 'Short Text' || f.type === 'Long Text' || f.type === 'Hyperlink') return 'text';
    return f.type;
  };
  return cls(a) === cls(b);
}

function uniqueName(base: string, existing: string[]): string {
  let n = base, i = 1;
  const set = new Set(existing.map((e) => e.toLowerCase()));
  while (set.has(n.toLowerCase())) n = base + ++i;
  return n;
}
export { uniqueName };

export function stripStrings(sql: string): string { return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ''); }

/** Convert Access-style [Prompt] parameters in SQL into named SQLite parameters. */
export function prepareParams(sql: string, known?: Set<string>): { sql: string; params: { prompt: string; name: string }[] } {
  const params: { prompt: string; name: string }[] = [];
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") { const j = endOfString(sql, i); out += sql.slice(i, j); i = j; continue; }
    if (c === '"') { const j = sql.indexOf('"', i + 1); const e = j < 0 ? sql.length : j + 1; out += sql.slice(i, e); i = e; continue; }
    if (c === '[') {
      const j = sql.indexOf(']', i + 1);
      if (j > 0) {
        const prompt = sql.slice(i + 1, j);
        if (known && known.has(prompt.toLowerCase())) { out += '"' + prompt.replace(/"/g, '""') + '"'; i = j + 1; continue; }
        let p = params.find((x) => x.prompt === prompt);
        if (!p) { p = { prompt, name: ':p' + (params.length + 1) }; params.push(p); }
        out += p.name; i = j + 1; continue;
      }
    }
    out += c; i++;
  }
  return { sql: out, params };
}
function endOfString(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } return j + 1; } j++; }
  return s.length;
}

/** Turn UI input into a correctly typed value; throws a clear message if invalid. */
export function coerceValue(f: FieldDef, v: unknown): unknown {
  if (v === undefined) return null;
  if (v === '' && f.type !== 'Short Text' && f.type !== 'Long Text') return f.type === 'Yes/No' ? 0 : null;
  if (v === null) return f.type === 'Yes/No' ? 0 : null;
  switch (f.type) {
    case 'Number': case 'Large Number': case 'Currency': case 'AutoNumber': {
      const s = String(v).replace(/[,\s]/g, '').replace(/^[^\d\-.]+/, '');
      const n = Number(s);
      if (s === '' || isNaN(n)) throw new WowError(`The value "${v}" isn't valid for the ${f.type} field "${f.name}". Enter a number.`);
      const isInt = f.type === 'AutoNumber' || f.type === 'Large Number' || (f.type === 'Number' && !['Single', 'Double', 'Decimal'].includes(f.numberSize ?? 'Long Integer'));
      if (isInt) {
        if (!Number.isInteger(n)) return Math.round(n);
        return n;
      }
      return n;
    }
    case 'Yes/No': {
      if (typeof v === 'boolean') return v ? 1 : 0;
      const s = String(v).toLowerCase();
      if (['1', '-1', 'true', 'yes', 'on', 'y'].includes(s)) return 1;
      if (['0', 'false', 'no', 'off', 'n'].includes(s)) return 0;
      throw new WowError(`"${v}" isn't valid for the Yes/No field "${f.name}".`);
    }
    case 'Date/Time': {
      const s = String(v).trim();
      try {
        const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s); // dd/mm/yyyy (Ghana/UK)
        if (m) { const p = (x: string) => x.padStart(2, '0'); return `${m[3]}-${p(m[2])}-${p(m[1])}` + (m[4] ? ` ${p(m[4])}:${m[5]}:00` : ''); }
        const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
        if (iso) { const p = (x: string) => x.padStart(2, '0'); return `${iso[1]}-${p(iso[2])}-${p(iso[3])}` + (iso[4] ? ` ${p(iso[4])}:${iso[5]}:${iso[6] ?? '00'}` : ''); }
      } catch { /* fallthrough */ }
      throw new WowError(`"${v}" isn't a valid date for "${f.name}". Use dd/mm/yyyy or yyyy-mm-dd.`);
    }
    default: return String(v);
  }
}

/** Translate SQLite errors into the kind of message a learner can act on. */
export function friendlyError(e: unknown, p: WowProject, ctx: 'insert' | 'update' | 'delete' | 'design' | 'query', table?: string): Error {
  if (e instanceof WowError) return e;
  const msg = (e as Error)?.message ?? String(e);
  let m: RegExpExecArray | null;
  if ((m = /CHECK constraint failed: vr:(.+)$/.exec(msg))) {
    const fname = m[1].trim();
    const f = table ? p.fieldDef(table, fname) : undefined;
    return new WowError(f?.validationText || `The value entered for "${fname}" breaks its validation rule: ${f?.validationRule ?? ''}`, msg);
  }
  if ((m = /CHECK constraint failed: len:(.+)$/.exec(msg))) {
    const f = table ? p.fieldDef(table, m[1].trim()) : undefined;
    return new WowError(`The text is too long for the field "${m[1].trim()}" (Field Size is ${f?.fieldSize ?? 255} characters).`, msg);
  }
  if ((m = /CHECK constraint failed: range:(.+)$/.exec(msg))) {
    const f = table ? p.fieldDef(table, m[1].trim()) : undefined;
    return new WowError(`The number is outside the range allowed by the Field Size (${f?.numberSize ?? 'Long Integer'}) of "${m[1].trim()}".`, msg);
  }
  if ((m = /CHECK constraint failed: date:(.+)$/.exec(msg))) return new WowError(`"${m[1].trim()}" must contain a valid date.`, msg);
  if ((m = /CHECK constraint failed: zl:(.+)$/.exec(msg))) return new WowError(`"${m[1].trim()}" does not allow zero-length (empty) text. Enter a value or leave it blank (Null).`, msg);
  if ((m = /NOT NULL constraint failed: ([^.]+)\.(.+)$/.exec(msg))) return new WowError(`You must enter a value in the '${m[1]}.${m[2]}' field.`, msg);
  if (/UNIQUE constraint failed|PRIMARY KEY/.test(msg)) {
    const f = /failed: (.+)$/.exec(msg)?.[1] ?? '';
    return new WowError(`The changes were not successful because they would create duplicate values in the primary key or a unique index (${f}). Change the value so it is unique.`, msg);
  }
  if (/FOREIGN KEY constraint failed/.test(msg)) {
    if (ctx === 'delete') {
      const kids = p.relationships().filter((r) => r.enforce && !r.cascadeDelete && r.primaryTable.toLowerCase() === table?.toLowerCase()).map((r) => r.relatedTable);
      return new WowError(`The record cannot be deleted or changed because table '${kids.join("', '") || 'another table'}' includes related records. (Referential integrity is enforced.)`, msg);
    }
    if (ctx === 'update') {
      const parents = p.relationships().filter((r) => r.enforce && r.relatedTable.toLowerCase() === table?.toLowerCase()).map((r) => r.primaryTable);
      const kids = p.relationships().filter((r) => r.enforce && !r.cascadeUpdate && r.primaryTable.toLowerCase() === table?.toLowerCase()).map((r) => r.relatedTable);
      return new WowError(`You cannot change this record: ${parents.length ? `a related record is required in table '${parents.join("', '")}'` : ''}${parents.length && kids.length ? ', or ' : ''}${kids.length ? `table '${kids.join("', '")}' has related records` : ''}.`, msg);
    }
    const parents = p.relationships().filter((r) => r.enforce && r.relatedTable.toLowerCase() === table?.toLowerCase()).map((r) => r.primaryTable);
    return new WowError(`You cannot add or change a record because a related record is required in table '${parents.join("', '") || 'the primary table'}'.`, msg);
  }
  if ((m = /cannot store (\w+) value in (\w+) column ([^.]+)\.(.+)$/.exec(msg))) return new WowError(`Data type mismatch: the field "${m[4]}" expects ${m[2].toLowerCase() === 'integer' ? 'a whole number' : m[2].toLowerCase() === 'real' ? 'a number' : 'text'}.`, msg);
  if (e instanceof ExprError) return new WowError(msg);
  return new WowError(msg, msg);
}
