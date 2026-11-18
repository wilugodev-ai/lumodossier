'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { authClient } from '../lib/client';
import { isIdle } from '../lib/activity';

export function HomeActions() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    // The recovery dialog must receive the Auth callback on page load.
    if (new URLSearchParams(location.search).get('account') === 'reset') return;
    let active = true;
    try {
      const client = authClient(),
        sub = client.auth.onAuthStateChange((_event, session) => {
          if (active) setSignedIn(Boolean(session && !isIdle(session.user.id)));
        });
      return () => {
        active = false;
        sub.data.subscription.unsubscribe();
      };
    } catch {
      /* The public website is also available before Auth is configured. */
    }
  }, []);
  return (
    <div className="nav-actions">
      {signedIn ? (
        <Link className="button small-btn" href="/dashboard">
          Open workspace
        </Link>
      ) : (
        <>
          <Link className="text-link" href="/?account=signin">
            Sign in
          </Link>
          <Link className="button small-btn" href="/?account=signup">
            Get started
          </Link>
        </>
      )}
    </div>
  );
}
