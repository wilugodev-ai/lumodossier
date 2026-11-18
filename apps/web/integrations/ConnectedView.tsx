'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { access, message, sender } from '../lib/client';
import { useSenderSession } from '../lib/use-sender-session';
import type { Refs, Workspace } from '../lib/types';
import { TouchlumoDocuments } from './TouchlumoDocuments';
export function ConnectedView() {
  const params = useSearchParams(),
    { user, error: sessionError } = useSenderSession(),
    id = params.get('workspace'),
    [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const w = (await sender<Workspace[]>('/workspaces')).find(
        (w) => w.source === 'touchlumo' && w.id === id,
      );
      if (!w) throw Error('Open a connected Touchlumo workspace to see its signature requests.');
      if (active) setWorkspace(w);
    })().catch((e) => {
      if (active) setError(message(e));
    });
    return () => {
      active = false;
    };
  }, [id, user]);
  const crm: Refs = {};
  for (const k of ['customer', 'quote', 'deal'] as const) {
    const v = params.get(k);
    if (v) crm[k] = v;
  }
  if (error || sessionError)
    return (
      <p role="alert" className="notice error">
        {error || sessionError}
      </p>
    );
  if (!workspace) return <p>Loading connected workspace…</p>;
  return (
    <TouchlumoDocuments
      key={workspace.id + JSON.stringify(crm)}
      workspaceId={workspace.id}
      role={workspace.role}
      crm={crm}
      apiOrigin={process.env.NEXT_PUBLIC_API_ORIGIN!}
      webOrigin={location.origin}
      getAccessToken={access}
    />
  );
}
