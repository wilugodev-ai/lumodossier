'use client';
import { useRef, useState, type PointerEvent } from 'react';
import { Plus, Trash2, GripVertical, Check, MousePointer2 } from 'lucide-react';
import { PdfPage } from './PdfPage';
import { fieldNames, type Kind, type Field, type Draft, type Detail } from '../lib/types';
import { sender, message } from '../lib/client';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
type Selection = {
  id: string;
  startX: number;
  startY: number;
  original: Field;
  resizing: boolean;
  ww: number;
  hh: number;
};
export function Editor({ doc, path, done }: { doc: Detail; path: string; done: () => void }) {
  const [d, setD] = useState<Draft>({
      title: doc.title,
      recipients: doc.recipients,
      routing: doc.routing,
      fields: doc.fields,
      crm: doc.crm,
    }),
    [revision, setRevision] = useState(doc.revision),
    [step, setStep] = useState(0),
    [page, setPage] = useState(0);
  const [selected, setSelected] = useState(''),
    [person, setPerson] = useState(doc.recipients[0]?.id ?? ''),
    [kind, setKind] = useState<Kind>('signature'),
    [days, setDays] = useState(14),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(''),
    [error, setError] = useState('');
  const drag = useRef<Selection | null>(null),
    field = d.fields.find((f) => f.id === selected);
  function change(p: Partial<Draft>) {
    setD((old) => ({ ...old, ...p }));
    setNote('');
  }
  function edit(id: string, p: Partial<Field>) {
    setD((old) => ({ ...old, fields: old.fields.map((f) => (f.id === id ? { ...f, ...p } : f)) }));
    setNote('');
  }
  function addPerson() {
    const id = crypto.randomUUID();
    change({ recipients: [...d.recipients, { id, name: '', email: '' }] });
    if (!person) setPerson(id);
  }
  function updatePerson(id: string, k: 'name' | 'email', value: string) {
    change({ recipients: d.recipients.map((p) => (p.id === id ? { ...p, [k]: value } : p)) });
  }
  function addField() {
    if (!person) return;
    const id = crypto.randomUUID(),
      offset = (d.fields.filter((f) => f.page === page).length % 6) * 0.07;
    change({
      fields: [
        ...d.fields,
        {
          id,
          type: kind,
          personId: person,
          label: fieldNames[kind],
          required: true,
          page,
          x: 0.12,
          y: 0.18 + offset,
          w: kind === 'checkbox' ? 0.045 : 0.32,
          h: kind === 'checkbox' ? 0.035 : 0.065,
        },
      ],
    });
    setSelected(id);
  }
  function start(e: PointerEvent<HTMLElement>, f: Field, resizing: boolean) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(f.id);
    const bounds = e.currentTarget.closest('.paper-frame')!.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: f.id,
      startX: e.clientX,
      startY: e.clientY,
      original: f,
      resizing,
      ww: bounds.width,
      hh: bounds.height,
    };
  }
  function move(e: PointerEvent<HTMLElement>) {
    const s = drag.current;
    if (!s || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = (e.clientX - s.startX) / s.ww,
      dy = (e.clientY - s.startY) / s.hh,
      f = s.original;
    edit(
      s.id,
      s.resizing
        ? { w: clamp(f.w + dx, 0.025, 1 - f.x), h: clamp(f.h + dy, 0.015, 1 - f.y) }
        : { x: clamp(f.x + dx, 0, 1 - f.w), y: clamp(f.y + dy, 0, 1 - f.h) },
    );
  }
  async function save(next?: number, send = false) {
    setBusy(true);
    setError('');
    setNote('');
    try {
      if (
        next === 1 &&
        (!d.recipients.length ||
          d.recipients.some((p) => !p.name.trim() || !/^\S+@\S+\.\S+$/.test(p.email)))
      )
        throw Error('Add a name and email address for each recipient before placing fields.');
      const result = await sender<{ revision: number }>(path, 'PATCH', { ...d, revision });
      setRevision(result.revision);
      if (send) {
        await sender(path + '/send', 'POST', { revision: result.revision, days });
        done();
      } else {
        if (next !== undefined) setStep(next);
        setNote('Draft saved.');
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const activePerson = d.recipients.some((p) => p.id === person) ? person : (d.recipients[0]?.id ?? '');
  return (
    <>
      <div className="workspace-head">
        <div>
          <div className="eyebrow">Prepare a request</div>
          <h1>{d.title}</h1>
        </div>
        <button className="button outline" disabled={busy} onClick={() => save()}>
          Save draft
        </button>
      </div>
      <div className="steps" aria-label="Request preparation">
        {['Recipients', 'Place fields', 'Review & send'].map((v, i) => (
          <button
            key={v}
            className={step === i ? 'active' : ''}
            aria-current={step === i ? 'step' : undefined}
            onClick={() => (i < step ? setStep(i) : save(i))}
            disabled={busy || i > step + 1}
          >
            <span>{i < step ? <Check size={14} /> : i + 1}</span>
            {v}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="notice">
          {note}
        </p>
      )}
      {step === 0 && (
        <div className="form-panel">
          <h2>Recipients and routing</h2>
          <label>
            Document title
            <input maxLength={160} value={d.title} onChange={(e) => change({ title: e.target.value })} />
          </label>
          <label>
            Signing order
            <select
              value={d.routing}
              onChange={(e) => change({ routing: e.target.value as Draft['routing'] })}
            >
              <option value="sequential">In sequence, top to bottom</option>
              <option value="simultaneous">Everyone at the same time</option>
            </select>
          </label>
          {d.recipients.map((p, i) => (
            <div className="recipient-row" key={p.id}>
              <span className="ordinal">{i + 1}</span>
              <label>
                {p.signingRole ? p.signingRole + ' name' : 'Recipient name'}
                <input
                  aria-label={(p.signingRole || 'Recipient ' + (i + 1)) + ' name'}
                  value={p.name}
                  onChange={(e) => updatePerson(p.id, 'name', e.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                Email address
                <input
                  aria-label={(p.signingRole || 'Recipient ' + (i + 1)) + ' email'}
                  type="email"
                  value={p.email}
                  onChange={(e) => updatePerson(p.id, 'email', e.target.value)}
                  maxLength={254}
                />
              </label>
              <button
                className="icon-btn"
                aria-label={'Remove recipient ' + (i + 1)}
                onClick={() => {
                  const remaining = d.recipients.filter((v) => v.id !== p.id);
                  change({ recipients: remaining, fields: d.fields.filter((f) => f.personId !== p.id) });
                  if (person === p.id) setPerson(remaining[0]?.id ?? '');
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button className="button outline" onClick={addPerson}>
            <Plus size={16} />
            Add recipient
          </button>
          <div className="form-actions">
            <button className="button" disabled={busy} onClick={() => save(1)}>
              Continue to fields
            </button>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="editor-layout">
          <PdfPage path={path + '/files/original'} pages={doc.pages} page={page} onPage={setPage}>
            {d.fields
              .filter((f) => f.page === page)
              .map((f) => (
                <div
                  key={f.id}
                  className={
                    'placed field-color-' +
                    (d.recipients.findIndex((p) => p.id === f.personId) % 4) +
                    (selected === f.id ? ' selected' : '')
                  }
                  style={{
                    left: f.x * 100 + '%',
                    top: f.y * 100 + '%',
                    width: f.w * 100 + '%',
                    height: f.h * 100 + '%',
                  }}
                  onPointerMove={move}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                >
                  <button
                    className="field-text"
                    onPointerDown={(e) => start(e, f, false)}
                    onPointerMove={move}
                    onClick={() => setSelected(f.id)}
                    aria-label={'Select ' + f.label}
                  >
                    <GripVertical size={12} />
                    {f.label}
                  </button>
                  <button
                    className="resize"
                    aria-label={'Resize ' + f.label}
                    onPointerDown={(e) => start(e, f, true)}
                    onPointerMove={move}
                  />
                </div>
              ))}
          </PdfPage>
          <div className="tool-panel">
            <h2>Place fields</h2>
            <label>
              Assign to
              <select value={activePerson} onChange={(e) => setPerson(e.target.value)}>
                {d.recipients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Field type
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {Object.entries(fieldNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button className="button full" disabled={!activePerson} onClick={addField}>
              <Plus size={16} />
              Add field
            </button>
            {!!field && (
              <div className="field-options">
                <h3>Selected field</h3>
                <label>
                  Label
                  <input
                    maxLength={90}
                    value={field.label}
                    onChange={(e) => edit(field.id, { label: e.target.value })}
                  />
                </label>
                <label>
                  Field recipient
                  <select
                    value={field.personId}
                    onChange={(e) => edit(field.id, { personId: e.target.value })}
                  >
                    {d.recipients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => edit(field.id, { required: e.target.checked })}
                  />
                  Required
                </label>
                <details>
                  <summary>Position and size</summary>
                  <div className="coords">
                    {(['x', 'y', 'w', 'h'] as const).map((k, i) => (
                      <label key={k}>
                        {['Left', 'Top', 'Width', 'Height'][i]} (%)
                        <input
                          aria-label={
                            ['Left percent', 'Top percent', 'Width percent', 'Height percent'][i]
                          }
                          type="number"
                          step=".1"
                          value={+(field[k] * 100).toFixed(2)}
                          onChange={(e) => {
                            const max =
                              k === 'x'
                                ? 1 - field.w
                                : k === 'y'
                                  ? 1 - field.h
                                  : k === 'w'
                                    ? 1 - field.x
                                    : 1 - field.y;
                            edit(field.id, {
                              [k]: clamp(
                                +e.target.value / 100,
                                k === 'w' ? 0.025 : k === 'h' ? 0.015 : 0,
                                max,
                              ),
                            });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                </details>
                <button
                  className="link-button danger"
                  onClick={() => {
                    change({ fields: d.fields.filter((f) => f.id !== field.id) });
                    setSelected('');
                  }}
                >
                  <Trash2 size={15} />
                  Remove field
                </button>
              </div>
            )}
            <p className="hint">
              <MousePointer2 size={15} />
              Drag a field to position it. Use its corner to resize.
            </p>
            <button className="button outline full" disabled={busy} onClick={() => save(2)}>
              Review request
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="form-panel">
          <h2>Review your request</h2>
          <p>
            {doc.pages.length} page(s) · {d.fields.length} field(s) ·{' '}
            {d.routing === 'sequential' ? 'Sequential signing' : 'Simultaneous signing'}
          </p>
          {d.recipients.map((p, i) => (
            <div className="review-row" key={p.id}>
              <span className="ordinal">{i + 1}</span>
              <div>
                <strong>{p.name}</strong>
                <small>{p.email}</small>
              </div>
              <span>{d.fields.filter((f) => f.personId === p.id).length} fields</span>
            </div>
          ))}
          <label>
            Link lifetime
            <select value={days} onChange={(e) => setDays(+e.target.value)}>
              {[1, 7, 14, 30, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n} days
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            {doc.emailEnabled
              ? 'Eligible recipients will be queued for email invitations.'
              : 'Email is unavailable. After sending, create a private sharing link for each eligible recipient.'}{' '}
            Sending locks this document version.
          </p>
          <button className="button" disabled={busy} onClick={() => save(undefined, true)}>
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      )}
    </>
  );
}
