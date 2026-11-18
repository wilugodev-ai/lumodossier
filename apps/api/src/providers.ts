import { Storage } from '@google-cloud/storage';
import { createHash, createHmac } from 'node:crypto';
import { ensure, Identity, Refs, Space, Problem } from './model';
import { crmTeam, type CrmTeam } from './crm-team';

export interface ObjectStore {
  put(key: string, data: Buffer, hash: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
export interface Mail {
  enabled: boolean;
  send(input: { id: string; to: string; subject: string; text: string }): Promise<void>;
}
export interface Auth {
  user(token: string): Promise<Identity>;
}
export interface Crm {
  team?: CrmTeam;
  spaces(who: Identity): Promise<Space[]>;
  resolve(
    who: Identity,
    workspace: string,
    refs: Refs,
  ): Promise<{ id?: string; name: string; email: string } | null>;
}
export interface Services {
  objects: ObjectStore;
  mail: Mail;
  auth: Auth;
  crm?: Crm;
  secret: string;
  webOrigin: string;
}
export function tokenFor(id: string, secret: string) {
  return createHmac('sha256', secret)
    .update('lumo/invitation/v1/' + id)
    .digest('base64url');
}
export function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function needed(name: string) {
  const v = process.env[name];
  if (!v) throw new Error('Missing ' + name);
  return v;
}
function origin(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' &&
    !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
  )
    throw new Error('HTTPS origin required.');
  return u.origin;
}
export function supabaseUserVerifier(supabase: string, apiKey: string): Auth {
  return {
    async user(token) {
      ensure(token.length > 0 && token.length <= 8192, 401, 'Sign in to continue.');
      const res = await fetch(supabase + '/auth/v1/user', {
        headers: { apikey: apiKey, Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403)
        throw new Problem(401, 'Your session has expired. Sign in again.');
      ensure(res.ok, 503, 'Sign-in is temporarily unavailable.');
      const u = await res.json();
      ensure(
        u.id && u.email && u.email_confirmed_at,
        403,
        'Confirm your email before sending documents.',
      );
      return {
        id: u.id,
        email: u.email,
        name: String(u.user_metadata?.full_name || u.email).slice(0, 120),
        token,
      };
    },
  };
}
export function serviceConfig(): Services {
  const secret = needed('LINK_SECRET');
  if (secret.length < 32) throw new Error('LINK_SECRET is too short.');
  const supabase = origin(needed('SUPABASE_URL')),
    apiKey = needed('SUPABASE_PUBLISHABLE_KEY');
  const webOrigin = origin(needed('WEB_ORIGIN'));
  const encoded = process.env.GCS_CREDENTIALS_BASE64;
  const credentials = encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : undefined;
  const bucket = new Storage(
    credentials ? { credentials, projectId: credentials.project_id } : {},
  ).bucket(needed('GCS_BUCKET'));
  const objects: ObjectStore = {
    async put(key, data, hash) {
      const file = bucket.file(key);
      try {
        await file.save(data, {
          resumable: false,
          validation: 'crc32c',
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'private, no-store',
            metadata: { sha256: hash },
          },
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 412) throw e;
        const existing = await file.download();
        if (createHash('sha256').update(existing[0]).digest('hex') !== hash)
          throw new Error('Object integrity mismatch.');
      }
    },
    async get(key) {
      return (await bucket.file(key).download())[0];
    },
  };
  const headers = (token: string) => ({ apikey: apiKey, Authorization: 'Bearer ' + token });
  const auth: Auth = supabaseUserVerifier(supabase, apiKey);
  async function records(who: Identity, table: string, params: Record<string, string>) {
    const res = await fetch(supabase + '/rest/v1/' + table + '?' + new URLSearchParams(params), {
      headers: headers(who.token),
      signal: AbortSignal.timeout(8000),
    });
    ensure(res.ok, 503, 'The connected CRM workspace could not be read.');
    return res.json();
  }
  const crm: Crm = {
    team: crmTeam(supabase, apiKey),
    async spaces(who) {
      const rows: { role: Space['role']; workspaces: { id: string; name: string } }[] = await records(
        who,
        'workspace_members',
        { select: 'role,workspaces!inner(id,name)', user_id: 'eq.' + who.id },
      );
      return rows.map((r) => ({ ...r.workspaces, role: r.role, source: 'touchlumo' }));
    },
    async resolve(who, w, refs) {
      let contact = refs.customer;
      for (const kind of ['quote', 'deal'] as const) {
        if (!refs[kind]) continue;
        const [item] = await records(who, kind === 'quote' ? 'quotes' : 'deals', {
          select: 'id,contact_id',
          workspace_id: 'eq.' + w,
          id: 'eq.' + refs[kind],
        });
        ensure(item, 404, 'The related CRM record is unavailable in this workspace.');
        ensure(
          !item.contact_id || !contact || item.contact_id === contact,
          400,
          'The selected CRM records have different customers.',
        );
        contact = contact || item.contact_id;
      }
      if (!contact) return null;
      const [person] = await records(who, 'contacts', {
        select: 'name,email',
        workspace_id: 'eq.' + w,
        id: 'eq.' + contact,
      });
      ensure(person, 404, 'The related customer is unavailable in this workspace.');
      return { id: contact, name: String(person.name), email: String(person.email) };
    },
  };
  const mailKey = process.env.EMAIL_API_KEY,
    from = process.env.EMAIL_FROM;
  const mailUrl = new URL(process.env.EMAIL_API_URL || 'https://api.resend.com/emails');
  if (mailUrl.protocol !== 'https:') throw new Error('The email provider must use HTTPS.');
  return {
    auth,
    objects,
    webOrigin,
    secret,
    crm: process.env.TOUCHLUMO_ENABLED === 'true' ? crm : undefined,
    mail: {
      enabled: Boolean(mailKey && from),
      async send(m) {
        const res = await fetch(mailUrl, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(12000),
          headers: {
            Authorization: 'Bearer ' + mailKey,
            'Content-Type': 'application/json',
            'Idempotency-Key': m.id,
          },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
        });
        if (!res.ok) throw new Error('Email provider did not accept the request.');
      },
    },
  };
}
