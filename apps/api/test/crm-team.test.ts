import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { crmTeam } from '../src/crm-team';
import { digest } from '../src/providers';
import { Problem } from '../src/model';

test('connected team actions use Touchlumo RPCs and the active user’s bearer and workspace', async (t) => {
  const workspace = randomUUID(),
    invite = randomUUID(),
    person = randomUUID(),
    hash = digest(randomUUID());
  const who = { id: person, email: 'owner@example.invalid', name: 'Owner', token: 'disposable-session' };
  const calls: {
    path: string;
    method: string;
    query: URLSearchParams;
    body: Record<string, unknown>;
  }[] = [];
  let deny = false;
  t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
    const url = new URL(input),
      headers = new Headers(options.headers);
    assert.equal(url.origin, 'https://crm.example.invalid');
    assert.equal(headers.get('authorization'), 'Bearer ' + who.token);
    assert.equal(headers.get('apikey'), 'public-test-key');
    calls.push({
      path: url.pathname,
      method: options.method!,
      query: url.searchParams,
      body: JSON.parse(String(options.body ?? '{}')),
    });
    if (deny) return new Response(null, { status: 403 });
    if (url.pathname.endsWith('/invite_member')) return Response.json(invite);
    if (url.pathname.endsWith('/accept_invite')) return Response.json(workspace);
    if (url.pathname.endsWith('/manage_member')) return new Response(null, { status: 204 });
    if (options.method === 'DELETE') return Response.json([{ id: invite }]);
    return Response.json([]);
  });
  const crm = crmTeam('https://crm.example.invalid', 'public-test-key');
  await crm.list(who, workspace, false);
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/rest/v1/rpc/list_members'],
  );
  assert.deepEqual(calls[0].body, { target: workspace });
  await crm.list(who, workspace, true);
  assert.equal(calls.at(-1)?.query.get('workspace_id'), 'eq.' + workspace);
  assert(!calls.at(-1)?.query.get('select')?.includes('token'));
  assert.equal(await crm.invite(who, workspace, who.email, 'viewer', hash), invite);
  assert.deepEqual(calls.at(-1)?.body, {
    target: workspace,
    invite_email: who.email,
    invite_role: 'viewer',
    invite_hash: hash,
  });
  assert.equal(await crm.accept(who, hash), workspace);
  assert.deepEqual(calls.at(-1)?.body, { invite_hash: hash });
  await crm.update(who, workspace, person, null);
  assert.deepEqual(calls.at(-1)?.body, { target: workspace, member_id: person, new_role: null });
  await crm.revoke(who, workspace, invite);
  assert.equal(calls.at(-1)?.method, 'DELETE');
  assert.equal(calls.at(-1)?.query.get('workspace_id'), 'eq.' + workspace);
  assert.equal(calls.at(-1)?.query.get('id'), 'eq.' + invite);
  deny = true;
  await assert.rejects(crm.accept(who, hash), (e) => e instanceof Problem && e.status === 403);
});
