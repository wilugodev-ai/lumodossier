'use client';
import { useEffect, useState } from 'react';
import { Link2, Bell, Ban, Download, FileCheck2, History, FileText, Check, Copy } from 'lucide-react';
import { dateTime, message, sender, access, saveCopy } from '../lib/client';
import { VerifyCopy } from './VerifyCopy';
import { states, type Detail } from '../lib/types';
const labels: Record<string, string> = {
  created: 'Draft created',
  sent: 'Request sent',
  viewed: 'Document viewed',
  signed: 'Signature recorded',
  completed: 'Document completed',
  cancelled: 'Request cancelled',
  expired: 'Request expired',
  declined: 'Request declined',
  links_revoked: 'Recipient links revoked',
  manual_link_created: 'Manual link created',
  reminder_requested: 'Reminder requested',
  processing_retried: 'File processing requested again',
};
const delivery: Record<string, string> = {
  unavailable: 'Email not sent',
  queued: 'Email queued',
  accepted: 'Accepted by email provider',
  failed: 'Email attempt failed',
  superseded: 'Invitation superseded',
};
export function Tracking({
  doc,
  path,
  write,
  refresh,
}: {
  doc: Detail;
  path: string;
  write: boolean;
  refresh: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [link, setLink] = useState<{ url: string; expiresAt: string; name: string } | null>(null),
    [note, setNote] = useState(''),
    [confirm, setConfirm] = useState<{ label: string; route: string } | null>(null);
  const open = ['sent', 'viewed', 'partially_signed'].includes(doc.status) && !doc.sealed_at;
  useEffect(() => {
    if ((!open && !doc.sealed_at) || doc.completed_at) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh, open, doc.sealed_at, doc.completed_at]);
  async function action(route: string, name?: string) {
    setError('');
    setNote('');
    setBusy(true);
    setConfirm(null);
    try {
      const r = await sender<{ url?: string; expiresAt?: string }>(path + route, 'POST', {});
      if (r.url) setLink({ url: r.url, expiresAt: r.expiresAt!, name: name! });
      else {
        setLink(null);
        setNote(route.endsWith('/remind') ? 'Reminder queued.' : 'Request updated.');
      }
      refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(k: string) {
    try {
      setError('');
      await saveCopy(
        path + '/files/' + k,
        await access(),
        doc.title +
          (k === 'record' ? ' - completion record.json' : k === 'completed' ? ' - signed.pdf' : '.pdf'),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  const next = doc.people.find((p) => !p.signed_at)?.id;
  return (
    <>
      <div className="workspace-head">
        <div>
          <div className="eyebrow">Signature request</div>
          <h1>{doc.title}</h1>
          <p>
            Created {dateTime(doc.created_at)} ·{' '}
            {doc.routing === 'sequential' ? 'Sequential signing' : 'Simultaneous signing'}
          </p>
        </div>
        <span className={'status ' + doc.status}>{states[doc.status]}</span>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      {doc.processingFailed && (
        <section className="notice warning">
          <strong>A document file needs attention.</strong>
          <p>Your document and any recorded signatures are saved.</p>
          {write && (
            <button className="button outline" disabled={busy} onClick={() => action('/retry-files')}>
              Retry file processing
            </button>
          )}
        </section>
      )}
      {confirm && (
        <section className="notice warning">
          <strong>{confirm.label}</strong>
          <div className="actions">
            <button className="button" onClick={() => action(confirm.route)}>
              Confirm
            </button>
            <button className="button outline" onClick={() => setConfirm(null)}>
              Go back
            </button>
          </div>
        </section>
      )}
      {link && (
        <section className="notice share-box">
          <div>
            <strong>Manual sharing link for {link.name}</strong>
            <p>
              Share privately. This replaces their earlier links and expires {dateTime(link.expiresAt)}.
            </p>
          </div>
          <label>
            Private recipient link
            <input
              aria-label={'Private recipient link for ' + link.name}
              readOnly
              value={link.url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <div className="actions">
            <button
              className="button outline"
              onClick={() =>
                navigator.clipboard
                  .writeText(link.url)
                  .then(() => setNote('Link copied.'))
                  .catch(() => setNote('Select the link and copy it.'))
              }
            >
              <Copy size={15} />
              Copy link
            </button>
            <button className="link-button" onClick={() => setLink(null)}>
              Hide link
            </button>
          </div>
        </section>
      )}
      <div className="track-layout">
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Recipient progress</h2>
              <span>
                {doc.signed} of {doc.people.length} signed
              </span>
            </div>
            {doc.people.map((p, i) => {
              const eligible =
                doc.status === 'completed' ||
                (open && !p.signed_at && (doc.routing === 'simultaneous' || next === p.id));
              const latest = doc.deliveries.filter((d) => d.person_id === p.id).at(-1);
              return (
                <article key={p.id} className="track-person">
                  <span className={'ordinal ' + (p.signed_at ? 'done' : '')}>
                    {p.signed_at ? <Check size={16} /> : i + 1}
                  </span>
                  <div className="grow">
                    <strong>{p.name}</strong>
                    <small>{p.email}</small>
                    <p>
                      {p.declined_at
                        ? 'Declined ' + dateTime(p.declined_at)
                        : p.signed_at
                          ? 'Signed ' + dateTime(p.signed_at)
                          : p.viewed_at
                            ? 'Viewed ' + dateTime(p.viewed_at)
                            : !eligible && open
                              ? 'Waiting for their turn'
                              : 'Awaiting signature'}
                      {latest && ' · ' + delivery[latest.status]}
                    </p>
                    {write && (eligible || open) && (
                      <div className="mini-actions">
                        {eligible && (
                          <button
                            disabled={busy}
                            onClick={() => action('/recipients/' + p.id + '/share', p.name)}
                          >
                            <Link2 size={15} />
                            Create sharing link
                          </button>
                        )}
                        {eligible && open && doc.emailEnabled && (
                          <button
                            disabled={busy}
                            onClick={() => action('/recipients/' + p.id + '/remind')}
                          >
                            <Bell size={14} />
                            Remind
                          </button>
                        )}
                        <button
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              label: 'Revoke active links for ' + p.name + '?',
                              route: '/recipients/' + p.id + '/revoke',
                            })
                          }
                        >
                          Revoke links
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
          {doc.deliveries.length > 0 && (
            <section className="panel mail-history">
              <h2>Email activity</h2>
              {doc.deliveries.map((d) => (
                <details key={d.id}>
                  <summary>
                    {doc.people.find((p) => p.id === d.person_id)?.name ?? doc.sender_name} · {d.kind} ·{' '}
                    {delivery[d.status]}
                  </summary>
                  <small>{dateTime(d.created_at)}</small>
                  {d.attempt_log.map((a, i) => (
                    <small key={i}>
                      {a.outcome === 'accepted' ? 'Accepted by provider' : 'Attempt failed'} ·{' '}
                      {dateTime(a.at)}
                    </small>
                  ))}
                </details>
              ))}
            </section>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>
                <History size={19} />
                Activity history
              </h2>
            </div>
            <ol className="timeline">
              {doc.events.map((e) => (
                <li key={e.id}>
                  <span className="event-point" />
                  <div>
                    <strong>{labels[e.kind] || e.kind}</strong>
                    <small>
                      {e.actor} · {dateTime(e.occurred_at)}
                    </small>
                    {e.detail.reason && <p>{e.detail.reason}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="stack">
          <section className="panel">
            <h2>Document files</h2>
            <button className="file-action" onClick={() => download('original')}>
              <FileText />
              Original PDF
              <Download size={15} />
            </button>
            {doc.completed_at ? (
              <>
                <button className="file-action" onClick={() => download('completed')}>
                  <FileCheck2 />
                  Signed PDF
                  <Download size={15} />
                </button>
                <button className="file-action" onClick={() => download('record')}>
                  <History />
                  Completion record
                  <Download size={15} />
                </button>
                <VerifyCopy key={doc.id} recordPath={path + '/files/record'} requestId={doc.id} />
              </>
            ) : (
              <p className="hint">
                {doc.sealed_at
                  ? 'All signatures recorded. Preparing your completed copy.'
                  : 'The signed copy becomes available after everyone signs.'}
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Request details</h2>
            <small>Sender</small>
            <p>
              {doc.sender_name}
              <small>{doc.sender_email}</small>
            </p>
            <small>Signing deadline</small>
            <p>{dateTime(doc.expires_at)}</p>
            {open && write && (
              <button
                className="link-button danger"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    label: 'Cancel this request and close every signing link?',
                    route: '/cancel',
                  })
                }
              >
                <Ban size={15} />
                Cancel request
              </button>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
