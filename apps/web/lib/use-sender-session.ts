'use client';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { authClient, expireSession, isLeaving, message } from './client';
import { isIdle, watchActivity } from './activity';

export function useSenderSession() {
  const [user, setUser] = useState<User | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      stop: undefined | (() => void),
      userId = '';
    let client: ReturnType<typeof authClient>;
    try {
      client = authClient();
    } catch (e) {
      setError(message(e));
      return;
    }
    function session(current: User | null) {
      if (!active) return;
      if (!current) {
        location.replace(
          '/?account=signin&next=' + encodeURIComponent(location.pathname + location.search),
        );
        return;
      }
      if (isIdle(current.id)) {
        void expireSession();
        return;
      }
      if (current.id !== userId) {
        stop?.();
        userId = current.id;
        stop = watchActivity(current.id, () => void expireSession());
      }
      setUser(current);
    }
    const subscription = client.auth.onAuthStateChange((event, value) => {
      if (event === 'SIGNED_OUT') {
        stop?.();
        if (active) {
          setUser(null);
          if (!isLeaving()) location.replace('/?account=signin');
        }
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') session(value?.user ?? null);
    }).data.subscription;
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        session(data.session?.user ?? null);
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
      stop?.();
      subscription.unsubscribe();
    };
  }, []);
  return { user, error };
}
