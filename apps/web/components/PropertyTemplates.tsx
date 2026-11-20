'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowUpRight, ClipboardList, DoorOpen, FileText, KeyRound } from 'lucide-react';
import { message, sender } from '../lib/client';
import type { Refs, Workspace } from '../lib/types';

type TemplateInput = {
  key: string;
  label: string;
  hint?: string;
  type?: 'date';
  options?: string[];
  limit?: number;
  required?: boolean;
};
type Template = {
  id: string;
  title: string;
  description: string;
  roles: string[];
  inputs: TemplateInput[];
};
const icons = {
  'property-showing-record': DoorOpen,
  'property-condition-report': ClipboardList,
  'key-handover-receipt': KeyRound,
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
        <p>Add the {selected.roles.map((role) => role.toLowerCase()).join(' and ')} on the next step.</p>
        {selected.inputs.map((field) => {
          const attributes = { name: field.key, required: field.required, 'aria-label': field.label };
          return (
            <label key={field.key}>
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
                  type={field.type ?? 'text'}
                  maxLength={field.limit}
                  placeholder={field.hint}
                />
              ) : (
                <textarea {...attributes} rows={2} maxLength={field.limit} placeholder={field.hint} />
              )}
            </label>
          );
        })}
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
    <div className="property-template-grid">
      {forms.map((form) => {
        const Icon = icons[form.id as keyof typeof icons] || FileText;
        return (
          <article className="panel property-template-card" key={form.id}>
            <Icon className="template-icon" size={25} aria-hidden="true" />
            <h2>{form.title}</h2>
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
  );
}
