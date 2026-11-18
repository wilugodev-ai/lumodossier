'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LockKeyhole, Users, X } from 'lucide-react';
import { authClient, message, sender } from '../lib/client';
import { AuthForm } from './AuthForm';
import { PasswordForm } from './Password';

function JoinTeam() {
  const [email, setEmail] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ source: string; token: string } | null>(null);
  useEffect(() => {
    let active = true;
    const match = /^#(crm|team)\.([\w-]{43})$/.exec(location.hash);
    if (!match) {
      setError('Open the complete invitation link shared by your workspace owner.');
      setReady(true);
      return;
    }
    setInvite({ source: match[1], token: match[2] });
    (async () => {
      const result = await authClient().auth.getSession();
      if (result.error) throw result.error;
      if (active) setEmail(result.data.session?.user.email ?? null);
    })()
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  async function accept() {
    setBusy(true);
    setError('');
    try {
      const result = await sender<{ workspace: string }>('/team/accept', 'POST', invite);
      location.replace('/dashboard?workspace=' + encodeURIComponent(result.workspace) + '&view=team');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (ready && invite && !email && !error) return <AuthForm onSuccess={setEmail} />;
  return (
    <div className="auth-card">
      <span className="eyebrow">
        <Users size={15} />
        Workspace access
      </span>
      <h2>Join your team</h2>
      {!ready && <p role="status">Opening invitation…</p>}
      {email && (
        <p>
          Accept this invitation using your verified account <strong>{email}</strong>.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {email && (
        <>
          <button className="button full" disabled={busy} onClick={accept}>
            {busy ? 'Joining…' : 'Accept invitation'}
          </button>
          <button
            type="button"
            className="link-button change-account"
            onClick={async () => {
              try {
                const { error } = await authClient().auth.signOut({ scope: 'local' });
                if (error) throw error;
                setEmail(null);
                setError('');
              } catch (e) {
                setError(message(e));
              }
            }}
          >
            Use another account
          </button>
        </>
      )}
    </div>
  );
}
function Recovery() {
  const [email, setEmail] = useState(''),
    [status, setStatus] = useState('Checking your password reset link…');
  useEffect(() => {
    let active = true,
      unsubscribe: (() => void) | undefined;
    try {
      const client = authClient(),
        sub = client.auth.onAuthStateChange((event, session) => {
          if (active && event === 'PASSWORD_RECOVERY' && session?.user.email) {
            setEmail(session.user.email);
            setStatus('');
          }
        });
      unsubscribe = () => sub.data.subscription.unsubscribe();
      client.auth
        .getSession()
        .then(() => {
          if (active)
            setStatus('Open a fresh password reset link in the browser where you requested it.');
        })
        .catch((e) => {
          if (active) setStatus(message(e));
        });
    } catch (e) {
      setStatus(message(e));
    }
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);
  return (
    <div className="auth-card">
      <span className="eyebrow">
        <LockKeyhole size={15} />
        Account recovery
      </span>
      <h2>Set a new password</h2>
      {email ? (
        <PasswordForm recovery email={email} />
      ) : (
        <>
          <p role="status">{status}</p>
          <a className="link-button" href="/?account=signin">
            Return to sign in
          </a>
        </>
      )}
    </div>
  );
}
export function HomeAccount() {
  const query = useSearchParams(),
    router = useRouter(),
    ref = useRef<HTMLDialogElement>(null),
    mode = query.get('account') ?? '';
  const open = ['signin', 'signup', 'reset', 'join'].includes(mode);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const old = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      old?.focus({ preventScroll: true });
    };
  }, [open]);
  function close() {
    router.replace('/', { scroll: false });
  }
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className="account-dialog"
      aria-label="LumoDossier account"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <button
        className="icon-btn dialog-close"
        type="button"
        onClick={close}
        aria-label="Close account window"
      >
        <X size={18} />
      </button>
      {mode === 'join' ? (
        <JoinTeam />
      ) : mode === 'reset' ? (
        <Recovery />
      ) : (
        <AuthForm key={mode} initial={mode === 'signup' ? 'signup' : 'signin'} />
      )}
    </dialog>
  );
}
