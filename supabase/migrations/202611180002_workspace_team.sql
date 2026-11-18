alter table lumo.members
  add column email text,
  add column display_name text not null default '',
  add column joined_at timestamptz not null default now();
create index members_address on lumo.members(workspace_id, lower(email));
drop policy internal on lumo.members;
create policy scoped on lumo.members to lumo_service
  using(lumo.within_space(workspace_id)) with check(lumo.within_space(workspace_id));
grant delete on lumo.members to lumo_service;

-- Populate existing memberships when applying the signing schema to Supabase.
-- Other PostgreSQL environments refresh these fields on the member's next sign-in.
do $$ begin
  if to_regclass('auth.users') is not null then
    execute 'update lumo.members m set email=lower(u.email),
      display_name=coalesce(nullif(u.raw_user_meta_data->>''full_name'',''''),u.email,'''')
      from auth.users u where u.id=m.user_id and m.email is null';
  end if;
end $$;

create table lumo.team_invitations (
  id uuid primary key,
  workspace_id uuid not null references lumo.workspaces,
  email text not null check(email=lower(trim(email))),
  role text not null check(role in ('member','viewer')),
  token_hash char(64) not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz, revoked_at timestamptz,
  unique(workspace_id,email)
);
alter table lumo.team_invitations enable row level security;
create policy scoped on lumo.team_invitations to lumo_service
  using(lumo.within_space(workspace_id)) with check(lumo.within_space(workspace_id));
grant select,insert,update on lumo.team_invitations to lumo_service;
