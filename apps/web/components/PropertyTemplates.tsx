'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ClipboardList,
  DoorOpen,
  FileText,
  Handshake,
  House,
  KeyRound,
} from 'lucide-react';
import { message, sender } from '../lib/client';
import type { Refs, Workspace } from '../lib/types';

type TemplateInput = {
  key: string;
  label: string;
  hint?: string;
  type?: 'text' | 'date' | 'money' | 'fee' | 'days';
  options?: string[];
  limit?: number;
  required?: boolean;
};
type Template = {
  id: string;
  title: string;
  description: string;
  group: string;
  guidance?: string;
  roles: string[];
  inputs: TemplateInput[];
};
const icons = {
  'property-showing-record': DoorOpen,
  'property-condition-report': ClipboardList,
  'key-handover-receipt': KeyRound,
  'fl-exclusive-right-of-sale': House,
  'fl-exclusive-agency-listing': House,
  'fl-open-listing': House,
  'fl-rental-listing': KeyRound,
  'fl-broker-referral': Handshake,
};

function Preview({ form }: { form: Template }) {
  return (
    <a
      className="template-preview"
      href={'/templates/' + form.id + '.pdf'}
      target="_blank"
      rel="noreferrer"
      aria-label={'Preview ' + form.title + ' PDF'}
    >
      Preview PDF <ArrowUpRight size={15} aria-hidden="true" />
    </a>
  );
}

export function PropertyTemplates({
  workspace,
  refs,
  open,
}: {
  workspace: Workspace;
  refs: Refs;
  open: (id: string) => void;
}) {
  const [forms, setForms] = useState<Template[] | null>(null);
  const [selected, setSelected] = useState<Template | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    sender<Template[]>('/templates/real-estate')
      .then((items) => {
        if (active) setForms(items);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [retry]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError('');
    setBusy(true);
    try {
      const draft = await sender<{ id: string }>(
        '/workspaces/' + workspace.id + '/templates/' + selected.id,
        'POST',
        { values, crm: refs },
      );
      open(draft.id);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (!forms)
    return error ? (
      <div className="notice error" role="alert">
        {error}{' '}
        <button className="button outline" onClick={() => setRetry(retry + 1)}>
          Try again
        </button>
      </div>
    ) : (
      <p role="status">Loading real estate templates…</p>
    );

  if (selected)
    return (
      <form className="form-panel property-template-form" onSubmit={create}>
        <button
          className="back"
          type="button"
          disabled={busy}
          onClick={() => {
            setSelected(null);
            setError('');
          }}
        >
          <ArrowLeft size={15} /> All templates
        </button>
        <div className="template-form-heading">
          <h2>{selected.title}</h2>
          <Preview form={selected} />
        </div>
        <p>
          {selected.guidance ||
            'Add the ' +
              selected.roles.map((role) => role.toLowerCase()).join(' and ') +
              ' on the next step.'}
        </p>
        {selected.guidance && (
          <p className="hint">
            Original LumoDossier agreement for your Florida broker or attorney to review before first
            use.
          </p>
        )}
        <div className="template-input-grid">
          {selected.inputs.map((field) => {
            const attributes = { name: field.key, required: field.required, 'aria-label': field.label };
            return (
              <label key={field.key} className={(field.limit ?? 0) >= 180 ? 'wide' : undefined}>
                <span>
                  {field.label}
                  {!field.required && <small> (optional)</small>}
                </span>
                {field.options ? (
                  <select {...attributes} defaultValue="">
                    <option value="" disabled>
                      Choose an option
                    </option>
                    {field.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : field.type === 'date' || (field.limit ?? 0) < 180 ? (
                  <input
                    {...attributes}
                    type={field.type === 'date' ? 'date' : 'text'}
                    inputMode={
                      field.type === 'days'
                        ? 'numeric'
                        : field.type === 'money' || field.type === 'fee'
                          ? 'decimal'
                          : undefined
                    }
                    maxLength={field.limit}
                    placeholder={field.hint}
                  />
                ) : (
                  <textarea {...attributes} rows={2} maxLength={field.limit} placeholder={field.hint} />
                )}
              </label>
            );
          })}
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? 'Creating draft…' : 'Create draft'}
        </button>
      </form>
    );

  return (
    <div className="template-groups">
      {Array.from(new Set(forms.map((form) => form.group || 'Property records'))).map((group) => (
        <section key={group} aria-label={group}>
          <h2>{group}</h2>
          <div className="property-template-grid">
            {forms
              .filter((form) => (form.group || 'Property records') === group)
              .map((form) => {
                const Icon = icons[form.id as keyof typeof icons] || FileText;
                return (
                  <article className="panel property-template-card" key={form.id}>
                    <Icon className="template-icon" size={25} aria-hidden="true" />
                    <h3>{form.title}</h3>
                    <p>{form.description}</p>
                    <div className="template-card-actions">
                      <button
                        className="button outline"
                        aria-label={'Use ' + form.title}
                        onClick={() => setSelected(form)}
                      >
                        Use template
                      </button>
                      <Preview form={form} />
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
