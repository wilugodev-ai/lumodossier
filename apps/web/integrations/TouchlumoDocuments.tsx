'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Refs, Summary, Workspace } from '../lib/types';
import { states } from '../lib/types';

export const touchlumoNavigationLabel = 'LumoDossier — Documents & Signatures';
export interface TouchlumoDocumentsProps {
  workspaceId: string;
  role: Workspace['role'];
  crm?: Refs;
  apiOrigin: string;
  webOrigin: string;
  getAccessToken: () => Promise<string>;
}
export function TouchlumoDocuments({
  workspaceId,
  role,
  crm = {},
  apiOrigin,
  webOrigin,
  getAccessToken,
}: TouchlumoDocumentsProps) {
  const [items, setItems] = useState<Summary[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const context = new URLSearchParams(crm).toString();
  const url = (query: Record<string, string>) =>
    webOrigin + '/dashboard?' + new URLSearchParams({ ...crm, workspace: workspaceId, ...query });
  const refresh = useCallback(async () => {
    const token = await getAccessToken(),
      qs = new URLSearchParams(context);
    qs.set('page', String(page));
    const result = await fetch(
      apiOrigin + '/v1/workspaces/' + encodeURIComponent(workspaceId) + '/documents?' + qs,
      {
        headers: { Authorization: 'Bearer ' + token },
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      },
    );
    if (!result.ok) throw Error('Related signature requests are unavailable.');
    return result.json() as Promise<{ documents: Summary[]; total: number }>;
  }, [workspaceId, context, apiOrigin, getAccessToken, page]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const run = () =>
      refresh()
        .then((r) => {
          if (live) {
            setItems(r.documents);
            setTotal(r.total);
            setError('');
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    void run();
    const timer = setInterval(run, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function download(id: string) {
    try {
      const res = await fetch(
        apiOrigin + '/v1/workspaces/' + workspaceId + '/documents/' + id + '/files/completed',
        { headers: { Authorization: 'Bearer ' + (await getAccessToken()) }, cache: 'no-store' },
      );
      if (!res.ok) throw Error('The completed copy is unavailable.');
      const blob = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = blob;
      a.download = 'LumoDossier-signed.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(blob), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed.');
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{touchlumoNavigationLabel}</h2>
        {role !== 'viewer' && (
          <a className="button" href={url({ new: '1' })}>
            New signature request
          </a>
        )}
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading signature requests…</p>
      ) : items.length ? (
        <ul>
          {items.map((d) => (
            <li key={d.id}>
              <a href={url({ document: d.id })}>{d.title}</a> · {states[d.status]}
              {d.status === 'completed' && (
                <>
                  {' '}
                  ·{' '}
                  <button className="link-button" onClick={() => download(d.id)}>
                    Download signed PDF
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No related signature requests yet.</p>
      )}
      {total > 20 && (
        <div className="actions">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          Page {page} of {Math.ceil(total / 20)}
          <button disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}
