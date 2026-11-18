'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Signature } from 'lucide-react';
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
    <div className="home-actions">
      {signedIn ? (
        <Link className="button" href="/dashboard">
          Open workspace
        </Link>
      ) : (
        <>
          <Link className="button" href="/?account=signup" scroll={false}>
            <Signature size={18} aria-hidden="true" />
            Create account
          </Link>
          <Link className="button outline" href="/?account=signin" scroll={false}>
            Sign in
          </Link>
        </>
      )}
    </div>
  );
}
