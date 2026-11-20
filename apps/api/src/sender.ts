import { randomUUID } from 'node:crypto';
import { Sql, one } from './db';
import {
  DocumentRow,
  Identity,
  Progress,
  Refs,
  draftSchema,
  ensure,
  personFromContact,
  validateDraft,
} from './model';
import {
  Repository,
  assertTurn,
  audit,
  invitation,
  invitePerson,
  job,
  locked,
  openForSigning,
  readFile,
  stage,
} from './repository';
import { inspectPdf, sha256 } from './pdf';
import { preparePropertyTemplate } from './property-templates';

type DraftSource =
  { title: string; data: Buffer } | { template: string; values: Record<string, string> };

export const statuses = [
  'draft',
  'sent',
  'viewed',
  'partially_signed',
  'completed',
  'declined',
  'expired',
  'cancelled',
] as const;
export class Sender extends Repository {
  upload(who: Identity, w: string, title: string, data: Buffer, crm: Refs = {}) {
    return this.createDraft(who, w, crm, { title, data });
  }
  async createDraft(who: Identity, w: string, crm: Refs, source: DraftSource) {
    return this.inSpace(who, w, true, async (tx, space) => {
      const contact = await this.refs(who, space, crm);
      const associated = contact?.id ? { ...crm, customer: contact.id } : crm;
      const customer = contact?.email ? personFromContact(contact.name, contact.email) : undefined;
      const { title, data, recipients, fields } =
        'template' in source
          ? await preparePropertyTemplate(source.template, source.values, customer)
          : { ...source, recipients: customer ? [customer] : [], fields: [] };
      const pages = await inspectPdf(data);
      validateDraft({ title, routing: 'sequential', recipients, fields, crm: associated }, pages);
      const id = randomUUID(),
        version = randomUUID();
      const r = await one<DocumentRow>(
        tx,
        `insert into lumo.requests(id,workspace_id,version_id,sender_id,sender_email,sender_name,original_hash,pages,title,routing,recipients,fields,crm)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,'sequential',$10,$11,$12) returning *`,
        [
          id,
          w,
          version,
          who.id,
          who.email,
          who.name,
          sha256(data),
          JSON.stringify(pages),
          title,
          JSON.stringify(recipients),
          JSON.stringify(fields),
          JSON.stringify(associated),
        ],
      );
      await stage(tx, r!, 'original', data);
      await job(tx, id, 'original', 'original/' + id);
      await audit(tx, id, 'created', who.name, {
        userId: who.id,
        version,
        originalHash: r!.original_hash,
        ...('template' in source ? { template: source.template } : {}),
      });
      return { id, revision: 1 };
    });
  }
  async save(who: Identity, w: string, id: string, body: unknown) {
    const d = draftSchema.parse(body);
    return this.inSpace(who, w, true, async (tx, space) => {
      const r = await locked(tx, id, w);
      ensure(!r.sent_at && !r.cancelled_at, 409, 'This document version is locked.');
      ensure(
        r.revision === d.revision,
        409,
        'Another change was saved. Reload this draft before editing.',
      );
      validateDraft(d, r.pages);
      const contact = await this.refs(who, space, d.crm);
      if (contact?.id) d.crm = { ...d.crm, customer: contact.id };
      await tx.query(
        'update lumo.requests set title=$2,routing=$3,recipients=$4,fields=$5,crm=$6,revision=revision+1,updated_at=now() where id=$1',
        [
          id,
          d.title,
          d.routing,
          JSON.stringify(d.recipients),
          JSON.stringify(d.fields),
          JSON.stringify(d.crm),
        ],
      );
      return { id, revision: r.revision + 1 };
    });
  }
  async send(who: Identity, w: string, id: string, revision: number, days: number) {
    return this.inSpace(who, w, true, async (tx, space) => {
      const r = await locked(tx, id, w);
      ensure(
        !r.cancelled_at && !r.sent_at && revision === r.revision,
        409,
        'This draft has changed or has already been sent.',
      );
      validateDraft(r, r.pages, true);
      await this.refs(who, space, r.crm);
      const sent = await one<DocumentRow>(
        tx,
        "update lumo.requests set sent_at=now(),updated_at=now(),expires_at=now()+$2::int*interval '1 day' where id=$1 returning *",
        [id, days],
      );
      for (const [idx, p] of r.recipients.entries()) {
        await tx.query(
          'insert into lumo.people(request_id,id,ordinal,name,email) values($1,$2,$3,$4,$5)',
          [id, p.id, idx + 1, p.name, p.email],
        );
        if (!idx || r.routing === 'simultaneous') await invitePerson(tx, this.services, sent!, p);
      }
      await audit(tx, id, 'sent', who.name, {
        userId: who.id,
        version: r.version_id,
        routing: r.routing,
      });
      await job(tx, id, 'expire', 'expire/' + id, {}, sent!.expires_at!);
      return { id, status: 'sent', emailEnabled: this.services.mail.enabled };
    });
  }
  async list(who: Identity, w: string, q: string, status: string, page: number, refs: Refs) {
    return this.inSpace(who, w, false, async (tx, space) => {
      await this.refs(who, space, refs);
      const params = [w, q, status, JSON.stringify(refs)];
      const where =
        "where workspace_id=$1 and ($2='' or strpos(lower(title),lower($2))>0) and ($3='' or status=$3) and crm @> $4::jsonb";
      const rows = await tx.query(
        'select id,title,status,created_at,sent_at,completed_at,updated_at,routing,recipients,total,signed,version_id from lumo.overview ' +
          where +
          ' order by created_at desc,id limit 20 offset $5',
        [...params, (page - 1) * 20],
      );
      const count = await one(tx, 'select count(*)::int as count from lumo.overview ' + where, params);
      const stats = await tx.query(
        'select status,count(*)::int as count from lumo.overview where workspace_id=$1 and crm @> $2::jsonb group by status',
        [w, JSON.stringify(refs)],
      );
      return { documents: rows.rows, total: count!.count, page, pageSize: 20, stats: stats.rows };
    });
  }
  async detail(who: Identity, w: string, id: string) {
    return this.inSpace(who, w, false, async (tx) => {
      const row = await one<
        DocumentRow & { status: (typeof statuses)[number]; signed: number; total: number }
      >(tx, 'select * from lumo.overview where workspace_id=$1 and id=$2', [w, id]);
      ensure(row, 404, 'Document not found.');
      const people = await tx.query('select * from lumo.people where request_id=$1 order by ordinal', [
        id,
      ]);
      const events = await tx.query(
        'select id,kind,actor,detail,occurred_at from lumo.events where request_id=$1 order by id',
        [id],
      );
      const deliveries = await tx.query(
        `select d.id,d.person_id,d.kind,d.status,d.created_at,d.updated_at,
        coalesce((select jsonb_agg(jsonb_build_object('outcome',a.outcome,'at',a.occurred_at) order by a.id) from lumo.delivery_attempts a where a.delivery_id=d.id),'[]'::jsonb) attempt_log,
        (select count(*)::int from lumo.delivery_attempts a where a.delivery_id=d.id) attempts
        from lumo.deliveries d where request_id=$1 order by created_at,id`,
        [id],
      );
      const failed = await one(
        tx,
        "select 1 from lumo.jobs where request_id=$1 and kind in ('original','finish') and state='failed' limit 1",
        [id],
      );
      return {
        ...row,
        people: people.rows,
        events: events.rows,
        deliveries: deliveries.rows,
        emailEnabled: this.services.mail.enabled,
        processingFailed: Boolean(failed),
      };
    });
  }
  async retryFiles(who: Identity, w: string, id: string) {
    return this.inSpace(who, w, true, async (tx) => {
      await locked(tx, id, w);
      const jobs = await tx.query(
        "update lumo.jobs set state='ready',attempts=0,lease=null,lease_until=null,available_at=now(),last_error=null where request_id=$1 and kind in ('original','finish') and state='failed' returning id",
        [id],
      );
      ensure(jobs.rows.length, 409, 'No file needs to be retried.');
      await audit(tx, id, 'processing_retried', who.name, { userId: who.id });
      return { queued: true };
    });
  }
  async cancel(who: Identity, w: string, id: string) {
    return this.inSpace(who, w, true, async (tx) => {
      const r = await locked(tx, id, w);
      await openForSigning(tx, r);
      await tx.query('update lumo.requests set cancelled_at=now(),updated_at=now() where id=$1', [id]);
      await tx.query(
        'update lumo.invitations set revoked_at=now() where request_id=$1 and revoked_at is null',
        [id],
      );
      await audit(tx, id, 'cancelled', who.name, { userId: who.id });
      return { status: 'cancelled' };
    });
  }
  async manageLink(
    who: Identity,
    w: string,
    id: string,
    pid: string,
    mode: 'share' | 'remind' | 'revoke',
  ) {
    return this.inSpace(who, w, true, async (tx) => {
      const r = await locked(tx, id, w);
      const p = await one<Progress>(tx, 'select * from lumo.people where request_id=$1 and id=$2', [
        id,
        pid,
      ]);
      ensure(p, 404, 'Recipient not found.');
      if (mode === 'revoke') {
        await tx.query(
          'update lumo.invitations set revoked_at=now() where request_id=$1 and person_id=$2 and revoked_at is null',
          [id, pid],
        );
        await audit(tx, id, 'links_revoked', who.name, { personId: pid, userId: who.id });
        return { revoked: true };
      }
      if (!r.completed_at || mode === 'remind') {
        await openForSigning(tx, r);
        ensure(!p.signed_at, 409, 'This recipient has already signed.');
        await assertTurn(tx, r, p.ordinal);
      }
      if (mode === 'remind') {
        ensure(
          this.services.mail.enabled,
          409,
          'Email is unavailable. Create a manual sharing link instead.',
        );
        const recent = await one(
          tx,
          "select 1 from lumo.deliveries where request_id=$1 and person_id=$2 and kind='reminder' and created_at>now()-interval '1 minute'",
          [id, pid],
        );
        ensure(!recent, 429, 'A reminder was just requested.');
        await invitePerson(tx, this.services, r, p, 'reminder');
        await audit(tx, id, 'reminder_requested', who.name, { personId: pid });
        return { queued: true };
      }
      await tx.query(
        'update lumo.invitations set revoked_at=now() where request_id=$1 and person_id=$2 and revoked_at is null',
        [id, pid],
      );
      const link = await invitation(tx, this.services, r, pid, r.completed_at ? 'copy' : 'sign');
      await audit(tx, id, 'manual_link_created', who.name, { personId: pid });
      return { url: link.url, expiresAt: link.expiresAt };
    });
  }
  async download(who: Identity, w: string, id: string, kind: 'original' | 'completed' | 'record') {
    const result = await this.inSpace(who, w, false, async (tx) => {
      const r = await locked(tx, id, w);
      if (kind !== 'original')
        ensure(r.completed_at, 409, 'The completed files are being prepared or signing is still open.');
      return kind === 'record' ? this.record(tx, r) : kind;
    });
    return typeof result === 'string' ? readFile(this.db, this.services, id, result) : result;
  }
  async record(tx: Sql, r: DocumentRow) {
    const recipients = (
      await tx.query(
        `select p.id,p.name,p.email,p.ordinal,p.viewed_at,p.signed_at,
      s.authentication,s.consent,s.consent_version,s.intent from lumo.people p left join lumo.signatures s
      on (s.request_id,s.person_id)=(p.request_id,p.id) where p.request_id=$1 order by ordinal`,
        [r.id],
      )
    ).rows;
    const history = await tx.query(
      'select kind,actor,detail,occurred_at from lumo.events where request_id=$1 order by id',
      [r.id],
    );
    return {
      product: 'LumoDossier',
      record: 'Electronic signing completion record',
      requestId: r.id,
      documentVersion: r.version_id,
      title: r.title,
      sender: { name: r.sender_name, email: r.sender_email },
      originalSha256: r.original_hash,
      completedSha256: r.completed_hash,
      completedAt: r.completed_at,
      routing: r.routing,
      recipients,
      history: history.rows,
      integrity:
        'Events and signing evidence are append-only to application users. Database and storage administrators control the underlying systems. The document uses ordinary electronic signatures.',
    };
  }
}
