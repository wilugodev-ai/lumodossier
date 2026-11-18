import { randomUUID } from 'node:crypto';
import { Database, Sql, one, scope } from './db';
import { DocumentRow, Identity, Refs, Space, ensure } from './model';
import { Services, digest, tokenFor } from './providers';
import { sha256 } from './pdf';

export async function audit(tx: Sql, request: string, kind: string, actor: string, detail: object = {}) {
  await tx.query('insert into lumo.events(request_id,kind,actor,detail) values($1,$2,$3,$4)', [
    request,
    kind,
    actor,
    JSON.stringify(detail),
  ]);
}
export async function job(
  tx: Sql,
  request: string,
  kind: string,
  key: string,
  payload: object = {},
  when?: Date,
) {
  await tx.query(
    'insert into lumo.jobs(id,request_id,kind,dedupe_key,payload,available_at) values($1,$2,$3,$4,$5,coalesce($6,now())) on conflict(dedupe_key) do nothing',
    [randomUUID(), request, kind, key, JSON.stringify(payload), when ?? null],
  );
}
export async function locked(tx: Sql, id: string, workspace?: string) {
  const r = await one<DocumentRow>(
    tx,
    'select * from lumo.requests where id=$1 and ($2::uuid is null or workspace_id=$2) for update',
    [id, workspace ?? null],
  );
  ensure(r, 404, 'Document not found.');
  return r;
}
export function openRequest(r: DocumentRow) {
  ensure(
    r.sent_at && !r.cancelled_at && !r.declined_at && !r.expired_at && !r.completed_at && !r.sealed_at,
    409,
    'This request is closed.',
  );
}
export async function openForSigning(tx: Sql, r: DocumentRow) {
  openRequest(r);
  const a = await one(tx, 'select $1::timestamptz > clock_timestamp() as valid', [r.expires_at]);
  ensure(a?.valid, 410, 'This request has expired.');
}
export async function stage(
  tx: Sql,
  r: { id: string; workspace_id: string; version_id: string },
  kind: 'original' | 'completed',
  bytes: Buffer,
) {
  const key = [r.workspace_id, r.id, r.version_id, kind + '.pdf'].join('/');
  await tx.query(
    'insert into lumo.files(request_id,kind,object_key,hash,staged) values($1,$2,$3,$4,$5) on conflict(request_id,kind) do nothing',
    [r.id, kind, key, sha256(bytes), bytes],
  );
}
export async function readFile(db: Database, services: Services, id: string, kind: string) {
  const file = await db.tx(async (tx) => {
    await scope(tx);
    return one<{ object_key: string; hash: string; staged: Uint8Array | null }>(
      tx,
      'select object_key,hash,staged from lumo.files where request_id=$1 and kind=$2',
      [id, kind],
    );
  });
  ensure(file, 404, 'This file is not available yet.');
  const bytes = file.staged ? Buffer.from(file.staged) : await services.objects.get(file.object_key);
  ensure(sha256(bytes) === file.hash, 503, 'File integrity check failed.');
  return bytes;
}
export async function invitation(
  tx: Sql,
  s: Services,
  r: DocumentRow,
  person: string,
  purpose: 'sign' | 'copy',
) {
  const key = randomUUID(),
    token = tokenFor(key, s.secret);
  const record = await one<{ expires_at: Date }>(
    tx,
    `insert into lumo.invitations(id,request_id,person_id,token_hash,purpose,expires_at)
    values($1,$2,$3,$4,$5,case when $5='copy' then now()+interval '30 days' else $6 end) returning expires_at`,
    [key, r.id, person, digest(token), purpose, r.expires_at],
  );
  return { id: key, url: s.webOrigin + '/sign#' + token, expiresAt: record!.expires_at };
}
export async function queueEmail(
  tx: Sql,
  s: Services,
  r: DocumentRow,
  kind: string,
  to: string,
  person?: string,
  invite?: string,
) {
  const id = randomUUID();
  await tx.query(
    'insert into lumo.deliveries(id,request_id,kind,destination,person_id,invitation_id,status) values($1,$2,$3,$4,$5,$6,$7)',
    [id, r.id, kind, to, person ?? null, invite ?? null, s.mail.enabled ? 'queued' : 'unavailable'],
  );
  if (s.mail.enabled) await job(tx, r.id, 'email', 'email/' + id, { delivery: id });
}
export async function invitePerson(
  tx: Sql,
  s: Services,
  r: DocumentRow,
  person: { id: string; email: string },
  kind = 'invitation',
) {
  const link = await invitation(tx, s, r, person.id, kind === 'completion' ? 'copy' : 'sign');
  await queueEmail(tx, s, r, kind, person.email, person.id, link.id);
  return link;
}
export async function assertTurn(tx: Sql, r: DocumentRow, ordinal: number) {
  if (r.routing === 'sequential') {
    const prior = await one(
      tx,
      'select 1 from lumo.people where request_id=$1 and ordinal<$2 and signed_at is null limit 1',
      [r.id, ordinal],
    );
    ensure(!prior, 409, 'A previous recipient must sign first.');
  }
}
export class Repository {
  constructor(
    readonly db: Database,
    readonly services: Services,
  ) {}
  async system<T>(work: (tx: Sql) => Promise<T>) {
    return this.db.tx(async (tx) => {
      await scope(tx);
      return work(tx);
    });
  }
  async spaces(who: Identity): Promise<Space[]> {
    const local = await this.system(
      async (tx) =>
        (
          await tx.query<Space>(
            "select w.*,m.role from lumo.workspaces w join lumo.members m on m.workspace_id=w.id where m.user_id=$1 and w.source='standalone' order by w.name",
            [who.id],
          )
        ).rows,
    );
    return [...local, ...((await this.services.crm?.spaces(who)) ?? [])];
  }
  async createSpace(who: Identity, name: string) {
    return this.system(async (tx) => {
      const key = randomUUID();
      await tx.query("insert into lumo.workspaces values($1,$2,'standalone')", [key, name]);
      await tx.query("insert into lumo.members values($1,$2,'owner')", [key, who.id]);
      return { id: key, name, role: 'owner', source: 'standalone' };
    });
  }
  async inSpace<T>(
    who: Identity,
    id: string,
    write: boolean,
    work: (tx: Sql, space: Space) => Promise<T>,
  ) {
    return this.db.tx(async (tx) => {
      await scope(tx, id);
      let space = await one<Space>(
        tx,
        "select w.*,m.role from lumo.workspaces w join lumo.members m on w.id=m.workspace_id where w.id=$1 and m.user_id=$2 and w.source='standalone' for share of m",
        [id, who.id],
      );
      if (!space && this.services.crm) {
        space = (await this.services.crm.spaces(who)).find((w) => w.id === id);
        if (space) {
          const row = await one(
            tx,
            "insert into lumo.workspaces values($1,$2,'touchlumo') on conflict(id) do update set name=excluded.name where lumo.workspaces.source='touchlumo' returning id",
            [id, space.name],
          );
          ensure(row, 409, 'Workspace identity conflict.');
        }
      }
      ensure(space, 404, 'Workspace not found.');
      ensure(
        !write || ['owner', 'member'].includes(space.role),
        403,
        'This workspace grants you read-only access.',
      );
      return work(tx, space);
    });
  }
  async refs(who: Identity, w: Space, refs: Refs) {
    if (!Object.keys(refs).length) return null;
    ensure(
      w.source === 'touchlumo' && this.services.crm,
      400,
      'These references require a connected CRM workspace.',
    );
    return this.services.crm.resolve(who, w.id, refs);
  }
  async limit(key: string, max: number) {
    const ok = await this.system(async (tx) =>
      one<{ hits: number }>(
        tx,
        `insert into lumo.rate_windows(bucket,started_at,hits) values($1,date_trunc('minute',now()),1)
      on conflict(bucket) do update set hits=case when lumo.rate_windows.started_at=excluded.started_at then lumo.rate_windows.hits+1 else 1 end,started_at=excluded.started_at returning hits`,
        [digest(this.services.secret + key)],
      ),
    );
    ensure(ok && ok.hits <= max, 429, 'Too many attempts. Try again in a minute.');
  }
}
