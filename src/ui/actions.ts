// Safe built-in actions used by command buttons and macros. No user-entered
// code is ever executed: each action is a fixed operation on WOWDB objects.
import { useApp } from './store';
import { errorBox, messageBox, confirmBox, askParameters } from './dialogs';
import { runQuery, queryParameters, previewActionCount } from '@/engine/queries';

export interface RecordNav {
  first?: () => void; prev?: () => void; next?: () => void; last?: () => void; newRecord?: () => void;
  save?: () => boolean; del?: () => void; undo?: () => void; refresh?: () => void; close?: () => void; print?: () => void;
}

export async function runAction(action: string, arg: string, nav: RecordNav = {}) {
  const app = useApp.getState();
  const p = app.project;
  const a = (arg || '').trim();
  switch (action) {
    case 'None': case '': return;
    case 'Go To First Record': nav.first?.(); return;
    case 'Go To Previous Record': nav.prev?.(); return;
    case 'Go To Next Record': nav.next?.(); return;
    case 'Go To Last Record': nav.last?.(); return;
    case 'New Record': nav.newRecord?.(); return;
    case 'Save Record': nav.save?.(); return;
    case 'Delete Record': nav.del?.(); return;
    case 'Undo Record': nav.undo?.(); return;
    case 'Refresh': nav.refresh?.(); return;
    case 'Close Form': case 'CloseActiveObject': nav.close?.(); return;
    case 'Print Form': nav.print?.(); return;
    case 'Show Message': case 'MessageBox': await messageBox(a || '(no message)'); return;
    case 'Open Form': case 'OpenForm':
      if (!p?.getForm(a)) { await messageBox(`The form "${a}" does not exist. Check the On Click Argument.`, 'WOWDB', 'warn'); return; }
      app.openTab({ kind: 'form', name: p.getForm(a)!.name, title: p.getForm(a)!.name, view: 'form' }); return;
    case 'Open Report': case 'OpenReport':
      if (!p?.getReport(a)) { await messageBox(`The report "${a}" does not exist. Check the On Click Argument.`, 'WOWDB', 'warn'); return; }
      app.openTab({ kind: 'report', name: p.getReport(a)!.name, title: p.getReport(a)!.name, view: 'preview' }); return;
    case 'OpenTable':
      if (!p?.getTable(a)) { await messageBox(`The table "${a}" does not exist.`, 'WOWDB', 'warn'); return; }
      app.openTab({ kind: 'table', name: p.getTable(a)!.name, title: p.getTable(a)!.name, view: 'datasheet' }); return;
    case 'Run Query': case 'RunQuery': case 'OpenQuery': {
      const qd = p?.getQuery(a);
      if (!p || !qd) { await messageBox(`The query "${a}" does not exist.`, 'WOWDB', 'warn'); return; }
      if (qd.kind === 'select' || qd.kind === 'crosstab') { app.openTab({ kind: 'query', name: qd.name, title: qd.name, view: 'datasheet', payload: { autorun: true } }); return; }
      const prompts = queryParameters(p, qd.sql);
      const vals = prompts.length ? await askParameters(prompts) : {};
      if (!vals) return;
      const n = previewActionCount(p, qd, vals);
      if (!(await confirmBox(`The action query "${qd.name}" will change ${n ?? 'some'} record(s). Continue?`, { danger: true }))) return;
      try { const r = runQuery(p, qd, vals); await messageBox(r.message ?? 'Done.'); nav.refresh?.(); } catch (e) { await errorBox(e); }
      return;
    }
    case 'Run Macro': {
      const m = p?.getMacro(a);
      if (!m) { await messageBox(`The macro "${a}" does not exist.`, 'WOWDB', 'warn'); return; }
      for (const step of m.actions) await runAction(step.action, step.argument, nav);
      return;
    }
    default: await messageBox(`Unknown action "${action}".`, 'WOWDB', 'warn');
  }
}
