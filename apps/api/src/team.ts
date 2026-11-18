import { randomBytes, randomUUID } from 'node:crypto';
import { one } from './db';
import type { TeamInvitation, TeamMember, InviteRole } from './crm-team';
import { type Identity, ensure } from './model';
import { digest } from './providers';
import { Repository } from './repository';

export class Team extends Repository {
  private connected() {
    const crm = this.services.crm?.team;
    ensure(crm, 503, 'Team access for this connected workspace is unavailable.');
    return crm;
  }
  async list(who: Identity, w: string) {
    return this.inSpace(who, w, false, async (tx, space) => {
      const canManage = space.role === 'owner';
      if (space.source === 'touchlumo')
        return { ...(await this.connected().list(who, w, canManage)), canManage };
      const members = (
        await tx.query<TeamMember>(
          "select user_id,email,display_name,role from lumo.members where workspace_id=$1 order by (role='owner') desc,joined_at,user_id",
          [w],
        )
      ).rows;
      const invitations = canManage
        ? (
            await tx.query<TeamInvitation>(
              'select id,email,role,created_at,expires_at,accepted_at,revoked_at from lumo.team_invitations where workspace_id=$1 order by created_at desc',
              [w],
            )
          ).rows
        : [];
      return { members, invitations, canManage };
    });
  }
  async invite(who: Identity, w: string, email: string, role: InviteRole) {
    const token = randomBytes(32).toString('base64url'),
      hash = digest(token);
    return this.inSpace(who, w, true, async (tx, space) => {
      ensure(space.role === 'owner', 403, 'Only workspace owners can invite teammates.');
      let inviteId;
      if (space.source === 'touchlumo')
        inviteId = await this.connected().invite(who, w, email, role, hash);
      else {
        const enrolled = await one(
          tx,
          'select 1 from lumo.members where workspace_id=$1 and lower(email)=$2',
          [w, email],
        );
        ensure(!enrolled, 409, 'This person is already a workspace member.');
        const result = await one<{ id: string }>(
          tx,
          `insert into lumo.team_invitations(id,workspace_id,email,role,token_hash,created_by,expires_at)
    values($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '7 days')
    on conflict(workspace_id,email) do update set role=excluded.role,token_hash=excluded.token_hash,created_by=excluded.created_by,
    created_at=clock_timestamp(),expires_at=excluded.expires_at,accepted_at=null,revoked_at=null returning id`,
          [randomUUID(), w, email, role, hash, who.id],
        );
        inviteId = result!.id;
      }
      return {
        id: inviteId,
        url:
          this.services.webOrigin +
          '/?account=join#' +
          (space.source === 'touchlumo' ? 'crm.' : 'team.') +
          token,
      };
    });
  }
  async revoke(who: Identity, w: string, id: string) {
    return this.inSpace(who, w, true, async (tx, space) => {
      ensure(space.role === 'owner', 403, 'Only workspace owners can revoke invitations.');
      if (space.source === 'touchlumo') await this.connected().revoke(who, w, id);
      else {
        const found = await one(
          tx,
          'update lumo.team_invitations set revoked_at=coalesce(revoked_at,clock_timestamp()) where workspace_id=$1 and id=$2 and accepted_at is null returning id',
          [w, id],
        );
        ensure(found, 404, 'Pending invitation not found.');
      }
      return { revoked: true };
    });
  }
  async change(who: Identity, w: string, user: string, role: InviteRole | null) {
    return this.inSpace(who, w, true, async (tx, space) => {
      ensure(space.role === 'owner', 403, 'Only workspace owners can manage the team.');
      if (space.source === 'touchlumo') await this.connected().update(who, w, user, role);
      else {
        const target = await one(
          tx,
          'select role from lumo.members where workspace_id=$1 and user_id=$2 for update',
          [w, user],
        );
        ensure(target, 404, 'Team member not found.');
        ensure(target.role !== 'owner', 409, 'Owner access is protected.');
        if (role)
          await tx.query('update lumo.members set role=$3 where workspace_id=$1 and user_id=$2', [
            w,
            user,
            role,
          ]);
        else await tx.query('delete from lumo.members where workspace_id=$1 and user_id=$2', [w, user]);
      }
      return { updated: true };
    });
  }
  async accept(who: Identity, source: 'team' | 'crm', token: string) {
    const hash = digest(token);
    if (source === 'crm') return { workspace: await this.connected().accept(who, hash) };
    return this.system(async (tx) => {
      const r = await one<{ id: string; workspace_id: string; email: string; role: InviteRole }>(
        tx,
        `select id,workspace_id,email,role from lumo.team_invitations
    where token_hash=$1 and accepted_at is null and revoked_at is null and expires_at>clock_timestamp() for update`,
        [hash],
      );
      ensure(
        r && r.email === who.email.trim().toLowerCase(),
        403,
        'The invitation has closed or belongs to a different verified email.',
      );
      await tx.query(
        'insert into lumo.members(workspace_id,user_id,role,email,display_name) values($1,$2,$3,$4,$5) on conflict(workspace_id,user_id) do nothing',
        [r.workspace_id, who.id, r.role, r.email, who.name],
      );
      await tx.query('update lumo.team_invitations set accepted_at=clock_timestamp() where id=$1', [
        r.id,
      ]);
      return { workspace: r.workspace_id };
    });
  }
}
