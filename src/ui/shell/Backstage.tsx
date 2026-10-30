'use client';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Cloud, Database, FilePlus, FolderOpen, Trash2, GraduationCap } from 'lucide-react';
import { AccountPage, SharePage } from '../cloud';
import { useCloud } from '@/cloud/sync';
import { listProjects, type ProjectInfo } from '@/engine/persistence';
import { SAMPLE_LIST } from '@/engine/samples';
import { useApp } from '../store';

export interface BackstageOps {
  newBlank: () => void; newSample: (id: string) => void; openStored: (id: string) => void; openFile: () => void;
  save: () => void; saveAs: () => void; downloadCopy: () => void; properties: () => void; backup: () => void; restore: () => void;
  compact: () => void; exportDb: () => void; print: () => void; close: () => void; deleteStored: (id: string, name: string) => void; learning: () => void;
  openCloud: (id: string, name: string) => void;
}

export function Backstage({ ops }: { ops: BackstageOps }) {
  const project = useApp((s) => s.project);
  const projectId = useApp((s) => s.projectId);
  const setBackstage = useApp((s) => s.setBackstage);
  const setRibbonTab = useApp((s) => s.setRibbonTab);
  const version = useApp((s) => s.version);
  const [page, setPage] = useState<'info' | 'new' | 'open' | 'account' | 'share'>(project ? 'info' : 'new');
  const cloudUser = useCloud((s) => s.user);
  const cloudOn = useCloud((s) => s.available);
  const [recent, setRecent] = useState<ProjectInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { listProjects().then(setRecent).catch((e) => setErr((e as Error).message)); }, [version, page]);
  const back = () => { setBackstage(false); setRibbonTab('home'); };

  return (
    <div className="backstage" data-testid="backstage">
      <div className="bs-side">
        {project && <button className="back" onClick={back} aria-label="Back"><ArrowLeft size={20} /></button>}
        {!project && <div style={{ padding: '6px 22px 16px', fontWeight: 700, fontSize: 18, letterSpacing: 0.5 }}>DBWOW</div>}
        <button className={page === 'info' ? 'active' : ''} disabled={!project} onClick={() => setPage('info')}>Info</button>
        <button className={page === 'new' ? 'active' : ''} onClick={() => setPage('new')}>New</button>
        <button className={page === 'open' ? 'active' : ''} onClick={() => setPage('open')}>Open</button>
        <button disabled={!project} onClick={() => { ops.save(); back(); }}>Save</button>
        <button disabled={!project} onClick={ops.saveAs}>Save As</button>
        <button disabled={!project} onClick={ops.downloadCopy}>Download (.dbwow)</button>
        <button disabled={!project} className={page === 'share' ? 'active' : ''} onClick={() => setPage('share')} data-testid="bs-share">Share</button>
        <button disabled={!project} onClick={ops.exportDb}>Export</button>
        <button disabled={!project} onClick={ops.print}>Print</button>
        <button disabled={!project} onClick={ops.close}>Close</button>
        <div style={{ flex: 1 }} />
        {cloudOn && <button className={page === 'account' ? 'active' : ''} onClick={() => setPage('account')} data-testid="bs-account"><Cloud size={14} style={{ display: 'inline', marginRight: 6 }} />{cloudUser ? 'Account' : 'Sign in / Register'}</button>}
        <button onClick={ops.learning}><GraduationCap size={14} style={{ display: 'inline', marginRight: 6 }} />Learning Centre</button>
      </div>
      <div className="bs-main">
        {err && <div className="banner err mb-3">{err}</div>}
        {page === 'info' && project && (
          <div>
            <h1>Info</h1>
            <h2 style={{ marginTop: 0 }}>{project.name}</h2>
            <p className="muted mb-3">{project.getMeta('description') || 'No description.'}</p>
            <div className="tiles" style={{ maxWidth: 760 }}>
              <button className="tile" onClick={ops.properties}><span className="t">Database Properties</span><span className="d">Name, description, size and contents.</span></button>
              <button className="tile" onClick={ops.compact}><span className="t">Compact &amp; Repair</span><span className="d">Rebuild the file (VACUUM) and check its integrity.</span></button>
              <button className="tile" onClick={ops.backup}><span className="t">Back Up Database</span><span className="d">Keep a copy in the browser and/or download it.</span></button>
              <button className="tile" onClick={ops.restore}><span className="t">Restore</span><span className="d">Go back to an earlier backup.</span></button>
            </div>
            <p className="muted small mt-3">Every change is saved automatically to this browser&apos;s storage{cloudUser ? ' and to your account' : ''}. Use Download to keep a .dbwow file (a standard SQLite database) on your computer or USB drive. Project ID: {projectId}</p>
          </div>
        )}
        {page === 'account' && <AccountPage openCloud={ops.openCloud} />}
        {page === 'share' && <SharePage goAccount={() => setPage('account')} />}
        {page === 'new' && (
          <div>
            <h1>New</h1>
            <div className="tiles">
              <button className="tile" onClick={ops.newBlank} data-testid="new-blank"><FilePlus size={26} color="#1f5fae" /><span className="t">Blank database</span><span className="d">Start from nothing and design your own tables.</span></button>
              {SAMPLE_LIST.map((s) => (
                <button key={s.id} className="tile" onClick={() => ops.newSample(s.id)} data-testid={`new-sample-${s.id}`}><Database size={26} color="#2e7d32" /><span className="t">{s.name}</span><span className="d">{s.description}</span></button>
              ))}
            </div>
            <p className="muted small mt-3">Samples contain only fictional data, with keys, enforced relationships, queries, forms, reports and exercises.</p>
          </div>
        )}
        {page === 'open' && (
          <div>
            <h1>Open</h1>
            <button className="btn btn-primary mb-3" onClick={ops.openFile}><FolderOpen size={14} style={{ display: 'inline', marginRight: 6 }} />Browse for a .dbwow / .wowdb / .db / .sqlite file…</button>
            {cloudOn && <p className="small muted mb-2">{cloudUser ? <>Databases saved in your account are under <button className="link" onClick={() => setPage('account')}>Account</button>.</> : <>Have an account? <button className="link" onClick={() => setPage('account')}>Sign in</button> to open your databases from any device.</>}</p>}
            <h2>Recent (stored in this browser)</h2>
            <div className="recent">
              {recent.map((r) => (
                <div key={r.id} className="recent-row" onClick={() => ops.openStored(r.id)} data-testid="recent-row">
                  <Database size={18} color="#1f5fae" />
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{r.name}{r.id === projectId ? ' (open)' : ''}</div><div className="small muted">Modified {new Date(r.modified).toLocaleString()} · {(r.size / 1024).toFixed(0)} KB</div></div>
                  <button className="icon-btn" title="Delete from this browser" onClick={(e) => { e.stopPropagation(); ops.deleteStored(r.id, r.name); }}><Trash2 size={14} /></button>
                </div>
              ))}
              {!recent.length && <div className="muted" style={{ padding: 10 }}>No databases yet. Create one from New.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
