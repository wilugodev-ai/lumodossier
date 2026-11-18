import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database, one, postgres } from './db';

export async function migrate(db: Database) {
  const directory = resolve(__dirname, '../../../supabase/migrations');
  const names = (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort();
  await db.tx(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(802341829)');
    await tx.query('create schema if not exists lumo_migrations');
    await tx.query('revoke all on schema lumo_migrations from public');
    await tx.query(
      'create table if not exists lumo_migrations.applied(name text primary key,checksum text not null)',
    );
    for (const name of names) {
      const sql = (await readFile(resolve(directory, name), 'utf8')).replace(/\r\n/g, '\n');
      const hash = createHash('sha256').update(sql).digest('hex');
      const previous = await one(tx, 'select checksum from lumo_migrations.applied where name=$1', [
        name,
      ]);
      if (previous && previous.checksum !== hash) throw new Error('Applied migration changed: ' + name);
      if (previous) continue;
      await tx.query(sql);
      await tx.query('insert into lumo_migrations.applied values($1,$2)', [name, hash]);
    }
  });
}
if (require.main === module) {
  const db = postgres(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '');
  migrate(db)
    .then(() => console.log('LumoDossier migrations applied.'))
    .catch(() => {
      console.error(
        'Migration failed. Check the database connection, privileges and migration history.',
      );
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
