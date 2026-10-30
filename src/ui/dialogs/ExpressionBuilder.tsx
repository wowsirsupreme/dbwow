'use client';
import React, { useRef, useState } from 'react';
import { parseExpr, ExprError } from '@/engine/expr';

const FUNCS: { name: string; insert: string; help: string }[] = [
  { name: 'IIf', insert: 'IIf(«condition», «truepart», «falsepart»)', help: 'Returns one of two values depending on a condition.' },
  { name: 'Nz', insert: 'Nz(«value», 0)', help: 'Replaces Null with another value.' },
  { name: 'Date', insert: 'Date()', help: 'Today\'s date.' }, { name: 'Now', insert: 'Now()', help: 'Current date and time.' },
  { name: 'Year', insert: 'Year(«date»)', help: 'Year part of a date.' }, { name: 'Month', insert: 'Month(«date»)', help: 'Month (1-12).' }, { name: 'Day', insert: 'Day(«date»)', help: 'Day of the month.' },
  { name: 'DateDiff', insert: 'DateDiff("d", «date1», «date2»)', help: 'Difference between dates: "d" days, "m" months, "yyyy" years.' },
  { name: 'DateAdd', insert: 'DateAdd("d", «number», «date»)', help: 'Adds an interval to a date.' },
  { name: 'Left', insert: 'Left(«text», «n»)', help: 'First n characters.' }, { name: 'Right', insert: 'Right(«text», «n»)', help: 'Last n characters.' }, { name: 'Mid', insert: 'Mid(«text», «start», «length»)', help: 'Part of a text.' },
  { name: 'Len', insert: 'Len(«text»)', help: 'Number of characters.' }, { name: 'UCase', insert: 'UCase(«text»)', help: 'Upper case.' }, { name: 'LCase', insert: 'LCase(«text»)', help: 'Lower case.' }, { name: 'Trim', insert: 'Trim(«text»)', help: 'Removes spaces at both ends.' },
  { name: 'Round', insert: 'Round(«number», 2)', help: 'Rounds to decimal places.' }, { name: 'Int', insert: 'Int(«number»)', help: 'Whole number part.' }, { name: 'Abs', insert: 'Abs(«number»)', help: 'Absolute value.' },
  { name: 'Sum', insert: 'Sum(«field»)', help: 'Total (in totals queries and reports).' }, { name: 'Avg', insert: 'Avg(«field»)', help: 'Average.' }, { name: 'Count', insert: 'Count(*)', help: 'Number of records.' }, { name: 'Min', insert: 'Min(«field»)', help: 'Smallest value.' }, { name: 'Max', insert: 'Max(«field»)', help: 'Largest value.' },
  { name: 'Format', insert: 'Format(«value», "yyyy-mm")', help: 'Formats a value as text.' },
];
const OPS = ['+', '-', '*', '/', '&', '=', '<>', '<', '>', '<=', '>=', 'And', 'Or', 'Not', 'Like', 'Between', 'In', 'Is Null', '( )'];

export function ExpressionBuilder({ initial, fields, close }: { initial: string; fields: string[]; close: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const [help, setHelp] = useState('Double-click an item to insert it at the cursor.');
  const ta = useRef<HTMLTextAreaElement>(null);
  const insert = (t: string) => {
    const el = ta.current; if (!el) { setV(v + t); return; }
    const s = el.selectionStart, e = el.selectionEnd;
    const sel = v.slice(s, e);
    const m = /«[^»]*»/.exec(v.slice(s, e) ? '' : v);
    void m; void sel;
    const nv = v.slice(0, s) + t + v.slice(e);
    setV(nv);
    requestAnimationFrame(() => { el.focus(); const ph = nv.indexOf('«', s); if (ph >= 0) { const end = nv.indexOf('»', ph); el.setSelectionRange(ph, end + 1); } else el.setSelectionRange(s + t.length, s + t.length); });
  };
  let err: string | null = null;
  const body = v.replace(/^\s*[^:[\]"']+:\s*/, '');
  if (body.trim() && !/«/.test(body)) { try { parseExpr(body.replace(/^\s*(=|<>|<=|>=|<|>|Like|Between|In|Not)\b/i, '0 $1')); } catch (e) { if (e instanceof ExprError) err = e.message; } }
  return (
    <div>
      <div className="small muted mb-1">Enter an expression (e.g. Total: [Quantity]*[UnitPrice], or criteria such as &gt;=#2026-01-01#):</div>
      <textarea ref={ta} className="inp w-full" rows={3} value={v} onChange={(e) => setV(e.target.value)} data-autofocus style={{ fontFamily: 'ui-monospace, Consolas, monospace' }} />
      <div className="small" style={{ minHeight: 18, color: err ? 'var(--danger)' : 'var(--muted)' }}>{err ? `⚠ ${err}` : help}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 8, marginTop: 6 }}>
        <div><div className="small mb-1">Fields</div><div className="list-box">{fields.map((f) => <div key={f} onDoubleClick={() => insert(f)} onClick={() => setHelp(f)}>{f}</div>)}</div></div>
        <div><div className="small mb-1">Functions</div><div className="list-box">{FUNCS.map((f) => <div key={f.name} onDoubleClick={() => insert(f.insert)} onClick={() => setHelp(`${f.insert} — ${f.help}`)}>{f.name}</div>)}</div></div>
        <div><div className="small mb-1">Operators</div><div className="list-box">{OPS.map((o) => <div key={o} onDoubleClick={() => insert(o === '( )' ? '()' : ` ${o} `)}>{o}</div>)}</div></div>
      </div>
      <div className="dlg-buttons"><button className="btn btn-primary" onClick={() => close(v)}>OK</button><button className="btn" onClick={() => close(null)}>Cancel</button></div>
    </div>
  );
}
