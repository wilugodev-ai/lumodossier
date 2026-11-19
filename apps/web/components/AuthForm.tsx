'use client';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { authClient, message } from '../lib/client';
import { recordActivity } from '../lib/activity';
import { PasswordField } from './Password';

export function AuthForm({
  initial = 'signin',
  onSuccess,
}: {
  initial?: 'signin' | 'signup';
  onSuccess?: (email: string) => void;
}) {
  const query = useSearchParams(),
    [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(initial),
    [error, setError] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false);
  const signup = mode === 'signup',
    forgot = mode === 'forgot';
  function change(next: typeof mode) {
    setMode(next);
    setError('');
    setNote('');
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      email = String(form.get('email')).trim(),
      password = String(form.get('password') ?? '');
    setBusy(true);
    setNote('');
    setError('');
    try {
      const client = authClient();
      if (forgot) {
        const result = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + '/?account=reset',
        });
        if (result.error) throw result.error;
        setNote(
          'If this email has an account, check its inbox for a password reset link. Open it in this browser.',
        );
        return;
      }
      const result = signup
        ? await client.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: String(form.get('name')).trim() },
              emailRedirectTo: location.origin + '/dashboard',
            },
          })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (!result.data.session) {
        setNote(
          onSuccess
            ? 'Confirm your email, then reopen your private team invitation.'
            : 'Check your email to confirm your LumoDossier account, then sign in.',
        );
        return;
      }
      recordActivity(result.data.session.user.id);
      if (onSuccess) {
        onSuccess(result.data.session.user.email ?? email);
        return;
      }
      const target = query.get('next') ?? '';
      location.assign(/^\/(?:dashboard|touchlumo)(?:\?|$)/.test(target) ? target : '/dashboard');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    !process.env.NEXT_PUBLIC_API_ORIGIN
  ) {
    return (
      <div className="auth-card">
        <LockKeyhole aria-hidden="true" size={22} />
        <h2>Workspace setup is in progress</h2>
        <p>Account access will open here when the signing service is connected.</p>
      </div>
    );
  }
  return (
    <div className="auth-card">
      <span className="eyebrow">
        <LockKeyhole size={15} />
        {onSuccess ? 'Team invitation' : 'Sender workspace'}
      </span>
      <h2>{forgot ? 'Reset your password' : signup ? 'Create an account' : 'Welcome back.'}</h2>
      <p>
        {forgot
          ? 'Enter the email address you use to sign in.'
          : onSuccess
            ? 'Use the email address on your invitation.'
            : signup
              ? 'Prepare and track signature requests in your own workspace.'
              : 'Sign in to your LumoDossier workspace.'}
      </p>
      {query.get('idle') === '1' && mode === 'signin' && (
        <p className="notice">Your session ended after 30 minutes of inactivity.</p>
      )}
      {process.env.NEXT_PUBLIC_LOCAL_PREVIEW === 'true' && (
        <p className="preview-note">
          Local preview. Use a disposable email and sample documents. Email delivery is disabled.
        </p>
      )}
      <form onSubmit={submit}>
        {signup && (
          <label>
            Full name
            <input name="name" autoComplete="name" maxLength={120} required />
          </label>
        )}
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" maxLength={254} required />
        </label>
        {!forgot && <PasswordField label="Password" name="password" existing={!signup} />}
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
        <button className="button full" disabled={busy}>
          {busy ? 'Please wait…' : forgot ? 'Send reset link' : signup ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <div className="account-links">
        <button
          type="button"
          className="link-button"
          onClick={() => change(signup || forgot ? 'signin' : 'signup')}
        >
          {signup || forgot ? 'Back to sign in' : 'Create an account'}
        </button>
        {mode === 'signin' && (
          <button type="button" className="link-button" onClick={() => change('forgot')}>
            Forgot password?
          </button>
        )}
      </div>
    </div>
  );
}
