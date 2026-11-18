import { ensure, type Identity, Problem } from './model';

export type InviteRole = 'member' | 'viewer';
export type TeamMember = {
  user_id: string;
  email: string | null;
  display_name?: string;
  role: 'owner' | InviteRole;
};
export type TeamInvitation = {
  id: string;
  email: string;
  role: InviteRole;
  created_at: string | Date;
  expires_at: string | Date;
  accepted_at: string | Date | null;
  revoked_at?: string | Date | null;
};
export interface CrmTeam {
  list(
    who: Identity,
    w: string,
    owner: boolean,
  ): Promise<{ members: TeamMember[]; invitations: TeamInvitation[] }>;
  invite(who: Identity, w: string, email: string, role: InviteRole, hash: string): Promise<string>;
  revoke(who: Identity, w: string, id: string): Promise<void>;
  update(who: Identity, w: string, user: string, role: InviteRole | null): Promise<void>;
  accept(who: Identity, hash: string): Promise<string>;
}
// These are the existing Touchlumo RPCs. PostgREST evaluates the caller's CRM policies.
export function crmTeam(origin: string, key: string): CrmTeam {
  async function call<T>(who: Identity, path: string, method = 'GET', body?: object): Promise<T> {
    const res = await fetch(origin + '/rest/v1/' + path, {
      method,
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + who.token,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok)
      throw new Problem(
        res.status >= 500 ? 503 : 403,
        'Touchlumo could not authorize this team action.',
      );
    const text = await res.text();
    return JSON.parse(text || 'null') as T;
  }
  return {
    async list(who, w, owner) {
      const members = await call<TeamMember[]>(who, 'rpc/list_members', 'POST', { target: w });
      const query = new URLSearchParams({
        workspace_id: 'eq.' + w,
        select: 'id,email,role,created_at,expires_at,accepted_at',
        order: 'created_at.desc',
      });
      const invitations = owner ? await call<TeamInvitation[]>(who, 'workspace_invites?' + query) : [];
      return { members, invitations };
    },
    invite: (who, w, email, role, hash) =>
      call<string>(who, 'rpc/invite_member', 'POST', {
        target: w,
        invite_email: email,
        invite_role: role,
        invite_hash: hash,
      }),
    async revoke(who, w, id) {
      const params = new URLSearchParams({
        workspace_id: 'eq.' + w,
        id: 'eq.' + id,
        accepted_at: 'is.null',
        select: 'id',
      });
      const rows = await call<unknown[]>(who, 'workspace_invites?' + params, 'DELETE');
      ensure(rows.length, 404, 'Pending invitation not found.');
    },
    async update(who, w, user, role) {
      await call(who, 'rpc/manage_member', 'POST', { target: w, member_id: user, new_role: role });
    },
    accept: (who, hash) => call<string>(who, 'rpc/accept_invite', 'POST', { invite_hash: hash }),
  };
}
