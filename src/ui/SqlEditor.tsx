'use client';
import React, { useRef } from 'react';

const KW = new Set('select from where and or not in is null like between join inner left right outer full cross on as order by group having limit offset distinct all union intersect except insert into values update set delete create table view index unique primary key foreign references drop alter add column rename to if exists case when then else end asc desc with recursive collate default check constraint cascade no action begin commit rollback transaction pragma explain replace glob escape cast strict generated always virtual stored autoincrement temp temporary trigger before after instead of for each row raise abort'.split(' '));
const FN = new Set('count sum avg min max abs round length lower upper trim ltrim rtrim substr instr coalesce ifnull nullif date time datetime julianday strftime printf typeof total group_concat random hex quote char unicode iif last_insert_rowid changes pow sqrt'.split(' '));

export function highlightSql(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|("(?:[^"]|"")*"?)|(\[[^\]\n]*\]?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(src))) {
    const [t, cmt, str, qid, br, num, word] = m;
    const k = i++;
    if (cmt) out.push(<span key={k} className="sql-cmt">{t}</span>);
    else if (str) out.push(<span key={k} className="sql-str">{t}</span>);
    else if (qid) out.push(<span key={k} className="sql-id">{t}</span>);
    else if (br) out.push(<span key={k} className="sql-param">{t}</span>);
    else if (num) out.push(<span key={k} className="sql-num">{t}</span>);
    else if (word && KW.has(word.toLowerCase())) out.push(<span key={k} className="sql-kw">{t}</span>);
    else if (word && FN.has(word.toLowerCase())) out.push(<span key={k} className="sql-fn">{t}</span>);
    else out.push(t);
  }
  return out;
}

export function SqlEditor({ value, onChange, onRun, readOnly, testId }: { value: string; onChange: (v: string) => void; onRun?: () => void; readOnly?: boolean; testId?: string }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget, s = el.selectionStart, en = el.selectionEnd;
      const v = value.slice(0, s) + '  ' + value.slice(en);
      onChange(v);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    } else if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.key === 'F5') { e.preventDefault(); onRun?.(); }
  };
  return (
    <div className="sqled">
      <div style={{ position: 'relative', minHeight: '100%' }}>
      <pre aria-hidden>{highlightSql(value)}{'\n'}</pre>
      <textarea ref={ta} value={value} spellCheck={false} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} aria-label="SQL" data-testid={testId} />
      </div>
    </div>
  );
}
