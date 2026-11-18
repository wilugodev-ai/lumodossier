import { Sql, one } from './db';
import {
  CONSENT,
  CONSENT_VERSION,
  INTENT,
  METHOD,
  Progress,
  DocumentRow,
  checkedValues,
  ensure,
  signSchema,
} from './model';
import { Sender } from './sender';
import { assertTurn, audit, invitePerson, job, locked, openForSigning, readFile } from './repository';
import { digest } from './providers';

export class Signing extends Sender {
  async withLink<T>(
    token: string,
    work: (tx: Sql, r: DocumentRow, p: Progress, purpose: string) => Promise<T>,
  ) {
    ensure(/^[A-Za-z0-9_-]{43}$/.test(token), 401, 'This link is invalid or has expired.');
    return this.system(async (tx) => {
      const lookup = await one<{ request_id: string }>(
        tx,
        'select request_id from lumo.invitations where token_hash=$1',
        [digest(token)],
      );
      ensure(lookup, 401, 'This link is invalid or has expired.');
      const r = await locked(tx, lookup.request_id);
      const link = await one<{ person_id: string; purpose: string }>(
        tx,
        'select person_id,purpose from lumo.invitations where token_hash=$1 and revoked_at is null and expires_at>clock_timestamp()',
        [digest(token)],
      );
      ensure(
        link && !r.cancelled_at && !r.expired_at && !r.declined_at,
        410,
        'This signing link is closed or has expired.',
      );
      const p = await one<Progress>(tx, 'select * from lumo.people where request_id=$1 and id=$2', [
        r.id,
        link.person_id,
      ]);
      ensure(p, 410, 'This signing link has closed.');
      if (!r.completed_at && !r.sealed_at) {
        await openForSigning(tx, r);
        if (!p.signed_at) await assertTurn(tx, r, p.ordinal);
      }
      return work(tx, r, p, link.purpose);
    });
  }
  async recipient(token: string) {
    return this.withLink(token, async (tx, r, p) => {
      if (!p.viewed_at && !p.signed_at && !r.sealed_at) {
        await tx.query('update lumo.people set viewed_at=now() where request_id=$1 and id=$2', [
          r.id,
          p.id,
        ]);
        await tx.query('update lumo.requests set updated_at=now() where id=$1', [r.id]);
        await audit(tx, r.id, 'viewed', p.name, { personId: p.id, authentication: METHOD });
      }
      return {
        requestId: r.id,
        versionId: r.version_id,
        title: r.title,
        pages: r.pages,
        senderName: r.sender_name,
        senderEmail: r.sender_email,
        recipient: { id: p.id, name: p.name, email: p.email },
        signed: Boolean(p.signed_at),
        completed: Boolean(r.completed_at),
        expiresAt: r.expires_at,
        fields: r.fields.filter((f) => f.personId === p.id),
        consent: CONSENT,
        consentVersion: CONSENT_VERSION,
        intent: INTENT,
      };
    });
  }
  async sign(token: string, body: unknown) {
    const input = signSchema.parse(body);
    return this.withLink(token, async (tx, r, p, purpose) => {
      ensure(purpose === 'sign', 409, 'This link is for a completed copy.');
      const values = checkedValues(
        r.fields.filter((f) => f.personId === p.id),
        input.values,
      );
      if (p.signed_at) {
        const same = await one(
          tx,
          'select 1 from lumo.signatures where request_id=$1 and person_id=$2 and values=$3::jsonb',
          [r.id, p.id, JSON.stringify(values)],
        );
        ensure(same, 409, 'Your signature has already been recorded.');
        return { signed: true, completed: Boolean(r.completed_at) };
      }
      await openForSigning(tx, r);
      await tx.query(
        'insert into lumo.signatures(request_id,person_id,values,consent,consent_version,intent,authentication) values($1,$2,$3,$4,$5,$6,$7)',
        [r.id, p.id, JSON.stringify(values), CONSENT, CONSENT_VERSION, INTENT, METHOD],
      );
      if (!p.viewed_at)
        await audit(tx, r.id, 'viewed', p.name, { personId: p.id, authentication: METHOD });
      await tx.query(
        'update lumo.people set viewed_at=coalesce(viewed_at,now()),signed_at=now() where request_id=$1 and id=$2',
        [r.id, p.id],
      );
      await audit(tx, r.id, 'signed', p.name, {
        personId: p.id,
        version: r.version_id,
        consentVersion: CONSENT_VERSION,
        authentication: METHOD,
      });
      const next = await one<Progress>(
        tx,
        'select * from lumo.people where request_id=$1 and signed_at is null order by ordinal limit 1',
        [r.id],
      );
      await tx.query('update lumo.requests set updated_at=now() where id=$1', [r.id]);
      if (!next) {
        await tx.query('update lumo.requests set sealed_at=now() where id=$1', [r.id]);
        await job(tx, r.id, 'finish', 'finish/' + r.id);
      } else if (r.routing === 'sequential') {
        await invitePerson(tx, this.services, r, next);
      }
      return { signed: true, completed: false };
    });
  }
  async decline(token: string, reason: string) {
    return this.withLink(token, async (tx, r, p, purpose) => {
      await openForSigning(tx, r);
      ensure(purpose === 'sign' && !p.signed_at, 409, 'This recipient has already finished.');
      await tx.query('update lumo.people set declined_at=now() where request_id=$1 and id=$2', [
        r.id,
        p.id,
      ]);
      await tx.query('update lumo.requests set declined_at=now(),updated_at=now() where id=$1', [r.id]);
      await tx.query(
        'update lumo.invitations set revoked_at=now() where request_id=$1 and revoked_at is null',
        [r.id],
      );
      await audit(tx, r.id, 'declined', p.name, { personId: p.id, reason, authentication: METHOD });
      return { declined: true };
    });
  }
  async recipientFile(token: string, kind: 'original' | 'completed' | 'record') {
    const result = await this.withLink(token, async (tx, r, p) => {
      if (kind !== 'original')
        ensure(r.completed_at && p.signed_at, 409, 'Your completed copy is not ready.');
      return kind === 'record' ? this.record(tx, r) : r.id;
    });
    return typeof result === 'string' ? readFile(this.db, this.services, result, kind) : result;
  }
}
