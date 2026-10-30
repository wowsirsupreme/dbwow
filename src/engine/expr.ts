// Access-style expression language: tokenizer, parser, SQL translator and evaluator.
// Used for query criteria, validation rules, default values, calculated fields,
// and form/report text box expressions (=Sum([Fee]), ="Page " & [Page] ...).
import { q } from './sqlite';

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'date'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'null' }
  | { k: 'star' }
  | { k: 'ref'; parts: string[]; bracket: boolean }
  | { k: 'param'; prompt: string }
  | { k: 'self' }                                 // implicit operand in criteria/validation
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'un'; op: '-' | 'not'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  | { k: 'between'; e: Node; lo: Node; hi: Node; not: boolean }
  | { k: 'in'; e: Node; list: Node[]; not: boolean }
  | { k: 'isnull'; e: Node; not: boolean }
  | { k: 'like'; e: Node; p: Node; not: boolean };

type Tok = { t: 'num' | 'str' | 'date' | 'id' | 'br' | 'op' | 'kw' | 'eof'; v: string; pos: number };

const KEYWORDS = new Set(['and', 'or', 'not', 'like', 'between', 'in', 'is', 'null', 'true', 'false', 'yes', 'no', 'mod', 'xor']);

export class ExprError extends Error {}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      for (;;) {
        if (j >= src.length) throw new ExprError('Unterminated text value starting at position ' + (i + 1));
        if (src[j] === c) { if (src[j + 1] === c) { s += c; j += 2; continue; } break; }
        s += src[j++];
      }
      out.push({ t: 'str', v: s, pos: i }); i = j + 1; continue;
    }
    if (c === '#') {
      const j = src.indexOf('#', i + 1);
      if (j < 0) throw new ExprError('Missing closing # in date value');
      out.push({ t: 'date', v: src.slice(i + 1, j).trim(), pos: i }); i = j + 1; continue;
    }
    if (c === '[') {
      const j = src.indexOf(']', i + 1);
      if (j < 0) throw new ExprError('Missing closing ] bracket');
      out.push({ t: 'br', v: src.slice(i + 1, j), pos: i }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i))!;
      out.push({ t: 'num', v: m[0], pos: i }); i += m[0].length; continue;
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      const m = /^[A-Za-z_À-￿][A-Za-z0-9_À-￿]*/.exec(src.slice(i))!;
      const w = m[0];
      out.push({ t: KEYWORDS.has(w.toLowerCase()) ? 'kw' : 'id', v: w, pos: i }); i += w.length; continue;
    }
    const two = src.slice(i, i + 2);
    if (['<>', '<=', '>=', '!='].includes(two)) { out.push({ t: 'op', v: two === '!=' ? '<>' : two, pos: i }); i += 2; continue; }
    if ('=<>+-*/\\^&(),.!'.includes(c)) { out.push({ t: 'op', v: c, pos: i }); i++; continue; }
    throw new ExprError(`Unexpected character "${c}" at position ${i + 1}`);
  }
  out.push({ t: 'eof', v: '', pos: src.length });
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}
  peek(o = 0) { return this.toks[this.i + o]; }
  next() { return this.toks[this.i++]; }
  isKw(w: string, o = 0) { const t = this.peek(o); return t.t === 'kw' && t.v.toLowerCase() === w; }
  isOp(v: string) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  expectOp(v: string) { if (!this.isOp(v)) throw new ExprError(`Expected "${v}" near "${this.peek().v || 'end'}"`); this.next(); }
  atEnd() { return this.peek().t === 'eof'; }

  parse(): Node { const n = this.or(); if (!this.atEnd()) throw new ExprError(`Unexpected "${this.peek().v}"`); return n; }
  or(): Node { let l = this.and(); while (this.isKw('or') || this.isKw('xor')) { const op = this.next().v.toLowerCase(); l = { k: 'bin', op, l, r: this.and() }; } return l; }
  and(): Node { let l = this.not(); while (this.isKw('and')) { this.next(); l = { k: 'bin', op: 'and', l, r: this.not() }; } return l; }
  not(): Node { if (this.isKw('not')) { this.next(); return { k: 'un', op: 'not', e: this.not() }; } return this.cmp(); }
  cmp(): Node {
    const l = this.concat();
    return this.cmpTail(l);
  }
  cmpTail(l: Node): Node {
    const t = this.peek();
    if (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { this.next(); return { k: 'bin', op: t.v, l, r: this.concat() }; }
    let neg = false;
    if (this.isKw('not') && (this.isKw('like', 1) || this.isKw('in', 1) || this.isKw('between', 1))) { this.next(); neg = true; }
    if (this.isKw('like')) { this.next(); return { k: 'like', e: l, p: this.concat(), not: neg }; }
    if (this.isKw('between')) {
      this.next(); const lo = this.concat();
      if (!this.isKw('and')) throw new ExprError('Between needs "And", e.g. Between 1 And 10');
      this.next(); return { k: 'between', e: l, lo, hi: this.concat(), not: neg };
    }
    if (this.isKw('in')) {
      this.next(); this.expectOp('(');
      const list: Node[] = [];
      if (!this.isOp(')')) { list.push(this.or()); while (this.isOp(',')) { this.next(); list.push(this.or()); } }
      this.expectOp(')'); return { k: 'in', e: l, list, not: neg };
    }
    if (this.isKw('is')) {
      this.next(); let n = false; if (this.isKw('not')) { this.next(); n = true; }
      if (!this.isKw('null')) throw new ExprError('Expected Null after Is');
      this.next(); return { k: 'isnull', e: l, not: n };
    }
    return l;
  }
  concat(): Node { let l = this.add(); while (this.isOp('&')) { this.next(); l = { k: 'bin', op: '&', l, r: this.add() }; } return l; }
  add(): Node { let l = this.mod(); while (this.isOp('+') || this.isOp('-')) { const op = this.next().v; l = { k: 'bin', op, l, r: this.mod() }; } return l; }
  mod(): Node { let l = this.idiv(); while (this.isKw('mod')) { this.next(); l = { k: 'bin', op: 'mod', l, r: this.idiv() }; } return l; }
  idiv(): Node { let l = this.mul(); while (this.isOp('\\')) { this.next(); l = { k: 'bin', op: '\\', l, r: this.mul() }; } return l; }
  mul(): Node { let l = this.pow(); while (this.isOp('*') || this.isOp('/')) { const op = this.next().v; l = { k: 'bin', op, l, r: this.pow() }; } return l; }
  pow(): Node { const l = this.unary(); if (this.isOp('^')) { this.next(); return { k: 'bin', op: '^', l, r: this.pow() }; } return l; }
  unary(): Node { if (this.isOp('-')) { this.next(); return { k: 'un', op: '-', e: this.unary() }; } if (this.isOp('+')) { this.next(); return this.unary(); } return this.primary(); }
  primary(): Node {
    const t = this.next();
    switch (t.t) {
      case 'num': return { k: 'num', v: parseFloat(t.v) };
      case 'str': return { k: 'str', v: t.v };
      case 'date': return { k: 'date', v: normaliseDate(t.v) };
      case 'kw': {
        const w = t.v.toLowerCase();
        if (w === 'null') return { k: 'null' };
        if (w === 'true' || w === 'yes') return { k: 'bool', v: true };
        if (w === 'false' || w === 'no') return { k: 'bool', v: false };
        throw new ExprError(`Unexpected "${t.v}"`);
      }
      case 'op':
        if (t.v === '(') { const e = this.or(); this.expectOp(')'); return e; }
        if (t.v === '*') return { k: 'star' };
        throw new ExprError(`Unexpected "${t.v}"`);
      case 'br': case 'id': {
        if (t.t === 'id' && this.isOp('(')) {
          this.next(); const args: Node[] = [];
          if (!this.isOp(')')) { args.push(this.or()); while (this.isOp(',')) { this.next(); args.push(this.or()); } }
          this.expectOp(')'); return { k: 'call', name: t.v, args };
        }
        const parts = [t.v]; let bracket = t.t === 'br';
        while ((this.isOp('.') || this.isOp('!')) && (this.peek(1).t === 'br' || this.peek(1).t === 'id')) {
          this.next(); const p = this.next(); parts.push(p.v); bracket = bracket || p.t === 'br';
        }
        return { k: 'ref', parts, bracket };
      }
      default: throw new ExprError('Expression is incomplete');
    }
  }
}

export function parseExpr(src: string): Node {
  const s = src.trim().replace(/^=/, '');
  if (!s) throw new ExprError('Expression is empty');
  return new Parser(tokenize(s)).parse();
}

/**
 * Parse a criteria/validation fragment like ">5", "Like 'A*'", "Between 1 And 9",
 * "Is Null", "Accra", "Not 'X'". The result is a boolean expression over {k:'self'}.
 */
export function parseCriteria(src: string, mode: 'criteria' | 'validation' = 'criteria'): Node {
  let s = src.trim();
  if (!s) throw new ExprError('Criteria is empty');
  // Access lets you type unquoted wildcard patterns: A*  or  Not Like *son
  const wild = /^(not\s+)?(like\s+)?([^\s"'#[\]()=<>]*[*?][^\s"'#[\]()=<>]*)$/i.exec(s);
  if (wild) s = `${wild[1] ? 'Not ' : ''}Like "${wild[3]}"`;
  let toks: Tok[];
  try { toks = tokenize(s); new Parser(tokenize(s)).parse(); }
  catch (e) {
    // Access accepts plain unquoted text such as  JHS 1  or  Cape Coast
    if (mode === 'criteria' && /^[^"'#[\]()=<>*?]+$/.test(s) && !/^(and|or|not|like|between|in|is)\b/i.test(s)) return { k: 'bin', op: '=', l: { k: 'self' }, r: { k: 'str', v: s } };
    toks = tokenize(s);
    void e;
  }
  const first = toks[0];
  const startsWithOp = (first.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(first.v)) ||
    (first.t === 'kw' && ['like', 'between', 'in', 'is'].includes(first.v.toLowerCase())) ||
    (first.t === 'kw' && first.v.toLowerCase() === 'not' && toks[1]?.t === 'kw' && ['like', 'in', 'between'].includes(toks[1].v.toLowerCase()));
  const p = new Parser(toks);
  if (startsWithOp) {
    // allow "> 5 And < 10" : split on And/Or at top level by parsing tail repeatedly
    const parseTerm = (): Node => {
      const t = p.peek();
      const isCmpStart = (t.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) ||
        (t.t === 'kw' && ['like', 'between', 'in', 'is'].includes(t.v.toLowerCase())) ||
        (t.t === 'kw' && t.v.toLowerCase() === 'not' && p.isKw('like', 1)) ||
        (t.t === 'kw' && t.v.toLowerCase() === 'not' && p.isKw('in', 1)) ||
        (t.t === 'kw' && t.v.toLowerCase() === 'not' && p.isKw('between', 1));
      if (isCmpStart) return p.cmpTail({ k: 'self' });
      if (p.isKw('not')) { p.next(); return { k: 'un', op: 'not', e: parseTerm() }; }
      return { k: 'bin', op: '=', l: { k: 'self' }, r: p.concat() };
    };
    let n = parseTerm();
    while (p.isKw('and') || p.isKw('or')) { const op = p.next().v.toLowerCase(); n = { k: 'bin', op, l: n, r: parseTerm() }; }
    if (!p.atEnd()) throw new ExprError(`Unexpected "${p.peek().v}" in criteria`);
    return n;
  }
  // Full expression. If it is already boolean-looking (uses comparison) keep as is in validation mode.
  const e = p.parse();
  return implicitCompare(e);
}

/** "5 Or 6" → (self = 5) Or (self = 6); "A*" → self Like "A*"; boolean parts kept. */
function implicitCompare(e: Node): Node {
  if (e.k === 'bin' && (e.op === 'and' || e.op === 'or')) return { k: 'bin', op: e.op, l: implicitCompare(e.l), r: implicitCompare(e.r) };
  if (e.k === 'un' && e.op === 'not') return isBoolean(e.e) ? e : { k: 'bin', op: '<>', l: { k: 'self' }, r: e.e };
  if (isBoolean(e)) return e;
  if (e.k === 'str' && /[*?]/.test(e.v)) return { k: 'like', e: { k: 'self' }, p: e, not: false };
  return { k: 'bin', op: '=', l: { k: 'self' }, r: e };
}

function isBoolean(n: Node): boolean {
  if (n.k === 'bin') return ['=', '<>', '<', '>', '<=', '>=', 'and', 'or', 'xor'].includes(n.op);
  return n.k === 'between' || n.k === 'in' || n.k === 'isnull' || n.k === 'like' || (n.k === 'un' && n.op === 'not');
}


export function normaliseDate(s: string): string {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) return fmtDate(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) { // Access uses US m/d/yyyy inside # #
    let y = +m[3]; if (y < 100) y += y < 30 ? 2000 : 1900;
    return fmtDate(y, +m[1], +m[2], m[4], m[5], m[6]);
  }
  const d = new Date(t);
  if (!isNaN(d.getTime())) return fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  throw new ExprError(`"${s}" is not a valid date`);
}
function fmtDate(y: number, mo: number, d: number, h?: string, mi?: string, s?: string) {
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${y}-${p(mo)}-${p(d)}`;
  return h ? `${base} ${p(+h)}:${p(+(mi || 0))}:${p(+(s || 0))}` : base;
}

// ---------------- SQL translation ----------------

export interface SqlContext {
  self?: string;                              // SQL for implicit operand
  /** Resolve a reference ([Field] / [Table].[Field]) to SQL, or null if unknown. */
  resolve?: (parts: string[]) => string | null;
  /** Unknown bracket refs become parameters when this is provided. */
  params?: { prompt: string; name: string }[];
  /** In criteria, bare unknown words are treated as text (Access behaviour). */
  bareAsText?: boolean;
}

export function toSql(n: Node, ctx: SqlContext = {}): string {
  const r = (x: Node) => toSql(x, ctx);
  switch (n.k) {
    case 'num': return String(n.v);
    case 'str': return "'" + n.v.replace(/'/g, "''") + "'";
    case 'date': return "'" + n.v + "'";
    case 'bool': return n.v ? '1' : '0';
    case 'null': return 'NULL';
    case 'star': return '*';
    case 'self': if (!ctx.self) throw new ExprError('This expression needs a field to compare with'); return ctx.self;
    case 'param': return paramName(n.prompt, ctx);
    case 'ref': {
      if (!ctx.resolve && ctx.bareAsText && !n.bracket && n.parts.length === 1) return "'" + n.parts[0].replace(/'/g, "''") + "'";
      const res = ctx.resolve ? ctx.resolve(n.parts) : n.parts.map(q).join('.');
      if (res) return res;
      if (n.bracket && ctx.params) return paramName(n.parts.join('.'), ctx);
      if (!n.bracket && ctx.bareAsText && n.parts.length === 1) return "'" + n.parts[0].replace(/'/g, "''") + "'";
      throw new ExprError(`Unknown field or parameter [${n.parts.join('].[')}]`);
    }
    case 'un': return n.op === '-' ? `(-${r(n.e)})` : `(NOT ${r(n.e)})`;
    case 'bin': {
      const l = r(n.l), rr = r(n.r);
      switch (n.op) {
        case 'and': return `(${l} AND ${rr})`;
        case 'or': return `(${l} OR ${rr})`;
        case 'xor': return `((${l}) <> (${rr}))`;
        case '&': return `(COALESCE(${l},'') || COALESCE(${rr},''))`;
        case 'mod': return `(${l} % ${rr})`;
        case '\\': return `CAST((${l}) / (${rr}) AS INTEGER)`;
        case '^': return `pow(${l}, ${rr})`;
        case '/': return `((${l}) * 1.0 / (${rr}))`;
        default: return `(${l} ${n.op} ${rr})`;
      }
    }
    case 'between': return `(${r(n.e)} ${n.not ? 'NOT ' : ''}BETWEEN ${r(n.lo)} AND ${r(n.hi)})`;
    case 'in': return `(${r(n.e)} ${n.not ? 'NOT ' : ''}IN (${n.list.map(r).join(', ')}))`;
    case 'isnull': return `(${r(n.e)} IS ${n.not ? 'NOT ' : ''}NULL)`;
    case 'like': {
      const pat = n.p.k === 'str' ? "'" + accessLikeToSql(n.p.v).replace(/'/g, "''") + "'" : `REPLACE(REPLACE(${r(n.p)},'*','%'),'?','_')`;
      return `(${r(n.e)} ${n.not ? 'NOT ' : ''}LIKE ${pat})`;
    }
    case 'call': return callToSql(n.name, n.args, ctx);
  }
}

function paramName(prompt: string, ctx: SqlContext): string {
  if (!ctx.params) throw new ExprError(`Unknown field [${prompt}]`);
  let p = ctx.params.find((x) => x.prompt === prompt);
  if (!p) { p = { prompt, name: ':p' + (ctx.params.length + 1) }; ctx.params.push(p); }
  return p.name;
}

export function accessLikeToSql(p: string): string { return p.replace(/\*/g, '%').replace(/\?/g, '_').replace(/#/g, '_'); }

function callToSql(name: string, args: Node[], ctx: SqlContext): string {
  const a = args.map((x) => toSql(x, ctx));
  const f = name.toLowerCase();
  const need = (n: number) => { if (a.length < n) throw new ExprError(`${name}() needs ${n} argument(s)`); };
  switch (f) {
    case 'date': return "date('now','localtime')";
    case 'now': return "datetime('now','localtime')";
    case 'time': return "time('now','localtime')";
    case 'year': need(1); return `CAST(strftime('%Y',${a[0]}) AS INTEGER)`;
    case 'month': need(1); return `CAST(strftime('%m',${a[0]}) AS INTEGER)`;
    case 'day': need(1); return `CAST(strftime('%d',${a[0]}) AS INTEGER)`;
    case 'weekday': need(1); return `(CAST(strftime('%w',${a[0]}) AS INTEGER)+1)`;
    case 'left': need(2); return `substr(${a[0]},1,${a[1]})`;
    case 'right': need(2); return `substr(${a[0]},-(${a[1]}))`;
    case 'mid': need(2); return a[2] ? `substr(${a[0]},${a[1]},${a[2]})` : `substr(${a[0]},${a[1]})`;
    case 'len': need(1); return `length(${a[0]})`;
    case 'ucase': need(1); return `upper(${a[0]})`;
    case 'lcase': need(1); return `lower(${a[0]})`;
    case 'trim': need(1); return `trim(${a[0]})`;
    case 'ltrim': need(1); return `ltrim(${a[0]})`;
    case 'rtrim': need(1); return `rtrim(${a[0]})`;
    case 'instr': need(2); return `instr(${a[0]},${a[1]})`;
    case 'replace': need(3); return `replace(${a[0]},${a[1]},${a[2]})`;
    case 'nz': need(1); return `COALESCE(${a[0]},${a[1] ?? 0})`;
    case 'iif': need(3); return `(CASE WHEN ${a[0]} THEN ${a[1]} ELSE ${a[2]} END)`;
    case 'round': need(1); return `round(${a[0]},${a[1] ?? 0})`;
    case 'abs': need(1); return `abs(${a[0]})`;
    case 'int': case 'fix': need(1); return `CAST(${a[0]} AS INTEGER)`;
    case 'val': case 'cdbl': case 'csng': need(1); return `CAST(${a[0]} AS REAL)`;
    case 'cint': case 'clng': need(1); return `CAST(round(${a[0]}) AS INTEGER)`;
    case 'str': case 'cstr': need(1); return `CAST(${a[0]} AS TEXT)`;
    case 'ccur': need(1); return `round(CAST(${a[0]} AS REAL),4)`;
    case 'cdate': case 'datevalue': need(1); return `date(${a[0]})`;
    case 'isnull': need(1); return `(${a[0]} IS NULL)`;
    case 'sum': case 'avg': case 'min': case 'max': need(1); return `${f}(${a[0]})`;
    case 'count': return `count(${a[0] ?? '*'})`;
    case 'datediff': {
      need(3); const unit = args[0].k === 'str' ? args[0].v.toLowerCase() : 'd';
      const d = `(julianday(${a[2]}) - julianday(${a[1]}))`;
      if (unit === 'yyyy') return `(CAST(strftime('%Y',${a[2]}) AS INTEGER) - CAST(strftime('%Y',${a[1]}) AS INTEGER))`;
      if (unit === 'm') return `((CAST(strftime('%Y',${a[2]}) AS INTEGER) - CAST(strftime('%Y',${a[1]}) AS INTEGER))*12 + CAST(strftime('%m',${a[2]}) AS INTEGER) - CAST(strftime('%m',${a[1]}) AS INTEGER))`;
      if (unit === 'ww') return `CAST(${d} / 7 AS INTEGER)`;
      if (unit === 'h') return `CAST(${d} * 24 AS INTEGER)`;
      if (unit === 'n') return `CAST(${d} * 1440 AS INTEGER)`;
      return `CAST(${d} AS INTEGER)`;
    }
    case 'dateadd': {
      need(3); const unit = args[0].k === 'str' ? args[0].v.toLowerCase() : 'd';
      const u = unit === 'yyyy' ? ' years' : unit === 'm' ? ' months' : unit === 'h' ? ' hours' : unit === 'n' ? ' minutes' : unit === 'ww' ? ' days' : ' days';
      const amt = unit === 'ww' ? `(${a[1]})*7` : a[1];
      return `date(${a[2]}, (${amt}) || '${u}')`;
    }
    case 'format': need(1); return formatToSql(a[0], args[1]);
    default: throw new ExprError(`Function ${name}() is not supported`);
  }
}

function formatToSql(v: string, fmt?: Node): string {
  if (!fmt || fmt.k !== 'str') return `CAST(${v} AS TEXT)`;
  const f = fmt.v;
  const map: Record<string, string> = { yyyy: "strftime('%Y',X)", mm: "strftime('%m',X)", 'mmm yyyy': "strftime('%m/%Y',X)", 'yyyy-mm': "strftime('%Y-%m',X)", 'dd/mm/yyyy': "strftime('%d/%m/%Y',X)", 'yyyy-mm-dd': "strftime('%Y-%m-%d',X)", currency: "printf('%.2f',X)", fixed: "printf('%.2f',X)", percent: "printf('%.0f%%',X*100)" };
  const m = map[f.toLowerCase()];
  return m ? m.replace(/X/g, v) : `CAST(${v} AS TEXT)`;
}

// ---------------- JavaScript evaluator (forms / reports) ----------------

export interface EvalContext {
  record?: Record<string, unknown>;
  records?: Record<string, unknown>[];   // current group / report records for aggregates
  page?: number;
  pages?: number;
  params?: Record<string, unknown>;
  self?: unknown;
}

function lookupField(rec: Record<string, unknown> | undefined, parts: string[]): unknown {
  if (!rec) return null;
  const name = parts[parts.length - 1];
  if (name in rec) return rec[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(rec)) if (k.toLowerCase() === lower) return rec[k];
  const full = parts.join('.');
  if (full in rec) return rec[full];
  return undefined;
}

export function evaluate(n: Node, ctx: EvalContext): unknown {
  const ev = (x: Node, c: EvalContext = ctx) => evaluate(x, c);
  switch (n.k) {
    case 'num': return n.v;
    case 'str': return n.v;
    case 'date': return n.v;
    case 'bool': return n.v ? -1 : 0;
    case 'null': return null;
    case 'star': return '*';
    case 'self': return ctx.self;
    case 'param': return ctx.params?.[n.prompt] ?? null;
    case 'ref': {
      const nm = n.parts[n.parts.length - 1].toLowerCase();
      if (n.parts.length === 1 && nm === 'page') return ctx.page ?? 1;
      if (n.parts.length === 1 && nm === 'pages') return ctx.pages ?? 1;
      const v = lookupField(ctx.record, n.parts);
      if (v === undefined) {
        if (ctx.params && n.parts.join('.') in ctx.params) return ctx.params[n.parts.join('.')];
        return n.bracket ? null : n.parts.join('.');
      }
      return v;
    }
    case 'un': { const v = ev(n.e); if (n.op === '-') return v == null ? null : -Number(v); return v == null ? null : (truthy(v) ? 0 : -1); }
    case 'bin': {
      if (n.op === 'and') return truthy(ev(n.l)) && truthy(ev(n.r)) ? -1 : 0;
      if (n.op === 'or') return truthy(ev(n.l)) || truthy(ev(n.r)) ? -1 : 0;
      const l = ev(n.l), r = ev(n.r);
      if (n.op === '&') return str(l) + str(r);
      if (l == null || r == null) return ['=', '<>', '<', '>', '<=', '>='].includes(n.op) ? null : null;
      switch (n.op) {
        case '+': return typeof l === 'string' && typeof r === 'string' && (isNaN(+l) || isNaN(+r)) ? l + r : Number(l) + Number(r);
        case '-': return Number(l) - Number(r);
        case '*': return Number(l) * Number(r);
        case '/': return Number(r) === 0 ? null : Number(l) / Number(r);
        case '\\': return Math.trunc(Number(l) / Number(r));
        case 'mod': return Number(l) % Number(r);
        case '^': return Math.pow(Number(l), Number(r));
        case 'xor': return truthy(l) !== truthy(r) ? -1 : 0;
        default: return compare(l, r, n.op) ? -1 : 0;
      }
    }
    case 'between': { const v = ev(n.e); if (v == null) return null; const ok = compare(v, ev(n.lo), '>=') && compare(v, ev(n.hi), '<='); return (n.not ? !ok : ok) ? -1 : 0; }
    case 'in': { const v = ev(n.e); const ok = n.list.some((x) => compare(v, ev(x), '=')); return (n.not ? !ok : ok) ? -1 : 0; }
    case 'isnull': { const v = ev(n.e); const ok = v === null || v === undefined || v === ''; return (n.not ? !ok : ok) ? -1 : 0; }
    case 'like': {
      const v = str(ev(n.e)); const p = str(ev(n.p));
      const re = new RegExp('^' + p.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/#/g, '\\d') + '$', 'i');
      const ok = re.test(v); return (n.not ? !ok : ok) ? -1 : 0;
    }
    case 'call': return callJs(n.name, n.args, ctx);
  }
}

function truthy(v: unknown) { return !(v === 0 || v === false || v === null || v === undefined || v === '' || v === '0'); }
function str(v: unknown) { return v === null || v === undefined ? '' : String(v); }
function compare(a: unknown, b: unknown, op: string): boolean {
  let x: unknown = a, y: unknown = b;
  if (typeof x === 'number' || typeof y === 'number') {
    const nx = Number(x), ny = Number(y);
    if (!isNaN(nx) && !isNaN(ny)) { x = nx; y = ny; }
  }
  if (typeof x === 'string' && typeof y === 'string') { x = x.toLowerCase(); y = y.toLowerCase(); }
  const xx = x as number, yy = y as number;
  switch (op) { case '=': return xx === yy; case '<>': return xx !== yy; case '<': return xx < yy; case '>': return xx > yy; case '<=': return xx <= yy; case '>=': return xx >= yy; }
  return false;
}

function aggregate(name: string, arg: Node | undefined, ctx: EvalContext): unknown {
  const recs = ctx.records ?? (ctx.record ? [ctx.record] : []);
  if (name === 'count' && (!arg || arg.k === 'star')) return recs.length;
  const vals = recs.map((r) => evaluate(arg!, { ...ctx, record: r })).filter((v) => v !== null && v !== undefined && v !== '');
  switch (name) {
    case 'count': return vals.length;
    case 'sum': return vals.reduce((s: number, v) => s + Number(v), 0);
    case 'avg': return vals.length ? vals.reduce((s: number, v) => s + Number(v), 0) / vals.length : null;
    case 'min': return vals.length ? vals.reduce((m, v) => (compare(v, m, '<') ? v : m)) : null;
    case 'max': return vals.length ? vals.reduce((m, v) => (compare(v, m, '>') ? v : m)) : null;
    case 'first': return vals[0] ?? null;
    case 'last': return vals[vals.length - 1] ?? null;
  }
  return null;
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v).replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}
function isoDate(d: Date) { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

function callJs(name: string, args: Node[], ctx: EvalContext): unknown {
  const f = name.toLowerCase();
  if (['sum', 'avg', 'count', 'min', 'max', 'first', 'last'].includes(f)) return aggregate(f, args[0], ctx);
  const a = args.map((x) => evaluate(x, ctx));
  const p = (n: number) => String(n).padStart(2, '0');
  switch (f) {
    case 'date': return isoDate(new Date());
    case 'now': { const d = new Date(); return `${isoDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
    case 'time': { const d = new Date(); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
    case 'year': return toDate(a[0])?.getFullYear() ?? null;
    case 'month': { const d = toDate(a[0]); return d ? d.getMonth() + 1 : null; }
    case 'day': return toDate(a[0])?.getDate() ?? null;
    case 'weekday': { const d = toDate(a[0]); return d ? d.getDay() + 1 : null; }
    case 'left': return str(a[0]).slice(0, Number(a[1]));
    case 'right': { const s = str(a[0]); return s.slice(Math.max(0, s.length - Number(a[1]))); }
    case 'mid': { const s = str(a[0]); const st = Number(a[1]) - 1; return a[2] == null ? s.slice(st) : s.substr(st, Number(a[2])); }
    case 'len': return str(a[0]).length;
    case 'ucase': return str(a[0]).toUpperCase();
    case 'lcase': return str(a[0]).toLowerCase();
    case 'trim': return str(a[0]).trim();
    case 'ltrim': return str(a[0]).replace(/^\s+/, '');
    case 'rtrim': return str(a[0]).replace(/\s+$/, '');
    case 'instr': return str(a[0]).toLowerCase().indexOf(str(a[1]).toLowerCase()) + 1;
    case 'replace': return str(a[0]).split(str(a[1])).join(str(a[2]));
    case 'nz': return a[0] === null || a[0] === undefined || a[0] === '' ? (a[1] ?? 0) : a[0];
    case 'iif': return truthy(a[0]) ? a[1] : a[2];
    case 'round': { const n = Number(a[1] ?? 0); const m = Math.pow(10, n); return a[0] == null ? null : Math.round(Number(a[0]) * m) / m; }
    case 'abs': return a[0] == null ? null : Math.abs(Number(a[0]));
    case 'int': return a[0] == null ? null : Math.floor(Number(a[0]));
    case 'fix': return a[0] == null ? null : Math.trunc(Number(a[0]));
    case 'val': case 'cdbl': case 'csng': return parseFloat(str(a[0])) || 0;
    case 'cint': case 'clng': return Math.round(Number(a[0]));
    case 'str': case 'cstr': return str(a[0]);
    case 'ccur': return Math.round(Number(a[0]) * 10000) / 10000;
    case 'cdate': case 'datevalue': { const d = toDate(a[0]); return d ? isoDate(d) : null; }
    case 'isnull': return a[0] === null || a[0] === undefined ? -1 : 0;
    case 'datediff': {
      const u = str(a[0]).toLowerCase(); const d1 = toDate(a[1]), d2 = toDate(a[2]); if (!d1 || !d2) return null;
      if (u === 'yyyy') return d2.getFullYear() - d1.getFullYear();
      if (u === 'm') return (d2.getFullYear() - d1.getFullYear()) * 12 + d2.getMonth() - d1.getMonth();
      const days = (d2.getTime() - d1.getTime()) / 86400000;
      if (u === 'ww') return Math.trunc(days / 7);
      if (u === 'h') return Math.trunc(days * 24);
      return Math.round(days);
    }
    case 'dateadd': {
      const u = str(a[0]).toLowerCase(); const n = Number(a[1]); const d = toDate(a[2]); if (!d) return null;
      if (u === 'yyyy') d.setFullYear(d.getFullYear() + n); else if (u === 'm') d.setMonth(d.getMonth() + n); else if (u === 'ww') d.setDate(d.getDate() + 7 * n); else d.setDate(d.getDate() + n);
      return isoDate(d);
    }
    case 'format': return formatValue(a[0], str(a[1] ?? ''));
    default: throw new ExprError(`Function ${name}() is not supported`);
  }
}

/** Display formatting used by datasheets, forms and reports (Access Format property). */
export function formatValue(v: unknown, fmt: string, decimals?: number | 'Auto'): string {
  if (v === null || v === undefined || v === '') return '';
  const f = (fmt || '').toLowerCase();
  const dp = typeof decimals === 'number' ? decimals : undefined;
  const num = Number(v);
  if (f === 'currency' || f === 'euro') {
    if (isNaN(num)) return String(v);
    return (f === 'euro' ? '€' : '') + num.toLocaleString(undefined, { minimumFractionDigits: dp ?? 2, maximumFractionDigits: dp ?? 2 });
  }
  if (f === 'fixed') return isNaN(num) ? String(v) : num.toFixed(dp ?? 2);
  if (f === 'standard') return isNaN(num) ? String(v) : num.toLocaleString(undefined, { minimumFractionDigits: dp ?? 2, maximumFractionDigits: dp ?? 2 });
  if (f === 'percent') return isNaN(num) ? String(v) : (num * 100).toFixed(dp ?? 2) + '%';
  if (f === 'scientific') return isNaN(num) ? String(v) : num.toExponential(dp ?? 2);
  if (f === 'general number') return String(v);
  if (f === 'yes/no' || f === 'true/false' || f === 'on/off') {
    const t = truthy(v); return f === 'yes/no' ? (t ? 'Yes' : 'No') : f === 'true/false' ? (t ? 'True' : 'False') : (t ? 'On' : 'Off');
  }
  const d = toDate(v);
  if (d && /(date|time|yyyy|mm|dd)/.test(f)) {
    const p = (n: number) => String(n).padStart(2, '0');
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (f === 'short date') return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
    if (f === 'medium date') return `${p(d.getDate())}-${months[d.getMonth()].slice(0, 3)}-${String(d.getFullYear()).slice(2)}`;
    if (f === 'long date') return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    if (f === 'short time') return `${p(d.getHours())}:${p(d.getMinutes())}`;
    if (f === 'long time') return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    if (f === 'general date') return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    return fmt.replace(/yyyy/gi, String(d.getFullYear())).replace(/mmmm/gi, months[d.getMonth()]).replace(/mmm/gi, months[d.getMonth()].slice(0, 3))
      .replace(/mm/gi, p(d.getMonth() + 1)).replace(/dd/gi, p(d.getDate())).replace(/hh/gi, p(d.getHours())).replace(/nn/gi, p(d.getMinutes()));
  }
  if (dp !== undefined && !isNaN(num) && typeof v !== 'string') return num.toFixed(dp);
  return String(v);
}

/** Evaluate a control source: "=expr" → expression, "Field" → field value. */
export function evalControlSource(src: string, ctx: EvalContext): unknown {
  const s = (src || '').trim();
  if (!s) return '';
  if (s.startsWith('=')) {
    try { return evaluate(parseExpr(s), ctx); } catch (e) { return '#Error'; }
  }
  return lookupField(ctx.record, [s.replace(/^\[|\]$/g, '')]) ?? null;
}

/** Collect [Field] references used by an expression (for dependency tracking). */
export function refsOf(n: Node, out: string[][] = []): string[][] {
  const walk = (x: Node) => {
    switch (x.k) {
      case 'ref': out.push(x.parts); break;
      case 'un': walk(x.e); break;
      case 'bin': walk(x.l); walk(x.r); break;
      case 'between': walk(x.e); walk(x.lo); walk(x.hi); break;
      case 'in': walk(x.e); x.list.forEach(walk); break;
      case 'isnull': walk(x.e); break;
      case 'like': walk(x.e); walk(x.p); break;
      case 'call': x.args.forEach(walk); break;
      default: break;
    }
  };
  walk(n);
  return out;
}
