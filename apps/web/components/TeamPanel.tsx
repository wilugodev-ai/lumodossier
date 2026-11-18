'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, Link2, ShieldCheck, Users } from 'lucide-react';
import { dateTime, message, sender } from '../lib/client';
import type { Workspace } from '../lib/types';
type Role = 'viewer' | 'member';
type Member = { user_id: string; email: string | null; display_name?: string; role: Role | 'owner' };
type Invitation = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
  revoked_at?: string | null;
};
type Directory = { canManage: boolean; members: Member[]; invitations: Invitation[] };
function inviteStatus(i: Invitation) {
  return i.revoked_at
    ? 'Revoked'
    : i.accepted_at
      ? 'Accepted'
      : Date.parse(i.expires_at) <= Date.now()
        ? 'Expired'
        : 'Pending';
}
function RoleOptions() {
  return (
    <>
      <option value="viewer">Viewer</option>
      <option value="member">Member</option>
    </>
  );
}
export function TeamPanel({ workspace }: { workspace: Workspace }) {
  const path = '/workspaces/' + workspace.id + '/team';
  const [data, setData] = useState<Directory | null>(null),
    [email, setEmail] = useState(''),
    [role, setRole] = useState<Role>('viewer'),
    [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [note, setNote] = useState(''),
    [remove, setRemove] = useState('');
  const refresh = useCallback(() => sender<Directory>(path), [path]);
  useEffect(() => {
    let live = true;
    refresh()
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  async function perform(action: () => Promise<void>) {
    setError('');
    setNote('');
    setBusy(true);
    try {
      await action();
      setData(await refresh());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function invite(address: string, permission: Role) {
    return perform(async () => {
      const result = await sender<{ url: string }>(path + '/invitations', 'POST', {
        email: address,
        role: permission,
      });
      setLink({ email: address, url: result.url });
      setEmail('');
      setNote('Invitation created. Share the private link with your teammate.');
    });
  }
  function create(e: FormEvent) {
    e.preventDefault();
    void invite(email, role);
  }
  function change(m: Member, next: Role | null) {
    return perform(async () => {
      await sender(path + '/members/' + m.user_id, 'PATCH', { role: next });
      setRemove('');
      setNote(next ? 'Workspace role updated.' : 'Workspace access removed.');
    });
  }
  return (
    <div className="team-view">
      <header className="workspace-head">
        <div>
          <span className="eyebrow">
            <Users size={15} />
            {workspace.name}
          </span>
          <h1>Team</h1>
          <p>Manage who can view and send documents in this workspace.</p>
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="link-button"
            disabled={busy}
            onClick={() => perform(async () => {})}
          >
            Try again
          </button>
        </div>
      )}
      {note && (
        <p className="notice" role="status">
          {note}
        </p>
      )}
      {!data && !error && <p role="status">Loading team…</p>}
      {data && (
        <>
          <section className="team-card">
            <h2>
              Members <span>{data.members.length}</span>
            </h2>
            <ul className="team-list">
              {data.members.map((m) => (
                <li key={m.user_id}>
                  <div className="person-label">
                    <strong>{m.display_name || m.email || 'Workspace member'}</strong>
                    {m.email && m.display_name && m.email !== m.display_name && <small>{m.email}</small>}
                  </div>
                  {data.canManage && m.role !== 'owner' ? (
                    <div className="team-controls">
                      <select
                        aria-label={'Role for ' + (m.email ?? m.user_id)}
                        disabled={busy}
                        value={m.role}
                        onChange={(e) => change(m, e.target.value as Role)}
                      >
                        <RoleOptions />
                      </select>
                      {remove === m.user_id ? (
                        <>
                          <button
                            className="link-button danger"
                            disabled={busy}
                            onClick={() => change(m, null)}
                          >
                            Confirm removal
                          </button>
                          <button className="link-button" onClick={() => setRemove('')}>
                            Keep member
                          </button>
                        </>
                      ) : (
                        <button
                          className="link-button danger"
                          disabled={busy}
                          onClick={() => setRemove(m.user_id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="team-role">
                      {m.role === 'owner' && <ShieldCheck size={15} />} {m.role}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {data.canManage && (
            <>
              <section className="team-card">
                <h2>Invite a teammate</h2>
                <p>Members can prepare and send documents. Viewers can read and download them.</p>
                <form className="team-invite" onSubmit={create}>
                  <label>
                    Teammate email
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      maxLength={254}
                    />
                  </label>
                  <label>
                    Workspace role
                    <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                      <RoleOptions />
                    </select>
                  </label>
                  <button className="button" disabled={busy}>
                    <Link2 size={16} />
                    Create invite link
                  </button>
                </form>
                <small>
                  Share the link yourself. It expires in seven days and requires the invited email.
                </small>
                {link && (
                  <div className="invite-result">
                    <label>
                      Private team invitation
                      <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
                    </label>
                    <div className="team-controls">
                      <button
                        className="link-button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(link.url);
                            setNote('Invitation copied.');
                          } catch {
                            setNote('Select and copy the private invitation link.');
                          }
                        }}
                      >
                        <Copy size={14} />
                        Copy link
                      </button>
                      <button className="link-button" onClick={() => setLink(null)}>
                        Hide invitation link
                      </button>
                    </div>
                  </div>
                )}
              </section>
              <section className="team-card">
                <h2>Invitations</h2>
                {!data.invitations.length ? (
                  <p>No invitations yet.</p>
                ) : (
                  <ul className="team-list">
                    {data.invitations.map((i) => (
                      <li key={i.id}>
                        <div className="person-label">
                          <strong>{i.email}</strong>
                          <small>
                            {inviteStatus(i)} · {i.role}
                            {inviteStatus(i) === 'Pending' ? ' · Expires ' + dateTime(i.expires_at) : ''}
                          </small>
                        </div>
                        {inviteStatus(i) !== 'Accepted' && (
                          <div className="team-controls">
                            <button
                              className="link-button"
                              disabled={busy}
                              onClick={() => invite(i.email, i.role)}
                            >
                              Reissue
                            </button>
                            {inviteStatus(i) === 'Pending' && (
                              <button
                                className="link-button danger"
                                disabled={busy}
                                onClick={() =>
                                  perform(async () => {
                                    await sender(path + '/invitations/' + i.id + '/revoke', 'POST', {});
                                    if (link?.email.toLowerCase() === i.email) setLink(null);
                                    setNote('Invitation revoked.');
                                  })
                                }
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
