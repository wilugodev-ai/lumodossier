// Loopback-only test provider for machines without the optional Supabase Auth binary.
import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
const web = 'http://127.0.0.1:3029';
export async function authDouble(port: number) {
  const secret = randomBytes(40),
    tokens = new Map<string, string>(),
    refreshTokens = new Map<string, string>();
  type Account = {
    id: string;
    email: string;
    email_confirmed_at: string;
    user_metadata: { full_name: string };
    aud: string;
    role: string;
    created_at: string;
    updated_at: string;
    app_metadata: { provider: string; providers: string[] };
  };
  const accounts = new Map<string, { password: Buffer; salt: Buffer; user: Account }>();
  const json = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  };
  const session = (user: Account) => {
    const now = Math.floor(Date.now() / 1000),
      encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const text =
      encode({ alg: 'HS256', typ: 'JWT' }) +
      '.' +
      encode({
        sub: user.id,
        role: 'authenticated',
        email: user.email,
        iat: now,
        exp: now + 3600,
        aud: 'authenticated',
        session_id: randomUUID(),
      });
    const token = text + '.' + createHmac('sha256', secret).update(text).digest('base64url'),
      refresh = randomBytes(32).toString('hex');
    tokens.set(token, user.email);
    refreshTokens.set(refresh, user.email);
    return {
      access_token: token,
      token_type: 'bearer',
      refresh_token: refresh,
      expires_in: 3600,
      expires_at: now + 3600,
      user,
    };
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', web);
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    const out = (status: number, body: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    try {
      const u = new URL(req.url ?? '/', web);
      if (u.pathname === '/auth/v1/signup' && req.method === 'POST') {
        const b = await json(req);
        if (
          !String(b.email).endsWith('@example.invalid') ||
          String(b.password).length < 8 ||
          accounts.has(b.email)
        )
          return out(400, { msg: 'Use a unique disposable test account.' });
        const now = new Date().toISOString(),
          salt = randomBytes(16),
          user = {
            id: randomUUID(),
            email: b.email,
            email_confirmed_at: now,
            user_metadata: { full_name: String(b.data?.full_name ?? 'Sender') },
            aud: 'authenticated',
            role: 'authenticated',
            created_at: now,
            updated_at: now,
            app_metadata: { provider: 'email', providers: ['email'] },
          };
        accounts.set(b.email, { user, salt, password: scryptSync(b.password, salt, 32) });
        return out(200, session(user));
      }
      if (u.pathname === '/auth/v1/token') {
        const b = await json(req),
          email =
            u.searchParams.get('grant_type') === 'refresh_token'
              ? refreshTokens.get(b.refresh_token)
              : b.email;
        const a = accounts.get(email ?? '');
        if (
          !a ||
          (!b.refresh_token && !timingSafeEqual(a.password, scryptSync(String(b.password), a.salt, 32)))
        )
          return out(400, { msg: 'Invalid credentials.' });
        return out(200, session(a.user));
      }
      if (u.pathname === '/auth/v1/user') {
        const email = tokens.get((req.headers.authorization ?? '').slice(7)),
          a = accounts.get(email ?? '');
        return a ? out(200, a.user) : out(401, { msg: 'Invalid token.' });
      }
      if (u.pathname === '/auth/v1/logout') return out(200, {});
      out(404, { msg: 'Unknown test endpoint.' });
    } catch {
      out(400, { msg: 'Invalid test request.' });
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  return { close: () => new Promise<void>((ok) => server.close(() => ok())) };
}
