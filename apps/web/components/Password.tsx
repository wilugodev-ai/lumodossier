'use client';
import { useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { authClient, message } from '../lib/client';
import { recordActivity } from '../lib/activity';

export function PasswordField({
  label,
  name,
  existing = false,
}: {
  label: string;
  name: string;
  existing?: boolean;
}) {
  const id = useId(),
    [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          name={name}
          autoComplete={existing ? 'current-password' : 'new-password'}
          minLength={existing ? 1 : 8}
          required
        />
        <button
          type="button"
          aria-label={(visible ? 'Hide ' : 'Show ') + label.toLowerCase()}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
export function PasswordForm({ email, recovery = false }: { email: string; recovery?: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      password = String(data.get('newPassword'));
    setError('');
    setDone(false);
    if (password !== data.get('confirmPassword')) {
      setError('The new passwords must match.');
      return;
    }
    setBusy(true);
    try {
      const client = authClient();
      if (!recovery) {
        const check = await client.auth.signInWithPassword({
          email,
          password: String(data.get('currentPassword')),
        });
        if (check.error) throw Error('Your current password could not be verified.');
      }
      const result = await client.auth.updateUser({ password });
      if (result.error || !result.data.user)
        throw result.error ?? Error('Sign in again to update your password.');
      recordActivity(result.data.user.id);
      form.reset();
      setDone(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      {!recovery && <PasswordField label="Current password" name="currentPassword" existing />}
      <PasswordField label="New password" name="newPassword" />
      <PasswordField label="Confirm new password" name="confirmPassword" />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="notice">
          Your password was updated. {recovery && <a href="/dashboard">Open your workspace</a>}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
