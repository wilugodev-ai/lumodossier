import { redirect } from 'next/navigation';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const { mode, next } = await searchParams;
  const params = new URLSearchParams({ account: mode === 'signup' ? 'signup' : 'signin' });
  if (typeof next === 'string' && /^\/(?:dashboard|touchlumo)(?:\?|$)/.test(next))
    params.set('next', next);
  redirect('/?' + params);
}
