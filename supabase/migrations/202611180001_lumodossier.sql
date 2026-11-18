-- Independent signing schema. No changes to CRM or auth tables.
create schema lumo;
revoke all on schema lumo from public;
do $$ begin
  if not exists (select from pg_roles where rolname='lumo_service') then
    create role lumo_service nologin;
  end if;
end $$;
grant lumo_service to current_user;
grant usage on schema lumo to lumo_service;

create table lumo.workspaces (
  id uuid primary key, name text not null,
  source text not null check (source in ('standalone','touchlumo'))
);
create table lumo.members (
  workspace_id uuid not null references lumo.workspaces, user_id uuid not null,
  role text not null check(role in ('owner','member','viewer')), primary key(workspace_id,user_id)
);
create index on lumo.members(user_id);
create table lumo.requests (
  id uuid primary key, workspace_id uuid not null references lumo.workspaces, version_id uuid unique not null,
  sender_id uuid not null, sender_email text not null, sender_name text not null,
  original_hash char(64) not null, completed_hash char(64), pages jsonb not null,
  title text not null, routing text not null check(routing in ('sequential','simultaneous')),
  recipients jsonb not null default '[]', fields jsonb not null default '[]', crm jsonb not null default '{}',
  revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  sent_at timestamptz, expires_at timestamptz, sealed_at timestamptz, completed_at timestamptz,
  cancelled_at timestamptz, expired_at timestamptz, declined_at timestamptz
);
create index on lumo.requests(workspace_id,created_at desc,id);
create table lumo.files (
  request_id uuid not null references lumo.requests, kind text not null check(kind in ('original','completed')),
  object_key text not null unique, hash char(64) not null, staged bytea, stored_at timestamptz,
  primary key(request_id,kind), check(staged is not null or stored_at is not null)
);
create table lumo.people (
  request_id uuid not null references lumo.requests, id uuid not null, ordinal integer not null,
  name text not null, email text not null, viewed_at timestamptz, signed_at timestamptz, declined_at timestamptz,
  primary key(request_id,id), unique(request_id,ordinal)
);
create table lumo.invitations (
  id uuid primary key, request_id uuid not null, person_id uuid not null, token_hash char(64) unique not null,
  purpose text not null check(purpose in ('sign','copy')), expires_at timestamptz not null, revoked_at timestamptz,
  foreign key(request_id,person_id) references lumo.people(request_id,id)
);
create index on lumo.invitations(request_id,person_id);
create table lumo.signatures (
  request_id uuid not null, person_id uuid not null, values jsonb not null, consent text not null,
  consent_version text not null, intent text not null, authentication text not null,
  created_at timestamptz not null default now(), primary key(request_id,person_id),
  foreign key(request_id,person_id) references lumo.people(request_id,id)
);
create table lumo.events (
  id bigint generated always as identity primary key, request_id uuid not null references lumo.requests,
  kind text not null, actor text not null, detail jsonb not null default '{}', occurred_at timestamptz not null default now()
);
create index on lumo.events(request_id,id);
create table lumo.deliveries (
  id uuid primary key, request_id uuid not null references lumo.requests, person_id uuid,
  invitation_id uuid references lumo.invitations, kind text not null, destination text not null,
  status text not null check(status in ('unavailable','queued','accepted','failed','superseded')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table lumo.delivery_attempts (
  id bigint generated always as identity primary key, delivery_id uuid not null references lumo.deliveries,
  outcome text not null check(outcome in ('accepted','failed')), occurred_at timestamptz not null default now()
);
create table lumo.jobs (
  id uuid primary key, dedupe_key text not null unique, kind text not null,
  request_id uuid not null references lumo.requests, payload jsonb not null default '{}',
  state text not null default 'ready' check(state in ('ready','running','done','failed')),
  attempts integer not null default 0, available_at timestamptz not null default now(),
  lease uuid, lease_until timestamptz, last_error text
);
create index on lumo.jobs(state,available_at,lease_until);
create table lumo.rate_windows (
  bucket char(64) primary key, started_at timestamptz not null, hits integer not null
);

create function lumo.within_space(target uuid) returns boolean language sql stable as $$
  select current_setting('lumo.system',true) = 'on' or current_setting('lumo.workspace',true) = target::text;
$$;
alter table lumo.requests enable row level security;
create policy scoped on lumo.requests to lumo_service
using(lumo.within_space(workspace_id)) with check(lumo.within_space(workspace_id));
do $$ declare t text; begin
  foreach t in array array['people','files','invitations','signatures','events','deliveries','jobs'] loop
    execute format('alter table lumo.%I enable row level security',t);
    execute format('create policy scoped on lumo.%I to lumo_service using(exists(select from lumo.requests r where r.id=request_id))',t);
  end loop;
  foreach t in array array['workspaces','members','delivery_attempts','rate_windows'] loop
    execute format('alter table lumo.%I enable row level security',t);
    execute format('create policy internal on lumo.%I to lumo_service using(true)',t);
  end loop;
end $$;
grant select,insert,update on lumo.workspaces,lumo.members,lumo.requests,lumo.people,lumo.files,
 lumo.invitations,lumo.deliveries,lumo.jobs,lumo.rate_windows to lumo_service;
grant delete on lumo.rate_windows to lumo_service;
grant select,insert on lumo.events,lumo.signatures,lumo.delivery_attempts to lumo_service;
grant usage,select on all sequences in schema lumo to lumo_service;

create function lumo.freeze_document() returns trigger language plpgsql as $$
begin
  if (new.workspace_id,new.version_id,new.original_hash,new.pages,new.sender_id,new.sender_email,new.sender_name)
    is distinct from (old.workspace_id,old.version_id,old.original_hash,old.pages,old.sender_id,old.sender_email,old.sender_name)
    or (old.sent_at is not null and (new.title,new.routing,new.fields,new.recipients,new.crm,new.sent_at,new.expires_at)
        is distinct from (old.title,old.routing,old.fields,old.recipients,old.crm,old.sent_at,old.expires_at))
  then raise exception 'Document version is frozen'; end if;
  return new;
end $$;
create trigger freeze_version before update on lumo.requests for each row execute function lumo.freeze_document();

create view lumo.overview with (security_invoker=true) as
select r.*, p.total, p.signed, case
  when r.completed_at is not null then 'completed'
  when r.cancelled_at is not null then 'cancelled'
  when r.declined_at is not null then 'declined'
  when r.expired_at is not null or (r.expires_at<=now() and r.sealed_at is null) then 'expired'
  when r.sent_at is null then 'draft'
  when p.signed>0 then 'partially_signed'
  when p.viewed>0 then 'viewed'
  else 'sent' end as status
from lumo.requests r cross join lateral
(select count(*)::int total,count(signed_at)::int signed,count(viewed_at)::int viewed from lumo.people where request_id=r.id) p;
grant select on lumo.overview to lumo_service;

