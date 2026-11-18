'use client';
import { useState, useEffect, useCallback } from 'react';
import { LockKeyhole, Download, Check, CheckCircle2, PenLine } from 'lucide-react';
import { Brand } from './Brand';
import { MotionControl } from './Motion';
import { PdfPage } from './PdfPage';
import { DrawSignature } from './DrawSignature';
import { request, saveCopy, message, dateTime } from '../lib/client';
import type { Field, SigningView, Value } from '../lib/types';
export function Signer() {
  const [token, setToken] = useState(''),
    [view, setView] = useState<SigningView | null>(null),
    [error, setError] = useState(''),
    [page, setPage] = useState(0),
    [values, setValues] = useState<Record<string, Value>>({}),
    [draw, setDraw] = useState<Record<string, boolean>>({}),
    [consent, setConsent] = useState(false),
    [intent, setIntent] = useState(false),
    [busy, setBusy] = useState(false),
    [declining, setDeclining] = useState(false),
    [declined, setDeclined] = useState(false),
    [reason, setReason] = useState('');
  const load = useCallback(async (t: string) => {
    const r = await request('/recipient/open', t, 'POST', {});
    setView(await r.json());
  }, []);
  useEffect(() => {
    const t = location.hash.slice(1);
    if (!t) {
      setError('Open the complete private link from your invitation.');
      return;
    }
    setToken(t);
    load(t).catch((e) => setError(message(e)));
  }, [load]);
  useEffect(() => {
    if (!view?.signed || view.completed || !token) return;
    const t = setInterval(() => load(token).catch((e) => setError(message(e))), 4500);
    return () => clearInterval(t);
  }, [view?.signed, view?.completed, token, load]);
  function set(f: Field, v: Value) {
    setValues((old) => ({ ...old, [f.id]: v }));
  }
  function focus(f: Field) {
    setPage(f.page);
    document.getElementById('input-' + f.id)?.focus();
  }
  async function submit() {
    if (!view) return;
    setBusy(true);
    setError('');
    try {
      await request('/recipient/sign', token, 'POST', {
        values,
        consent,
        intent,
        consentVersion: view.consentVersion,
      });
      setView({ ...view, signed: true });
      await load(token);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function decline() {
    setBusy(true);
    setError('');
    try {
      await request('/recipient/decline', token, 'POST', { reason });
      setDeclined(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(k: string) {
    try {
      await saveCopy(
        '/recipient/files/' + k,
        token,
        'LumoDossier-' + k + (k === 'record' ? '.json' : '.pdf'),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="sign-site">
      <header className="site-header">
        <div className="container nav-inner">
          <Brand />
          <div className="sign-header-actions">
            <span className="inline">
              <LockKeyhole size={16} />
              Private signing room
            </span>
            <MotionControl />
          </div>
        </div>
      </header>
      <main id="main" className="container signing">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {declined ? (
          <div className="result panel">
            <h1>Request declined.</h1>
            <p>Your response has been recorded for the sender.</p>
          </div>
        ) : !view ? (
          <div className="result panel">
            <LockKeyhole size={30} />
            <h1>{error ? 'Signing link unavailable' : 'Opening your document…'}</h1>
          </div>
        ) : view.signed ? (
          <section className="result panel">
            <CheckCircle2 size={40} />
            <h1>{view.completed ? 'Your copy is ready.' : 'Your signature is recorded.'}</h1>
            <p>{view.title}</p>
            <p>
              {view.completed
                ? 'Everyone has signed. Download the signed document and its completion record.'
                : 'Keep this private link to access the completed document when it is ready.'}
            </p>
            {view.completed && (
              <div className="actions">
                <button className="button" onClick={() => download('completed')}>
                  <Download size={16} />
                  Download signed PDF
                </button>
                <button className="button outline" onClick={() => download('record')}>
                  Completion record
                </button>
              </div>
            )}
          </section>
        ) : (
          <>
            <div className="workspace-head">
              <div>
                <div className="eyebrow">
                  <PenLine size={15} />
                  Signature request
                </div>
                <h1>{view.title}</h1>
                <p>
                  Sent by {view.senderName} · {view.senderEmail}
                </p>
              </div>
            </div>
            <div className="editor-layout signer-layout">
              <PdfPage
                path="/recipient/files/original"
                token={token}
                pages={view.pages}
                page={page}
                onPage={setPage}
              >
                {view.fields
                  .filter((f) => f.page === page)
                  .map((f) => (
                    <button
                      key={f.id}
                      className="sign-field"
                      onClick={() => focus(f)}
                      style={{
                        left: f.x * 100 + '%',
                        top: f.y * 100 + '%',
                        width: f.w * 100 + '%',
                        height: f.h * 100 + '%',
                      }}
                    >
                      {typeof values[f.id] === 'string' ? (
                        String(values[f.id])
                      ) : values[f.id] ? (
                        <Check size={14} />
                      ) : (
                        f.label
                      )}
                    </button>
                  ))}
              </PdfPage>
              <aside className="tool-panel signer-fields">
                <h2>Your fields</h2>
                <p className="hint">
                  {view.recipient.name} · {view.recipient.email}
                </p>
                {view.fields.map((f) => (
                  <div className="value-field" key={f.id}>
                    <label htmlFor={'input-' + f.id}>
                      {f.label}
                      {f.required ? ' *' : ''} <small>Page {f.page + 1}</small>
                    </label>
                    {['signature', 'initials'].includes(f.type) && (
                      <div className="segmented">
                        {['Type', 'Draw'].map((v, i) => (
                          <button
                            key={v}
                            aria-pressed={!!draw[f.id] === !!i}
                            onClick={() => {
                              setDraw({ ...draw, [f.id]: !!i });
                              set(f, i ? { strokes: [] } : '');
                              setPage(f.page);
                            }}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    )}
                    {draw[f.id] ? (
                      <DrawSignature
                        strokes={
                          typeof values[f.id] === 'object'
                            ? (values[f.id] as { strokes: number[][][] }).strokes
                            : []
                        }
                        onChange={(strokes) => set(f, { strokes })}
                      />
                    ) : f.type === 'checkbox' ? (
                      <input
                        id={'input-' + f.id}
                        type="checkbox"
                        checked={values[f.id] === true}
                        onChange={(e) => {
                          set(f, e.target.checked);
                          setPage(f.page);
                        }}
                      />
                    ) : (
                      <input
                        id={'input-' + f.id}
                        type={f.type === 'date' ? 'date' : 'text'}
                        placeholder={f.type === 'signature' ? 'Type your full name' : undefined}
                        maxLength={200}
                        value={typeof values[f.id] === 'string' ? String(values[f.id]) : ''}
                        className={['signature', 'initials'].includes(f.type) ? 'signature-input' : ''}
                        onFocus={() => setPage(f.page)}
                        onChange={(e) => set(f, e.target.value)}
                      />
                    )}
                  </div>
                ))}
                <p className="hint">* Required · Link expires {dateTime(view.expiresAt)}</p>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  {view.consent}
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={intent}
                    onChange={(e) => setIntent(e.target.checked)}
                  />
                  {view.intent}
                </label>
                <button className="button full" disabled={!consent || !intent || busy} onClick={submit}>
                  {busy ? 'Saving…' : 'Confirm and sign'}
                </button>
                {declining ? (
                  <div className="decline">
                    <label>
                      Reason (optional)
                      <textarea
                        maxLength={500}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <div className="actions">
                      <button className="button outline" disabled={busy} onClick={decline}>
                        Confirm decline
                      </button>
                      <button className="link-button" onClick={() => setDeclining(false)}>
                        Go back
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="link-button danger" onClick={() => setDeclining(true)}>
                    Decline request
                  </button>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
