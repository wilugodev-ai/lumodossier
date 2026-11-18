import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
export { samplePdf } from './sample-pdf';
import { postgres } from '../src/db';
import { migrate } from '../src/migrate';
import { Problem, type Identity } from '../src/model';
import type { Services } from '../src/providers';

export async function unusedPort() {
  const server = createServer();
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error('No local port.');
  await new Promise<void>((ok, fail) => server.close((e) => (e ? fail(e) : ok())));
  return a.port;
}
export async function fixture(persistentRoot?: string) {
  const root = persistentRoot ?? (await mkdtemp(join(tmpdir(), 'lumodossier-test-')));
  const port = persistentRoot ? 54409 : await unusedPort();
  let settings = {
    password: randomBytes(24).toString('hex'),
    linkSecret: randomBytes(48).toString('hex'),
  };
  if (persistentRoot) {
    await mkdir(root, { recursive: true });
    const local = join(root, 'preview-settings.json');
    try {
      await writeFile(local, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      settings = JSON.parse(await readFile(local, 'utf8'));
    }
  }
  const { password } = settings;
  const cluster = new EmbeddedPostgres({
    databaseDir: join(root, 'db'),
    port,
    user: 'postgres',
    password,
    persistent: true,
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {},
    onError: () => {},
  });
  const url = 'postgresql://postgres:' + password + '@127.0.0.1:' + port + '/postgres';
  const exists = await access(join(root, 'db', 'PG_VERSION')).then(
    () => true,
    () => false,
  );
  if (!exists) await cluster.initialise();
  await cluster.start();
  const db = postgres(url);
  await migrate(db);
  const identity = (name: string): Identity => ({
    id: randomUUID(),
    name,
    email: name.toLowerCase() + '@example.invalid',
    token: randomBytes(32).toString('hex'),
  });
  const owner = identity('Sender'),
    other = identity('Visitor'),
    viewer = identity('Reader');
  const mail: { id: string; to: string; subject: string; text: string }[] = [];
  const services: Services = {
    webOrigin: 'http://127.0.0.1:3029',
    secret: settings.linkSecret,
    auth: {
      async user(t) {
        const who = [owner, other, viewer].find((x) => x.token === t);
        if (!who) throw new Problem(401, 'Sign in to continue.');
        return who;
      },
    },
    mail: {
      enabled: false,
      async send(msg) {
        if (!msg.to.endsWith('@example.invalid')) throw Error('Disposable addresses only.');
        if (!mail.some((m) => m.id === msg.id)) mail.push(msg);
      },
    },
    objects: {
      async put(key, bytes) {
        const target = join(root, 'objects', key);
        await mkdir(resolve(target, '..'), { recursive: true });
        try {
          await writeFile(target, bytes, { flag: 'wx' });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
          const existing = await readFile(target);
          if (
            createHash('sha256').update(existing).digest('hex') !==
            createHash('sha256').update(bytes).digest('hex')
          )
            throw Error('Existing test object differs.');
        }
      },
      async get(key) {
        return readFile(join(root, 'objects', key));
      },
    },
  };
  return {
    root,
    cluster,
    url,
    db,
    services,
    owner,
    other,
    viewer,
    mail,
    async close() {
      await db.close();
      await cluster.stop();
      if (persistentRoot) return;
      const inside = relative(resolve(tmpdir()), resolve(root));
      if (!isAbsolute(inside) && !inside.startsWith('..') && inside.startsWith('lumodossier-test-'))
        await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    },
  };
}
