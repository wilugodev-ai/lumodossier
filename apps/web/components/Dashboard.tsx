'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Files,
  FilePenLine,
  CircleCheck,
  LogOut,
  SunMoon,
  Menu,
  X,
  Building2,
  ChevronLeft,
  Plus,
} from 'lucide-react';
import { Brand } from './Brand';
import { MotionControl } from './Motion';
import { Documents, Upload } from './Documents';
import { Editor } from './Editor';
import { Tracking } from './Tracking';
import { authClient, message, sender } from '../lib/client';
import type { Detail, Refs, Workspace } from '../lib/types';

function Record({ w, id, back }: { w: Workspace; id: string; back: () => void }) {
  const path = '/workspaces/' + w.id + '/documents/' + encodeURIComponent(id),
    [doc, setDoc] = useState<Detail | null>(null),
    [error, setError] = useState('');
  const refresh = useCallback(() => {
    sender<Detail>(path)
      .then((d) => {
        setDoc(d);
        setError('');
      })
      .catch((e) => setError(message(e)));
  }, [path]);
  useEffect(refresh, [refresh]);
  return (
    <>
      <button className="back" onClick={back}>
        <ChevronLeft size={15} />
        All documents
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {doc?.status === 'draft' && doc.processingFailed && (
        <div className="notice warning">
          The original PDF is saved and waiting for private storage.{' '}
          {w.role !== 'viewer' && (
            <button
              className="link-button"
              onClick={() =>
                sender(path + '/retry-files', 'POST', {})
                  .then(refresh)
                  .catch((e) => setError(message(e)))
              }
            >
              Retry file processing
            </button>
          )}
        </div>
      )}
      {!doc ? (
        <p role="status">Opening document…</p>
      ) : doc.status === 'draft' && w.role !== 'viewer' ? (
        <Editor doc={doc} path={path} done={refresh} />
      ) : (
        <Tracking doc={doc} path={path} write={w.role !== 'viewer'} refresh={refresh} />
      )}
    </>
  );
}
export function Dashboard() {
  const params = useSearchParams(),
    router = useRouter(),
    [spaces, setSpaces] = useState<Workspace[] | null>(null),
    [error, setError] = useState(''),
    [email, setEmail] = useState(''),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [dark, setDark] = useState(true);
  const adding = params.has('newWorkspace');
  const selected = params.get('workspace'),
    doc = params.get('document'),
    upload = params.has('new'),
    filter = params.get('status') || '';
  const refs: Refs = {};
  for (const k of ['customer', 'quote', 'deal'] as const) {
    const v = params.get(k);
    if (v) refs[k] = v;
  }
  const workspace = selected ? spaces?.find((w) => w.id === selected) : spaces?.[0];
  const go = (details: Record<string, string> = {}, keepRefs = true, w = workspace?.id) => {
    const q = new URLSearchParams({
      ...(w ? { workspace: w } : {}),
      ...(keepRefs ? refs : {}),
      ...details,
    });
    router.push('/dashboard?' + q.toString());
    setMenu(false);
  };
  useEffect(() => {
    let live = true;
    setDark(localStorage.getItem('lumo-theme') !== 'light');
    (async () => {
      const result = await authClient().auth.getSession();
      if (!live) return;
      if (!result.data.session) {
        location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
        return;
      }
      setEmail(result.data.session.user.email ?? '');
      const rows = await sender<Workspace[]>('/workspaces');
      if (live) setSpaces(rows);
    })().catch((e) => {
      if (live) setError(message(e));
    });
    return () => {
      live = false;
    };
  }, []);
  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const w = await sender<Workspace>('/workspaces', 'POST', { name });
      setSpaces((s) => [...(s ?? []), w]);
      setName('');
      go({}, false, w.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      const { error } = await authClient().auth.signOut({ scope: 'local' });
      if (error) throw error;
      location.assign('/');
    } catch (e) {
      setError(message(e));
    }
  }
  function theme() {
    setDark(!dark);
    localStorage.setItem('lumo-theme', dark ? 'light' : 'dark');
  }
  return (
    <div className={'desk' + (dark ? ' dark' : '')}>
      <div className="mobile-bar">
        <Brand small />
        <button className="icon-btn" aria-label="Toggle workspace menu" onClick={() => setMenu(!menu)}>
          {menu ? <X /> : <Menu />}
        </button>
      </div>
      <aside className={'sidebar' + (menu ? ' visible' : '')}>
        <Brand />
        <div className="workspace-picker">
          <label>
            <span>
              <Building2 size={14} /> Workspace
            </span>
            <select
              aria-label="Current workspace"
              value={workspace?.id || ''}
              onChange={(e) => go({}, false, e.target.value)}
            >
              {!workspace && <option value="">Select workspace</option>}
              {spaces?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav aria-label="Workspace navigation">
          {[
            { Icon: Files, label: 'All documents', key: '' },
            { Icon: FilePenLine, label: 'Drafts', key: 'draft' },
            { Icon: CircleCheck, label: 'Completed', key: 'completed' },
          ].map(({ Icon, label, key }) => (
            <button
              key={label}
              disabled={!spaces}
              className={!adding && !upload && !doc && filter === key ? 'active' : ''}
              onClick={() => go(key ? { status: key } : {}, false)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
          <button disabled={!spaces} onClick={() => go({ newWorkspace: '1' }, false)}>
            <Plus size={18} />
            Create workspace
          </button>
        </nav>
        <div className="side-bottom">
          <MotionControl />
          <button onClick={theme}>
            <SunMoon size={17} />
            {dark ? 'Light appearance' : 'Dark appearance'}
          </button>
          {email && (
            <>
              <small>{email}</small>
              <button onClick={logout}>
                <LogOut size={16} />
                Sign out
              </button>
            </>
          )}
        </div>
      </aside>
      <main id="main" className="desk-main">
        {error && (
          <div className="notice error" role="alert">
            {error} <a href="/login">Sign in</a>
          </div>
        )}
        {spaces === null ? (
          <p role="status">{error ? 'The workspace could not be opened.' : 'Opening workspace…'}</p>
        ) : adding || !spaces.length ? (
          <form className="form-panel onboard" onSubmit={create}>
            <span className="eyebrow">LumoDossier</span>
            <h1>Create a workspace</h1>
            <p>Give your signature requests a place to live.</p>
            <label>
              Workspace name
              <input
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? 'Creating…' : 'Create workspace'}
            </button>
          </form>
        ) : !workspace ? (
          <p className="notice error">This workspace is unavailable to your account.</p>
        ) : doc ? (
          <Record key={workspace.id + doc} w={workspace} id={doc} back={() => go()} />
        ) : upload && workspace.role !== 'viewer' ? (
          <>
            <button className="back" onClick={() => go()}>
              <ChevronLeft size={15} />
              All documents
            </button>
            <Upload workspace={workspace} refs={refs} open={(id) => go({ document: id })} />
          </>
        ) : (
          <Documents
            key={workspace.id + filter + JSON.stringify(refs)}
            workspace={workspace}
            refs={refs}
            initial={filter}
            open={(id) => go({ document: id })}
            create={() => go({ new: '1' })}
          />
        )}
      </main>
    </div>
  );
}
