import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isIdle } from './activity';
let instance: SupabaseClient | undefined;
export function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error('Account sign-in is unavailable for this workspace. Please try again after setup.');
  return (instance ??= createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } }));
}
export async function access() {
  const { data, error } = await authClient().auth.getSession();
  if (error || !data.session) throw new Error('Sign in to open your workspace.');
  if (isIdle(data.session.user.id)) {
    await expireSession();
    throw new Error('Your session ended after 30 minutes of inactivity.');
  }
  return data.session.access_token;
}
let leaving = false;
export function isLeaving() {
  return leaving;
}
export async function signOut(idle = false) {
  if (leaving) return;
  leaving = true;
  try {
    const { error } = await authClient().auth.signOut({ scope: 'local' });
    if (error && !idle) throw error;
    location.replace(idle ? '/?account=signin&idle=1' : '/');
  } finally {
    leaving = false;
  }
}
export async function expireSession() {
  await signOut(true);
}
export async function request(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
  headers?: HeadersInit,
) {
  const origin = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (!origin) throw new Error('The document service is unavailable for this workspace.');
  const file = typeof Blob !== 'undefined' && body instanceof Blob;
  const res = await fetch(origin.replace(/\/$/, '') + '/v1' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(body !== undefined ? { 'Content-Type': file ? 'application/pdf' : 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : file ? (body as Blob) : JSON.stringify(body),
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || 'The request could not be completed.');
  }
  return res;
}
export async function sender<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers?: HeadersInit,
): Promise<T> {
  return (await request(path, await access(), method, body, headers)).json();
}
export async function saveCopy(path: string, token: string, filename: string) {
  const file = await (await request(path, token)).blob(),
    url = URL.createObjectURL(file),
    a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function message(e: unknown) {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}
export function dateTime(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
}
