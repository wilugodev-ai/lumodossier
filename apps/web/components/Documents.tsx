'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Search,
  Plus,
  FileText,
  FolderOpen,
  Clock3,
  CircleCheck,
  Files,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  UploadCloud,
  LayoutTemplate,
} from 'lucide-react';
import { sender, message, dateTime } from '../lib/client';
import { states, type Refs, type Summary, type Workspace } from '../lib/types';
import { PropertyTemplates } from './PropertyTemplates';
type Listing = { documents: Summary[]; total: number; stats: { status: string; count: number }[] };
export function Documents({
  workspace,
  initial = '',
  refs,
  open,
  create,
  templates,
}: {
  workspace: Workspace;
  initial?: string;
  refs: Refs;
  open: (id: string) => void;
  create: () => void;
  templates: () => void;
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState(initial),
    [page, setPage] = useState(1),
    [data, setData] = useState<Listing | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0);
  const context = JSON.stringify(refs);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const t = setTimeout(() => {
      const q = new URLSearchParams({
        ...JSON.parse(context),
        q: search,
        status: filter,
        page: String(page),
      });
      sender<Listing>('/workspaces/' + workspace.id + '/documents?' + q)
        .then((d) => {
          if (alive) setData(d);
        })
        .catch((e) => {
          if (alive) setError(message(e));
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 160);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [workspace.id, context, filter, page, search, tick]);
  const count = (s: string) => data?.stats.find((x) => x.status === s)?.count ?? 0;
  const summaries = [
    { Icon: Files, name: 'Total documents', value: data?.stats.reduce((s, v) => s + v.count, 0) ?? 0 },
    {
      Icon: Clock3,
      name: 'Awaiting signatures',
      value: count('sent') + count('viewed') + count('partially_signed'),
    },
    { Icon: CircleCheck, name: 'Completed', value: count('completed') },
  ];
  return (
    <>
      <div className="workspace-head">
        <div>
          <div className="eyebrow">
            {Object.keys(refs).length ? 'Related documents' : 'Workspace overview'}
          </div>
          <h1>{initial ? states[initial] + ' documents' : 'Documents'}</h1>
          <p>Prepare, send and track your signature requests.</p>
        </div>
        {workspace.role !== 'viewer' && (
          <div className="document-actions">
            <button className="button outline" onClick={templates}>
              <LayoutTemplate size={17} /> Real estate templates
            </button>
            <button className="button" onClick={create}>
              <Plus size={17} /> New request
            </button>
          </div>
        )}
      </div>
      <div className="summary-grid">
        {summaries.map(({ Icon, name, value }) => (
          <div key={name}>
            <span className="summary-icon">
              <Icon size={19} />
            </span>
            <span>{name}</span>
            <strong>{data ? value : '—'}</strong>
          </div>
        ))}
      </div>
      <section className="panel listing">
        <div className="list-tools">
          <div className="search">
            <Search size={17} />
            <input
              placeholder="Search documents"
              aria-label="Search documents"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Filter by status"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(states).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="icon-btn" aria-label="Refresh documents" onClick={() => setTick(tick + 1)}>
            <RefreshCw size={17} />
          </button>
        </div>
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : loading ? (
          <p className="empty" role="status">
            Loading documents…
          </p>
        ) : !data?.documents.length ? (
          <div className="empty">
            <FolderOpen size={36} />
            <h2>{search || filter ? 'No matching documents' : 'Your document shelf is empty'}</h2>
            <p>
              {search || filter
                ? 'Try another title or status.'
                : 'Upload a PDF or use a real estate template for your first request.'}
            </p>
            {!search && !filter && workspace.role !== 'viewer' && (
              <button className="button outline" onClick={create}>
                Create a request
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Recipients</th>
                  <th>Last updated</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <button className="doc-title" onClick={() => open(d.id)}>
                        <FileText size={18} />
                        {d.title}
                      </button>
                    </td>
                    <td>
                      <span className={'status ' + d.status}>{states[d.status]}</span>
                    </td>
                    <td>
                      {d.status === 'draft'
                        ? d.recipients.length + ' assigned'
                        : d.signed + ' / ' + d.total + ' signed'}
                    </td>
                    <td>{dateTime(d.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="pager">
            <span>
              {data.total} document{data.total === 1 ? '' : 's'}
            </span>
            <div className="inline">
              <button
                aria-label="Previous results"
                className="icon-btn"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              Page {page} of {Math.max(1, Math.ceil(data.total / 20))}
              <button
                aria-label="Next results"
                className="icon-btn"
                disabled={page * 20 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
export function Upload({
  workspace,
  refs,
  open,
  templateMode,
  changeSource,
}: {
  workspace: Workspace;
  refs: Refs;
  open: (id: string) => void;
  templateMode: boolean;
  changeSource: (templates: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const choose = useCallback((f: File | undefined) => {
    if (!f) return;
    setError('');
    if (!/\.pdf$/i.test(f.name) || f.size > 15 * 1024 * 1024) {
      setError('Choose a PDF of up to 15 MB.');
      return;
    }
    setFile(f);
    setTitle(f.name.replace(/\.pdf$/i, ''));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const r = await sender<{ id: string }>(
        '/workspaces/' + workspace.id + '/documents',
        'POST',
        file,
        { 'X-Document-Title': encodeURIComponent(title), 'X-CRM-References': JSON.stringify(refs) },
      );
      open(r.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="workspace-head">
        <div>
          <div className="eyebrow">New signature request</div>
          <h1>{templateMode ? 'Real estate templates' : 'Upload a document'}</h1>
          <p>
            {templateMode
              ? 'Choose a form to prepare for signature.'
              : 'Choose the PDF your recipients will review and sign.'}
          </p>
        </div>
      </div>
      <nav className="request-sources" aria-label="Document source">
        <button aria-pressed={!templateMode} disabled={busy} onClick={() => changeSource(false)}>
          <UploadCloud size={16} /> Upload PDF
        </button>
        <button aria-pressed={templateMode} disabled={busy} onClick={() => changeSource(true)}>
          <LayoutTemplate size={16} /> Real estate templates
        </button>
      </nav>
      {templateMode ? (
        <PropertyTemplates workspace={workspace} refs={refs} open={open} />
      ) : (
        <form className="form-panel" onSubmit={submit}>
          <label
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={36} />
            <strong>{file ? file.name : 'Choose a PDF or drag it here'}</strong>
            <span>PDF · Up to 15 MB · Up to 100 pages</span>
            <input
              aria-label="Choose PDF"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>
          <label>
            Document title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required />
          </label>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button className="button" disabled={!file || busy}>
            {busy ? 'Validating PDF…' : 'Upload and continue'}
          </button>
        </form>
      )}
    </>
  );
}
