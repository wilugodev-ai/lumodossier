import { randomUUID } from 'node:crypto';
import { one } from './db';
import { DocumentRow, Value, ensure } from './model';
import { completePdf, sha256 } from './pdf';
import { tokenFor } from './providers';
import { Repository, audit, invitePerson, locked, queueEmail, readFile, stage } from './repository';

type Job = {
  id: string;
  kind: string;
  request_id: string;
  lease: string;
  attempts: number;
  payload: { delivery?: string };
};
type Staged = { object_key: string; hash: string; staged: Uint8Array | null };
const MAX_TRIES = 7;
export class Worker extends Repository {
  async claim() {
    return this.system(async (tx) => {
      const exhausted = await tx.query<{ payload: { delivery?: string } }>(
        `update lumo.jobs set state='failed',lease=null,lease_until=null,last_error='Retry limit reached'
        where state='running' and lease_until<now() and attempts>=$1 returning payload`,
        [MAX_TRIES],
      );
      for (const row of exhausted.rows)
        if (row.payload.delivery)
          await tx.query(
            "update lumo.deliveries set status='failed',updated_at=now() where id=$1 and status='queued'",
            [row.payload.delivery],
          );
      return one<Job>(
        tx,
        `with candidate as (select id from lumo.jobs where ((state='ready' and available_at<=now())
        or (state='running' and lease_until<now())) and attempts<$2 order by available_at,id for update skip locked limit 1)
        update lumo.jobs j set state='running',lease=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1
        from candidate c where j.id=c.id returning j.*`,
        [randomUUID(), MAX_TRIES],
      );
    });
  }
  async runOne() {
    const j = await this.claim();
    if (!j) return false;
    try {
      if (j.kind === 'original') await this.flush(j.request_id, 'original');
      else if (j.kind === 'finish') await this.finish(j.request_id);
      else if (j.kind === 'email') await this.email(j);
      else if (j.kind === 'expire') await this.expire(j.request_id);
      else throw new Error('Unknown job type');
      await this.system((tx) =>
        tx.query(
          "update lumo.jobs set state='done',lease=null,lease_until=null where id=$1 and lease=$2",
          [j.id, j.lease],
        ),
      );
    } catch {
      await this.system(async (tx) => {
        const failed = j.attempts >= MAX_TRIES;
        const applied = await one(
          tx,
          `update lumo.jobs set state=$3,lease=null,lease_until=null,last_error=$4,
          available_at=now()+$5::int*interval '1 second' where id=$1 and lease=$2 returning id`,
          [
            j.id,
            j.lease,
            failed ? 'failed' : 'ready',
            'Processing attempt failed',
            Math.min(600, 5 * 2 ** (j.attempts - 1)),
          ],
        );
        if (applied && j.kind === 'email' && failed)
          await tx.query(
            "update lumo.deliveries set status='failed',updated_at=now() where id=$1 and status='queued'",
            [j.payload.delivery],
          );
      });
    }
    return true;
  }
  async drain(n = 100) {
    await this.system((tx) =>
      tx.query("delete from lumo.rate_windows where started_at<now()-interval '1 day'"),
    );
    let count = 0;
    while (count < n && (await this.runOne())) count++;
    return count;
  }
  async flush(id: string, kind: string) {
    const file = await this.system((tx) =>
      one<Staged>(tx, 'select object_key,hash,staged from lumo.files where request_id=$1 and kind=$2', [
        id,
        kind,
      ]),
    );
    ensure(file, 503, 'File staging is incomplete.');
    if (!file.staged) return;
    const bytes = Buffer.from(file.staged);
    ensure(sha256(bytes) === file.hash, 503, 'File integrity check failed.');
    await this.services.objects.put(file.object_key, bytes, file.hash);
    await this.system((tx) =>
      tx.query(
        'update lumo.files set staged=null,stored_at=coalesce(stored_at,now()) where request_id=$1 and kind=$2 and hash=$3',
        [id, kind, file.hash],
      ),
    );
  }
  async finish(id: string) {
    const input = await this.system(async (tx) => {
      const r = await locked(tx, id);
      if (r.completed_at) return;
      ensure(r.sealed_at, 409, 'Signatures are incomplete.');
      const rows = await tx.query<{ person_id: string; values: Record<string, Value> }>(
        'select person_id,values from lumo.signatures where request_id=$1',
        [id],
      );
      ensure(rows.rows.length === r.recipients.length, 409, 'Signatures are incomplete.');
      const byPerson = new Map(rows.rows.map((p) => [p.person_id, p.values]));
      const filled = r.fields.flatMap((f) => {
        const value = byPerson.get(f.personId)?.[f.id];
        return value === undefined ? [] : [{ ...f, value }];
      });
      const staged = await one(tx, "select 1 from lumo.files where request_id=$1 and kind='completed'", [
        id,
      ]);
      return { r, filled, staged };
    });
    if (!input) return;
    await this.flush(id, 'original');
    if (!input.staged) {
      const bytes = await completePdf(
        await readFile(this.db, this.services, id, 'original'),
        input.filled,
      );
      await this.system((tx) => stage(tx, input.r, 'completed', bytes));
    }
    await this.flush(id, 'completed');
    await this.system(async (tx) => {
      const r = await locked(tx, id);
      if (r.completed_at) return;
      const result = await one<{ hash: string }>(
        tx,
        "select hash from lumo.files where request_id=$1 and kind='completed' and stored_at is not null",
        [id],
      );
      ensure(result, 503, 'The completed PDF is being stored.');
      await tx.query(
        'update lumo.requests set completed_at=now(),updated_at=now(),completed_hash=$2 where id=$1',
        [id, result.hash],
      );
      await audit(tx, id, 'completed', 'LumoDossier', {
        version: r.version_id,
        originalSha256: r.original_hash,
        completedSha256: result.hash,
      });
      for (const p of r.recipients) await invitePerson(tx, this.services, r, p, 'completion');
      await queueEmail(tx, this.services, r, 'completion', r.sender_email);
    });
  }
  async expire(id: string) {
    await this.system(async (tx) => {
      const r = await locked(tx, id);
      if (r.sealed_at || r.cancelled_at || r.declined_at || r.completed_at || r.expired_at) return;
      const expired = await one(
        tx,
        'update lumo.requests set expired_at=now(),updated_at=now() where id=$1 and expires_at<=now() returning id',
        [id],
      );
      if (expired) {
        await tx.query(
          'update lumo.invitations set revoked_at=now() where request_id=$1 and revoked_at is null',
          [id],
        );
        await audit(tx, id, 'expired', 'LumoDossier');
      }
    });
  }
  async email(j: Job) {
    const message = await this.system(async (tx) => {
      const d = await one<{
        status: string;
        id: string;
        destination: string;
        invitation_id: string | null;
        person_id: string | null;
        kind: string;
      }>(tx, 'select * from lumo.deliveries where id=$1', [j.payload.delivery]);
      if (!d || d.status !== 'queued') return;
      if (!this.services.mail.enabled) {
        await tx.query("update lumo.deliveries set status='unavailable',updated_at=now() where id=$1", [
          d.id,
        ]);
        return;
      }
      const r = await one<DocumentRow>(tx, 'select * from lumo.requests where id=$1', [j.request_id]);
      ensure(r, 404, 'Document not found.');
      const live = d.invitation_id
        ? await one(
            tx,
            'select 1 from lumo.invitations where id=$1 and revoked_at is null and expires_at>now()',
            [d.invitation_id],
          )
        : true;
      const alreadySigned =
        d.person_id &&
        d.kind !== 'completion' &&
        (await one(
          tx,
          'select 1 from lumo.people where request_id=$1 and id=$2 and signed_at is not null',
          [r.id, d.person_id],
        ));
      if (
        !live ||
        alreadySigned ||
        r.cancelled_at ||
        r.declined_at ||
        r.expired_at ||
        (r.sealed_at && d.kind !== 'completion')
      ) {
        await tx.query("update lumo.deliveries set status='superseded',updated_at=now() where id=$1", [
          d.id,
        ]);
        return;
      }
      const url = d.invitation_id
        ? this.services.webOrigin + '/sign#' + tokenFor(d.invitation_id, this.services.secret)
        : this.services.webOrigin + '/dashboard?workspace=' + r.workspace_id + '&document=' + r.id;
      const intro =
        d.kind === 'completion'
          ? 'All recipients have signed. Your completed copy is ready.'
          : (d.kind === 'reminder' ? 'A reminder from ' : 'A signature request from ') +
            r.sender_name +
            '.';
      return {
        id: d.id,
        to: d.destination,
        subject: 'LumoDossier · ' + r.title,
        text: intro + '\n\n' + r.title + '\n\n' + url + '\n\nLumoDossier',
      };
    });
    if (!message) return;
    try {
      await this.services.mail.send(message);
    } catch (e) {
      await this.system((tx) =>
        tx.query("insert into lumo.delivery_attempts(delivery_id,outcome) values($1,'failed')", [
          message.id,
        ]),
      );
      throw e;
    }
    await this.system(async (tx) => {
      const changed = await one(
        tx,
        "update lumo.deliveries set status='accepted',updated_at=now() where id=$1 and status='queued' returning id",
        [message.id],
      );
      if (changed)
        await tx.query("insert into lumo.delivery_attempts(delivery_id,outcome) values($1,'accepted')", [
          message.id,
        ]);
    });
  }
}
