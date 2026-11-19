import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { fixture, samplePdf, unusedPort } from './fixture';
import { Signing } from '../src/recipient';
import { Worker } from '../src/jobs';
import { migrate } from '../src/migrate';
import { postgres, scope } from '../src/db';
import { httpServer } from '../src/http';
import { CONSENT_VERSION, type Draft, type Field, Problem } from '../src/model';
import { sha256 } from '../src/pdf';
import { tokenFor } from '../src/providers';
import { Team } from '../src/team';

let env: Awaited<ReturnType<typeof fixture>>,
  app: Signing,
  worker: Worker,
  w: string,
  otherW: string,
  pdf: Buffer;
const failure = (status: number) => (e: unknown) => e instanceof Problem && e.status === status;
const toToken = (link: { url?: string }) => link.url!.split('#')[1];
before(async () => {
  env = await fixture();
  app = new Signing(env.db, env.services);
  worker = new Worker(env.db, env.services);
  pdf = await samplePdf();
  w = (await app.createSpace(env.owner, 'Disposable workspace')).id;
  otherW = (await app.createSpace(env.other, 'Other workspace')).id;
  await env.db.tx((tx) =>
    tx.query("insert into lumo.members values($1,$2,'viewer')", [w, env.viewer.id]),
  );
});
after(async () => {
  if (env) await env.close();
});
async function draft(routing: Draft['routing'] = 'sequential') {
  const id = (await app.upload(env.owner, w, 'Service agreement', pdf)).id;
  const recipients = ['Ada', 'Lin'].map((name) => ({
    id: randomUUID(),
    name,
    email: name.toLowerCase() + '@example.invalid',
  }));
  const fields: Field[] = recipients.map((p, i) => ({
    id: randomUUID(),
    type: 'signature',
    label: 'Signature',
    page: i,
    personId: p.id,
    x: 0.1,
    y: 0.58,
    w: 0.45,
    h: 0.08,
    required: true,
  }));
  const d: Draft = { title: 'Service agreement', routing, recipients, fields, crm: {} };
  const saved = await app.save(env.owner, w, id, { ...d, revision: 1 });
  return { id, d, fields, recipients, revision: saved.revision };
}
const signing = (id: string, v: unknown) => ({
  consent: true,
  consentVersion: CONSENT_VERSION,
  intent: true,
  values: { [id]: v },
});
test('team invitations require the matching verified account and support expiry, revocation, role changes and removal', async () => {
  const team = new Team(env.db, env.services),
    space = (await app.createSpace(env.owner, 'Team access test')).id,
    address = env.other.email;
  const token = (i: { url: string }) => i.url.split('#team.')[1];
  const first = await team.invite(env.owner, space, address, 'member');
  await assert.rejects(team.list(env.other, space), failure(404));
  await assert.rejects(team.accept(env.viewer, 'team', token(first)), failure(403));
  const fresh = await team.invite(env.owner, space, address, 'viewer');
  await assert.rejects(team.accept(env.other, 'team', token(first)), failure(403));
  const stored = await env.db.tx((tx) =>
    tx.query('select token_hash from lumo.team_invitations where id=$1', [fresh.id]),
  );
  assert.equal(stored.rows[0].token_hash, sha256(Buffer.from(token(fresh))));
  await team.revoke(env.owner, space, fresh.id);
  await assert.rejects(team.accept(env.other, 'team', token(fresh)), failure(403));
  const expired = await team.invite(env.owner, space, address, 'viewer');
  await env.db.tx((tx) =>
    tx.query("update lumo.team_invitations set expires_at=now()-interval '1 second' where id=$1", [
      expired.id,
    ]),
  );
  await assert.rejects(team.accept(env.other, 'team', token(expired)), failure(403));
  const current = await team.invite(env.owner, space, address, 'viewer');
  const accepted = await Promise.allSettled([
    team.accept(env.other, 'team', token(current)),
    team.accept(env.other, 'team', token(current)),
  ]);
  assert.equal(accepted.filter((x) => x.status === 'fulfilled').length, 1);
  const directory = await team.list(env.other, space);
  assert.equal(directory.members.length, 2);
  assert.equal(directory.canManage, false);
  assert.deepEqual(directory.invitations, []);
  assert.equal(directory.members.find((m) => m.role === 'owner')?.email, env.owner.email);
  const owned = await team.list(env.owner, space);
  assert.equal(owned.invitations[0].email, address);
  assert(!('token_hash' in owned.invitations[0]));
  await assert.rejects(team.invite(env.owner, space, address, 'member'), failure(409));
  await assert.rejects(team.invite(env.other, space, env.viewer.email, 'viewer'), failure(403));
  await assert.rejects(app.upload(env.other, space, 'Denied', pdf), failure(403));
  await team.change(env.owner, space, env.other.id, 'member');
  const uploaded = await app.upload(env.other, space, 'Allowed', pdf);
  await assert.rejects(team.change(env.other, space, env.owner.id, null), failure(403));
  await assert.rejects(team.change(env.owner, space, env.owner.id, 'member'), failure(409));
  await assert.rejects(team.change(env.owner, space, env.owner.id, null), failure(409));
  await team.change(env.owner, space, env.other.id, null);
  await assert.rejects(app.detail(env.other, space, uploaded.id), failure(404));
  await assert.rejects(team.accept(env.other, 'team', token(current)), failure(403));
  assert.equal(
    (await app.spaces(env.other)).some((s) => s.id === space),
    false,
  );
});
test('isolates workspaces, enforces read-only roles and SQL row policies, and preserves migration history', async () => {
  const { id, d } = await draft();
  await migrate(env.db);
  await assert.rejects(app.detail(env.other, w, id), failure(404));
  await assert.rejects(app.detail(env.other, otherW, id), failure(404));
  await assert.rejects(app.download(env.other, otherW, id, 'original'), failure(404));
  assert.equal((await app.detail(env.viewer, w, id)).title, d.title);
  await assert.rejects(app.save(env.viewer, w, id, { ...d, revision: 2 }), failure(403));
  await assert.rejects(app.save(env.owner, w, id, { ...d, revision: 1 }), failure(409));
  await assert.rejects(
    app.save(env.owner, w, id, { ...d, revision: 2, crm: { customer: randomUUID() } }),
    failure(400),
  );
  await env.db.tx(async (tx) => {
    await scope(tx, otherW);
    assert.equal((await tx.query('select * from lumo.requests where id=$1', [id])).rows.length, 0);
  });
  await assert.rejects(
    env.db.tx(async (tx) => {
      await scope(tx, w);
      await tx.query('update lumo.events set actor=$1 where request_id=$2', ['edit', id]);
    }),
    /permission denied/,
  );
});
test('sequential signing validates scope and consent, freezes the revision, deduplicates concurrent submissions, completes and downloads after restart', async () => {
  const { id, d, fields, recipients, revision } = await draft();
  await app.send(env.owner, w, id, revision, 7);
  await assert.rejects(app.save(env.owner, w, id, { ...d, revision }), failure(409));
  await assert.rejects(
    env.db.tx((tx) => tx.query("update lumo.requests set title='changed' where id=$1", [id])),
    /frozen/,
  );
  await assert.rejects(app.manageLink(env.owner, w, id, recipients[1].id, 'share'), failure(409));
  const earlyId = randomUUID(),
    early = tokenFor(earlyId, env.services.secret);
  const { digest } = await import('../src/providers');
  await env.db.tx((tx) =>
    tx.query(
      "insert into lumo.invitations(id,request_id,person_id,token_hash,purpose,expires_at) values($1,$2,$3,$4,'sign',now()+interval '1 day')",
      [earlyId, id, recipients[1].id, digest(early)],
    ),
  );
  await assert.rejects(app.recipient(early), failure(409));
  await assert.rejects(app.sign(early, signing(fields[1].id, 'Lin')), failure(409));
  const old = toToken(await app.manageLink(env.owner, w, id, recipients[0].id, 'share'));
  const first = toToken(await app.manageLink(env.owner, w, id, recipients[0].id, 'share'));
  await assert.rejects(app.recipient(old), failure(410));
  const view = await app.recipient(first);
  assert.deepEqual(
    view.fields.map((f) => f.id),
    [fields[0].id],
  );
  assert.equal((await app.detail(env.owner, w, id)).status, 'viewed');
  await assert.rejects(app.sign(first, { ...signing(fields[0].id, 'Ada'), consent: false }));
  await assert.rejects(app.sign(first, { ...signing(fields[0].id, 'Ada'), intent: false }));
  await assert.rejects(app.sign(first, { ...signing(fields[0].id, 'Ada'), values: {} }), failure(400));
  await assert.rejects(app.sign(first, signing(fields[1].id, 'Ada')), failure(403));
  await Promise.all(Array.from({ length: 5 }, () => app.sign(first, signing(fields[0].id, 'Ada'))));
  await assert.rejects(app.sign(first, signing(fields[0].id, 'Changed')), failure(409));
  assert.equal((await app.detail(env.owner, w, id)).status, 'partially_signed');
  const second = toToken(await app.manageLink(env.owner, w, id, recipients[1].id, 'share'));
  await app.recipient(second);
  await app.sign(
    second,
    signing(fields[1].id, {
      strokes: [
        [
          [0.1, 0.8],
          [0.4, 0.1],
          [0.7, 0.85],
          [0.93, 0.43],
        ],
      ],
    }),
  );
  await assert.rejects(app.cancel(env.owner, w, id), failure(409));
  const fresh = postgres(env.url);
  try {
    await new Worker(fresh, env.services).drain();
    const recovered = new Signing(fresh, env.services);
    const detail = await recovered.detail(env.owner, w, id);
    assert.equal(detail.status, 'completed');
    assert.equal(detail.events.filter((e) => e.kind === 'signed').length, 2);
    assert.equal(detail.events.filter((e) => e.kind === 'completed').length, 1);
    const original = await recovered.download(env.owner, w, id, 'original'),
      completed = await recovered.recipientFile(second, 'completed');
    assert(Buffer.isBuffer(original) && Buffer.isBuffer(completed));
    assert.equal(sha256(original), sha256(pdf));
    assert.notEqual(sha256(completed), sha256(pdf));
    assert.equal((await PDFDocument.load(completed)).getPageCount(), 2);
    const record = await recovered.recipientFile(first, 'record');
    assert(!Buffer.isBuffer(record));
    assert.equal(record.completedSha256, sha256(completed));
    assert.equal(record.recipients.length, 2);
    assert(
      record.recipients.every(
        (p) =>
          p.consent_version === CONSENT_VERSION &&
          p.authentication === 'Possession of a private recipient link',
      ),
    );
    assert(detail.deliveries.every((r) => r.status === 'unavailable'));
    assert.equal(env.mail.length, 0);
  } finally {
    await fresh.close();
  }
});
test('simultaneous routing, cancellation, decline reasons, and expired or revoked links', async () => {
  for (const end of ['cancel', 'decline', 'expire', 'revoke'] as const) {
    const d = await draft('simultaneous');
    await app.send(env.owner, w, d.id, d.revision, 1);
    const t = toToken(await app.manageLink(env.owner, w, d.id, d.recipients[1].id, 'share'));
    await app.recipient(t);
    if (end === 'cancel') await app.cancel(env.owner, w, d.id);
    if (end === 'decline') await app.decline(t, 'Needs changes.');
    if (end === 'revoke') await app.manageLink(env.owner, w, d.id, d.recipients[1].id, 'revoke');
    if (end === 'expire')
      await env.db.tx(async (tx) => {
        // Backdate this disposable request while preserving the production freeze trigger.
        await tx.query('set local session_replication_role=replica');
        await tx.query("update lumo.requests set expires_at=now()-interval '1 minute' where id=$1", [
          d.id,
        ]);
      });
    await assert.rejects(
      app.sign(t, signing(d.fields[1].id, 'Lin')),
      (e) => e instanceof Problem && [409, 410].includes(e.status),
    );
    if (end === 'expire') {
      assert.equal((await app.detail(env.owner, w, d.id)).status, 'expired');
      await worker.expire(d.id);
    }
    if (end === 'decline')
      assert.equal((await app.detail(env.owner, w, d.id)).events.at(-1)?.kind, 'declined');
  }
});
test('recovers orphaned leases, retries a private object write and tracks provider acceptance separately', async () => {
  const d = await draft('simultaneous');
  env.services.mail.enabled = true;
  const ordinary = env.services.objects.put,
    mail = env.services.mail.send;
  try {
    await app.send(env.owner, w, d.id, d.revision, 7);
    env.services.objects.put = async (...args) => {
      await ordinary(...args);
      throw Error('simulated storage disconnect after write');
    };
    env.services.mail.send = async () => {
      throw Error('isolated provider failure');
    };
    await worker.drain();
    const attempt = await app.detail(env.owner, w, d.id);
    assert(attempt.deliveries.every((r) => r.status === 'queued' && r.attempts === 1));
    env.services.objects.put = ordinary;
    env.services.mail.send = mail;
    await env.db.tx((tx) =>
      tx.query(
        "update lumo.jobs set state='running',lease=$2,lease_until=now()-interval '1 minute' where request_id=$1 and kind in ('original','email')",
        [d.id, randomUUID()],
      ),
    );
    await Promise.all([
      new Worker(env.db, env.services).drain(),
      new Worker(env.db, env.services).drain(),
    ]);
    const sent = await app.detail(env.owner, w, d.id);
    assert(sent.deliveries.every((r) => r.status === 'accepted' && r.attempts === 2));
    assert.equal(sent.status, 'sent');
    assert.equal(env.mail.length, 2);
    assert(env.mail.every((m) => m.to.endsWith('@example.invalid')));
    await app.manageLink(env.owner, w, d.id, d.recipients[0].id, 'remind');
    await assert.rejects(app.manageLink(env.owner, w, d.id, d.recipients[0].id, 'remind'), failure(429));
  } finally {
    env.services.objects.put = ordinary;
    env.services.mail.send = mail;
    env.services.mail.enabled = false;
  }
});
test('CRM adapter checks membership and references and sees the same authoritative request', async () => {
  const cid = randomUUID(),
    space = randomUUID(),
    customer = randomUUID();
  env.services.crm = {
    async spaces(who) {
      return who.id === env.owner.id
        ? [{ id: space, name: 'CRM test', role: 'member', source: 'touchlumo' }]
        : [];
    },
    async resolve(who, w, refs) {
      if (w !== space || who.id !== env.owner.id || refs.customer !== customer)
        throw new Problem(404, 'Customer unavailable.');
      return { name: 'Contact', email: 'contact@example.invalid' };
    },
  };
  try {
    await assert.rejects(
      app.upload(env.owner, space, 'Foreign record', pdf, { customer: cid }),
      failure(404),
    );
    const d = await app.upload(env.owner, space, 'Related agreement', pdf, { customer });
    const detail = await app.detail(env.owner, space, d.id);
    assert.equal((detail.recipients as { email: string }[])[0].email, 'contact@example.invalid');
    const related = await app.list(env.owner, space, '', '', 1, { customer }),
      all = await app.list(env.owner, space, '', '', 1, {});
    assert.equal(related.documents[0].id, all.documents[0].id);
    assert.equal(related.documents[0].status, 'draft');
    await assert.rejects(app.list(env.other, space, '', '', 1, { customer }), failure(404));
  } finally {
    env.services.crm = undefined;
  }
});
test('HTTP API rejects missing authentication, foreign downloads, bad media and invalid recipient tokens', async () => {
  const previousOrigin = 'https://previous.example.test';
  const crmOrigin = 'https://crm.example.test';
  const server = await httpServer(env.db, env.services, crmOrigin, previousOrigin),
    port = await unusedPort();
  await server.listen(port, '127.0.0.1');
  const base = 'http://127.0.0.1:' + port;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/v1/workspaces')).status, 401);
    const corsOrigin = async (origin: string) =>
      (
        await fetch(base + '/v1/workspaces', {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
        })
      ).headers.get('Access-Control-Allow-Origin');
    for (const origin of [env.services.webOrigin, previousOrigin, crmOrigin]) {
      assert.equal(await corsOrigin(origin), origin);
    }
    assert.equal(await corsOrigin(previousOrigin + '.other.test'), null);
    assert.equal(
      (
        await fetch(base + '/v1/workspaces/' + w + '/documents', {
          headers: { Authorization: 'Bearer ' + env.other.token },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + '/v1/workspaces/' + w + '/documents', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + env.owner.token, 'Content-Type': 'text/plain' },
          body: 'not a PDF',
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(base + '/v1/recipient/open', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + randomUUID() },
        })
      ).status,
      401,
    );
  } finally {
    await server.close();
  }
});
test('password-free recipient access and pending work survive a database and API restart', async () => {
  const d = await draft();
  await app.send(env.owner, w, d.id, d.revision, 5);
  const invitation = toToken(await app.manageLink(env.owner, w, d.id, d.recipients[0].id, 'share'));
  const firstApi = await httpServer(env.db, env.services);
  await firstApi.listen(await unusedPort(), '127.0.0.1');
  await firstApi.close();
  await env.cluster.stop();
  await env.cluster.start();
  const fresh = postgres(env.url),
    restarted = await httpServer(fresh, env.services);
  await restarted.listen(await unusedPort(), '127.0.0.1');
  try {
    const response = await fetch((await restarted.getUrl()) + '/v1/recipient/open', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + invitation },
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).requestId, d.id);
    await new Worker(fresh, env.services).drain();
    const file = await fresh.tx((tx) =>
      tx.query("select stored_at,staged from lumo.files where request_id=$1 and kind='original'", [
        d.id,
      ]),
    );
    assert(file.rows[0].stored_at);
    assert.equal(file.rows[0].staged, null);
  } finally {
    await restarted.close();
    await fresh.close();
  }
});
test('durable rate limits, exhausted retries, recipient validation and recovery controls', async () => {
  const key = 'test/' + randomUUID();
  await app.limit(key, 1);
  await assert.rejects(app.limit(key, 1), failure(429));
  const d = await draft();
  const incomplete = { ...d.d, recipients: d.recipients.map((p) => ({ ...p, email: '' })) };
  const saved = await app.save(env.owner, w, d.id, { ...incomplete, revision: d.revision });
  await assert.rejects(app.send(env.owner, w, d.id, saved.revision, 7), failure(400));
  await env.db.tx((tx) =>
    tx.query(
      "update lumo.jobs set state='running',attempts=7,lease=$2,lease_until=now()-interval '1 minute' where request_id=$1 and kind='original'",
      [d.id, randomUUID()],
    ),
  );
  await worker.drain();
  assert.equal((await app.detail(env.owner, w, d.id)).processingFailed, true);
  await assert.rejects(app.retryFiles(env.viewer, w, d.id), failure(403));
  await app.retryFiles(env.owner, w, d.id);
  await worker.drain();
  assert.equal((await app.detail(env.owner, w, d.id)).processingFailed, false);
});
test('configured email releases the next invitation and issues completed-copy links to both recipients', async () => {
  await worker.drain();
  env.mail.length = 0;
  env.services.mail.enabled = true;
  try {
    const d = await draft();
    await app.send(env.owner, w, d.id, d.revision, 7);
    await worker.drain();
    assert.deepEqual(
      env.mail.map((m) => m.to),
      [d.recipients[0].email],
    );
    const fromMail = (body: string) => {
      const m = body.match(/\/sign#([\w-]{43})/);
      assert(m);
      return m[1];
    };
    await app.sign(fromMail(env.mail[0].text), signing(d.fields[0].id, 'Ada'));
    await worker.drain();
    assert.deepEqual(
      env.mail.map((m) => m.to),
      d.recipients.map((p) => p.email),
    );
    await app.sign(fromMail(env.mail[1].text), signing(d.fields[1].id, 'Lin'));
    await worker.drain();
    assert.equal(env.mail.length, 5);
    assert(env.mail.some((m) => m.to === env.owner.email));
    const copy = env.mail.findLast((m) => m.to === d.recipients[0].email)!;
    assert(Buffer.isBuffer(await app.recipientFile(fromMail(copy.text), 'completed')));
    await assert.rejects(app.sign(fromMail(copy.text), signing(d.fields[0].id, 'Ada')), failure(409));
    assert((await app.detail(env.owner, w, d.id)).deliveries.every((r) => r.status === 'accepted'));
    const replacement = await draft();
    await app.send(env.owner, w, replacement.id, replacement.revision, 7);
    await app.manageLink(env.owner, w, replacement.id, replacement.recipients[0].id, 'share');
    await worker.drain();
    assert.equal((await app.detail(env.owner, w, replacement.id)).deliveries[0].status, 'superseded');
    assert.equal(env.mail.length, 5);
  } finally {
    env.services.mail.enabled = false;
  }
});
