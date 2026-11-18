'use client';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { authClient, message } from '../lib/client';
import { LockKeyhole } from 'lucide-react';
export function AuthForm() {
  const query = useSearchParams(),
    [signup, setSignup] = useState(query.get('mode') === 'signup'),
    [error, setError] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false);
  const target = query.get('next') || '/dashboard';
  const next = /^\/(?:dashboard|touchlumo)(?:\?|$)/.test(target) ? target : '/dashboard';
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    const form = new FormData(e.currentTarget);
    try {
      const client = authClient(),
        email = String(form.get('email')).trim(),
        password = String(form.get('password'));
      if (signup) {
        const result = await client.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: String(form.get('name')).trim() },
            emailRedirectTo: location.origin + '/dashboard',
          },
        });
        if (result.error) throw result.error;
        if (!result.data.session) {
          setNote('Check your email to confirm your LumoDossier account, then sign in.');
          return;
        }
      } else {
        const result = await client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
      }
      location.assign(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-card">
      <span className="eyebrow">
        <LockKeyhole size={16} />
        Sender workspace
      </span>
      <h1>{signup ? 'Create an account' : 'Welcome back.'}</h1>
      <p>
        {signup
          ? 'Prepare and track signature requests in your own workspace.'
          : 'Sign in to your LumoDossier workspace.'}
      </p>
      {process.env.NEXT_PUBLIC_LOCAL_PREVIEW === 'true' && (
        <p className="notice">
          Local test workspace. Use a disposable email and sample documents. Email invitations use manual
          sharing.
        </p>
      )}
      <form onSubmit={submit}>
        {signup && (
          <label>
            Full name
            <input autoComplete="name" name="name" maxLength={120} required />
          </label>
        )}
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? 8 : 1}
            required
          />
        </label>
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
          {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="auth-switch">
        {signup ? 'Already have an account?' : 'New to LumoDossier?'}{' '}
        <button
          className="link-button"
          onClick={() => {
            setSignup(!signup);
            setError('');
            setNote('');
          }}
        >
          {signup ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </div>
  );
}
