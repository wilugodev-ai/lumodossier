import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { unusedPort } from './fixture';

/**
 * Run a real GoTrue binary on the disposable test database. The small HTTP
 * gateway supplies the /auth/v1 prefix that the Supabase browser SDK expects.
 * Password checking, token issuance and user verification happen in GoTrue.
 * For the Windows fixture, build supabase/auth v2.169.0 at upstream commit
 * 338a14c2f9b31c002d41363af841f3f663f64f59 with CGO_ENABLED=0 and
 * `go build -trimpath -o gotrue.exe .`. This tag uses a portable listener.
 * LUMO_GOTRUE_BINARY may also point to a native Linux or macOS executable.
 */
export async function startRealAuth(
  databaseUrl: string,
  siteOrigin: string,
  proxyPort = 0,
  smtpPort = 1,
) {
  const binary = process.env.LUMO_GOTRUE_BINARY;
  if (!binary) throw new Error('Set LUMO_GOTRUE_BINARY to a local Supabase Auth executable.');
  const connection = new URL(databaseUrl);
  const site = new URL(siteOrigin);
  if (connection.hostname !== '127.0.0.1' || site.hostname !== '127.0.0.1') {
    throw new Error('GoTrue tests require a disposable loopback database and website.');
  }

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query('create schema if not exists auth');
  } finally {
    await db.end();
  }
  connection.protocol = 'postgres:';
  connection.searchParams.set('search_path', 'auth');
  connection.searchParams.set('sslmode', 'disable');

  const port = await unusedPort();
  const gateway = createServer((req, res) => {
    if (!req.url?.startsWith('/auth/v1/')) {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.origin && req.headers.origin !== site.origin) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', site.origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] ?? 'authorization,apikey,content-type',
      );
      res.writeHead(204).end();
      return;
    }
    const headers = { ...req.headers, host: '127.0.0.1:' + port };
    delete headers.origin;
    const upstream = request(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path: req.url.slice('/auth/v1'.length),
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((ok, fail) => {
    gateway.once('error', fail);
    gateway.listen(proxyPort, '127.0.0.1', ok);
  });
  const address = gateway.address();
  if (!address || typeof address === 'string') throw new Error('Local auth gateway unavailable.');
  const url = 'http://127.0.0.1:' + address.port;
  const cwd = await mkdtemp(join(tmpdir(), 'lumo-auth-'));
  const child = spawn(resolve(binary), [], {
    cwd,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      SystemRoot: process.env.SystemRoot,
      TEMP: tmpdir(),
      TMP: tmpdir(),
      DATABASE_URL: connection.toString(),
      DB_NAMESPACE: 'auth',
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_API_HOST: '127.0.0.1',
      PORT: String(port),
      API_EXTERNAL_URL: url + '/auth/v1',
      GOTRUE_SITE_URL: site.origin,
      GOTRUE_URI_ALLOW_LIST: site.origin + '/dashboard,' + site.origin + '/?account=reset',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_SMTP_HOST: '127.0.0.1',
      GOTRUE_SMTP_PORT: String(smtpPort),
      GOTRUE_SMTP_ADMIN_EMAIL: 'accounts@example.invalid',
      GOTRUE_MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
      GOTRUE_JWT_SECRET: randomBytes(48).toString('hex'),
      GOTRUE_JWT_EXP: '3600',
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_LOG_LEVEL: 'error',
    },
  });
  let spawnFailed = false;
  child.on('error', () => {
    spawnFailed = true;
  });
  const closed = new Promise<void>((ok) => child.once('close', () => ok()));
  const stop = async () => {
    const gatewayClosed = new Promise<void>((ok) => gateway.close(() => ok()));
    gateway.closeAllConnections();
    if (child.exitCode === null && !child.signalCode) child.kill();
    await Promise.all([closed, gatewayClosed]);
    await rmdir(cwd);
  };
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null || child.signalCode) {
        throw new Error('GoTrue exited before becoming ready (exit ' + String(child.exitCode) + ').');
      }
      const health = await fetch(url + '/auth/v1/health', { signal: AbortSignal.timeout(1500) }).catch(
        () => null,
      );
      if (health) {
        await health.arrayBuffer();
        if (health.ok) return { url, publishableKey: 'local-test-publishable-key', stop };
      }
      await delay(120);
    }
    throw new Error('Timed out waiting for the local GoTrue server.');
  } catch (error) {
    await stop();
    throw error;
  }
}
