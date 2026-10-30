'use client';
import React, { useEffect, useState } from 'react';
import { Cloud, CloudOff, Copy, Database, LogOut, RefreshCw, Share2, Trash2, UserCircle2, Link2 } from 'lucide-react';
import { cloudMessage, type CloudDbInfo } from '@/cloud/backend';
import { getBackend, shareLink, uploadNow, useCloud } from '@/cloud/sync';
import { useApp } from './store';
import { confirmBox, messageBox, openDialog, showContextMenu } from './dialogs';

// ---------------- sign in / register ----------------
type Mode = 'signin' | 'register' | 'reset';
export function openAuthDialog(mode: Mode = 'signin') {
  return openDialog<boolean>('DBWOW account', (close) => <AuthDialog initial={mode} close={close} />, 420);
}

function AuthDialog({ initial, close }: { initial: Mode; close: (v: boolean | null) => void }) {
  const be = getBackend()!;
  const [mode, setMode] = useState<Mode>(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { setErr(null); setBusy(true); try { await fn(); return true; } catch (e) { setErr(cloudMessage(e)); return false; } finally { setBusy(false); } };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'register') {
      if (!name.trim()) { setErr('Enter your name. Your teacher and classmates see it on work you share.'); return; }
      if (pw !== pw2) { setErr('The two passwords are different.'); return; }
      if (await run(() => be.register(name, email, pw))) close(true);
    } else if (mode === 'signin') {
      if (await run(() => be.signIn(email, pw))) close(true);
    } else if (await run(() => be.resetPassword(email))) setInfo(`If an account exists for ${email}, a reset link has been sent. Check your inbox and spam folder.`);
  };
  return (
    <form onSubmit={submit} className="auth" data-testid="auth-dialog">
      <div className="auth-tabs">
        <button type="button" className={mode === 'signin' ? 'on' : ''} onClick={() => { setMode('signin'); setErr(null); }}>Sign in</button>
        <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr(null); }}>Register</button>
      </div>
      <p className="small muted mb-2">{mode === 'register' ? 'Create a free account to keep your databases, progress and trophies in the cloud, use them on any device, and share your work.' : mode === 'signin' ? 'Sign in to open your databases and progress on this device.' : 'Enter your email and we will send a link to choose a new password.'}</p>
      {mode === 'register' && <label className="auth-row">Your name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-label="Your name" autoFocus /></label>}
      <label className="auth-row">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-label="Email" autoFocus={mode !== 'register'} /></label>
      {mode !== 'reset' && <label className="auth-row">Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} aria-label="Password" /></label>}
      {mode === 'register' && <label className="auth-row">Confirm password<input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" aria-label="Confirm password" /></label>}
      {err && <div className="banner err mt-2" role="alert">{err}</div>}
      {info && <div className="banner ok mt-2">{info}</div>}
      <div className="dlg-buttons">
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : mode === 'signin' ? 'Sign in' : 'Send reset link'}</button>
        <button className="btn" type="button" onClick={() => close(null)}>Cancel</button>
      </div>
      {mode !== 'reset' && be.signInWithGoogle && <button type="button" className="btn w-full mt-2" disabled={busy} onClick={async () => { if (await run(() => be.signInWithGoogle!())) close(true); }}>Continue with Google</button>}
      {mode === 'signin' && <div className="small mt-2"><button type="button" className="link" onClick={() => { setMode('reset'); setErr(null); }}>Forgot password?</button></div>}
      {mode === 'reset' && <div className="small mt-2"><button type="button" className="link" onClick={() => setMode('signin')}>Back to sign in</button></div>}
    </form>
  );
}

// ---------------- title bar ----------------
export function AccountButton({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { available, ready, user, status, lastSaved, message } = useCloud();
  if (!available) return null;
  if (!ready) return <span className="acct-btn muted"><Cloud size={14} /></span>;
  if (!user) return <button className="acct-btn" onClick={() => void openAuthDialog('signin')} data-testid="sign-in"><UserCircle2 size={15} /><span className="hide-sm">Sign in to save online</span></button>;
  const icon = status === 'error' || status === 'offline' ? <CloudOff size={14} /> : status === 'saving' ? <RefreshCw size={13} className="spin" /> : <Cloud size={14} />;
  const tip = status === 'saving' ? 'Saving to your account…' : status === 'saved' ? `Saved to your account at ${lastSaved}` : message ?? 'Signed in';
  return (
    <button className={'acct-btn' + (status === 'error' ? ' bad' : '')} title={tip} data-testid="account-button" onClick={(e) => showContextMenu(e, [
      { label: `${user.name} (${user.email})`, disabled: true },
      { separator: true },
      { label: 'My account and cloud databases', onClick: onOpenAccount },
      { label: 'Save to my account now', onClick: () => void uploadNow(), disabled: !useApp.getState().project },
      { separator: true },
      { label: 'Sign out', onClick: async () => { await uploadNow(); await getBackend()!.signOut(); useApp.getState().setStatus('Signed out. Your work is still saved in this browser.'); } },
    ])}>
      {icon}<span className="hide-sm">{user.name}</span>
    </button>
  );
}

// ---------------- File > Account ----------------
export function AccountPage({ openCloud }: { openCloud: (id: string, name: string) => void }) {
  const { available, user, status, lastSaved, message } = useCloud();
  const projectId = useApp((s) => s.projectId);
  const [list, setList] = useState<CloudDbInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => { const be = getBackend(); if (!be || !user) return; setErr(null); be.listDatabases().then(setList).catch((e) => setErr(cloudMessage(e))); };
  useEffect(refresh, [user, lastSaved]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!available) return (
    <div>
      <h1>Account</h1>
      <p className="mb-2">Accounts are available on the online version of DBWOW. This copy keeps everything in this browser.</p>
      <p className="muted small">To move work to another device, use Download (.dbwow) and open the file there.</p>
    </div>
  );
  if (!user) return (
    <div>
      <h1>Account</h1>
      <p className="mb-3" style={{ maxWidth: 620 }}>Register for a free account to keep your databases, Learning Centre progress and trophies online. Sign in on any computer, tablet or phone to carry on where you left off, and share a database with your teacher or classmates.</p>
      <div className="flex gap-2"><button className="btn btn-primary" onClick={() => void openAuthDialog('register')} data-testid="register">Register</button><button className="btn" onClick={() => void openAuthDialog('signin')}>Sign in</button></div>
      <p className="muted small mt-3">Without an account, your work is saved in this browser only.</p>
    </div>
  );
  return (
    <div>
      <h1>Account</h1>
      <div className="acct-card mb-3">
        <UserCircle2 size={34} color="#1f5fae" />
        <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 15 }}>{user.name}</div><div className="small muted">{user.email}</div>
          <div className="small" style={{ color: status === 'error' ? '#a4262c' : '#2e6b31' }}>{status === 'saving' ? 'Saving…' : status === 'saved' ? `Open database saved to your account at ${lastSaved}` : message ?? 'Your databases and progress are kept in your account.'}</div></div>
        <button className="btn" onClick={async () => { await uploadNow(); await getBackend()!.signOut(); }}><LogOut size={13} style={{ display: 'inline', marginRight: 4 }} />Sign out</button>
      </div>
      <h2>Databases in my account</h2>
      {err && <div className="banner err mb-2">{err}</div>}
      <div className="recent" data-testid="cloud-list">
        {list?.map((d) => (
          <div key={d.id} className="recent-row" onClick={() => openCloud(d.id, d.name)} data-testid="cloud-row">
            <Cloud size={18} color="#1f5fae" />
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{d.name}{d.id === projectId ? ' (open)' : ''}{d.shareId && <span className="tag-shared"><Share2 size={11} /> shared</span>}</div>
              <div className="small muted">Saved {new Date(d.modified).toLocaleString()} · {(d.size / 1024).toFixed(0)} KB</div></div>
            <button className="icon-btn" title="Delete from my account" onClick={async (e) => { e.stopPropagation(); if (await confirmBox(`Delete "${d.name}" from your account?\n\nCopies saved in browsers are not affected.${d.shareId ? '\nThe shared link will stop working.' : ''}`, { danger: true })) { await getBackend()!.deleteDatabase(d.id); refresh(); } }}><Trash2 size={14} /></button>
          </div>
        ))}
        {list && !list.length && <div className="muted" style={{ padding: 10 }}>Nothing saved yet. The database you have open is saved here automatically while you are signed in.</div>}
        {!list && !err && <div className="muted" style={{ padding: 10 }}>Loading…</div>}
      </div>
    </div>
  );
}

// ---------------- File > Share ----------------
export function SharePage({ goAccount }: { goAccount: () => void }) {
  const { available, user } = useCloud();
  const project = useApp((s) => s.project);
  const projectId = useApp((s) => s.projectId);
  const [shareId, setShareId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const be = getBackend(); if (!be || !user || !projectId) { setShareId(null); return; }
    be.listDatabases().then((l) => setShareId(l.find((d) => d.id === projectId)?.shareId ?? null)).catch(() => setShareId(null));
  }, [user, projectId]);
  if (!project) return <div><h1>Share</h1><p>Open a database first.</p></div>;
  if (!available) return <div><h1>Share</h1><p className="mb-2">Sharing links are available on the online version of DBWOW.</p><p className="muted small">You can still share the file: File &gt; Download (.dbwow), then send it. Anyone can open it with File &gt; Open.</p></div>;
  if (!user) return <div><h1>Share</h1><p className="mb-3">Sign in to share "{project.name}" with a link.</p><button className="btn btn-primary" onClick={goAccount}>Register or sign in</button></div>;
  const link = shareId ? shareLink(shareId) : '';
  const doShare = async () => {
    setErr(null); setBusy(true);
    try { await uploadNow(); const id = await getBackend()!.shareDatabase(projectId!, project.name, project.db.export()); setShareId(id); }
    catch (e) { setErr(cloudMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ maxWidth: 680 }}>
      <h1>Share</h1>
      <h2 style={{ marginTop: 0 }}>{project.name}</h2>
      {!shareId && <>
        <p className="mb-3">Create a link that lets anyone, such as your teacher or a classmate, open a copy of this database: its tables, records, queries, forms and reports. They get their own copy; they cannot change yours.</p>
        <button className="btn btn-primary" onClick={() => void doShare()} disabled={busy || shareId === undefined} data-testid="create-share"><Link2 size={14} style={{ display: 'inline', marginRight: 5 }} />{busy ? 'Creating link…' : 'Create share link'}</button>
      </>}
      {shareId && <>
        <p className="mb-2">Anyone with this link can open a copy of this database. The shared copy updates automatically each time your work is saved to your account.</p>
        <div className="share-link"><input readOnly value={link} aria-label="Share link" data-testid="share-link" onFocus={(e) => e.target.select()} />
          <button className="btn btn-primary" onClick={() => { void navigator.clipboard?.writeText(link).then(() => useApp.getState().setStatus('Share link copied.')).catch(() => undefined); }}><Copy size={13} style={{ display: 'inline', marginRight: 4 }} />Copy</button></div>
        <div className="flex gap-2 mt-3">
          <button className="btn" onClick={async () => { if (await confirmBox('Stop sharing? The link will stop working.', { danger: true })) { await getBackend()!.unshareDatabase(projectId!); setShareId(null); } }}>Stop sharing</button>
        </div>
      </>}
      {err && <div className="banner err mt-3">{err}</div>}
    </div>
  );
}

// ---------------- shared links ----------------
/** If the page was opened with ?share=…, offer to open a copy. Returns bytes and name, or null. */
export async function takeSharedLink(): Promise<{ bytes: Uint8Array; name: string } | null> {
  const params = new URLSearchParams(location.search);
  const id = params.get('share');
  if (!id) return null;
  params.delete('share');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  const be = getBackend();
  if (!be) { void messageBox('This shared link needs the online version of DBWOW.', 'Shared database', 'warn'); return null; }
  try {
    const s = await be.loadShared(id);
    if (!s) { void messageBox('This shared database is no longer available. The owner may have stopped sharing it.', 'Shared database', 'warn'); return null; }
    const ok = await confirmBox(`Open a copy of "${s.name}"${s.ownerName ? `, shared by ${s.ownerName}` : ''}?\n\nLast updated ${new Date(s.modified).toLocaleString()}. The copy is yours to explore and change; the original is not affected.`, { title: 'Shared database', ok: 'Open a copy', cancel: 'Cancel' });
    return ok ? { bytes: s.bytes, name: s.name } : null;
  } catch (e) { void messageBox(cloudMessage(e), 'Shared database', 'warn'); return null; }
}

export { Database };
