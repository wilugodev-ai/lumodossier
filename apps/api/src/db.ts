import { Pool } from 'pg';
import { readFileSync } from 'node:fs';

export interface Rows {
  [key: string]: unknown;
}
export interface Sql {
  query<T extends Rows = Rows>(sql: string, args?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database {
  tx<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function postgres(url: string): Database {
  if (!url) throw new Error('DATABASE_URL is required.');
  const target = new URL(url);
  const remote = !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (remote) {
    if (['disable', 'allow', 'prefer', 'no-verify'].includes(target.searchParams.get('sslmode') ?? ''))
      throw new Error('Remote database connections require verified TLS.');
    for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert'])
      target.searchParams.delete(key);
  }
  const config: ConstructorParameters<typeof Pool>[0] = {
    connectionString: target.toString(),
    max: 8,
    connectionTimeoutMillis: 10000,
  };
  if (remote) config.ssl = { rejectUnauthorized: true };
  const ca = process.env.DATABASE_CA_BASE64;
  if (ca) config.ssl = { ca: Buffer.from(ca, 'base64').toString(), rejectUnauthorized: true };
  if (process.env.DATABASE_CA_FILE)
    config.ssl = { ca: readFileSync(process.env.DATABASE_CA_FILE, 'utf8'), rejectUnauthorized: true };
  const pool = new Pool(config);
  pool.on('error', () => console.error('Database connection interrupted.'));
  return {
    async tx(work) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const value = await work(client);
        await client.query('commit');
        return value;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
export async function one<T extends Rows>(
  db: Sql,
  statement: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await db.query<T>(statement, params)).rows[0];
}
export async function scope(db: Sql, workspace?: string) {
  await db.query('set local role lumo_service');
  await db.query("select set_config('lumo.system',$1,true),set_config('lumo.workspace',$2,true)", [
    workspace ? 'off' : 'on',
    workspace ?? '',
  ]);
}
