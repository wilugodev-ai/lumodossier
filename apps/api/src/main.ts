import { postgres } from './db';
import { httpServer } from './http';
import { Worker } from './jobs';
import { needed, serviceConfig } from './providers';
import { setTimeout as delay } from 'node:timers/promises';

async function main() {
  const services = serviceConfig(),
    db = postgres(needed('DATABASE_URL'));
  const app = await httpServer(db, services, process.env.CRM_ORIGIN);
  await app.listen(Number(process.env.PORT || 4000), '0.0.0.0');
  let stopping = false;
  const shutdown = () => {
    stopping = true;
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  const worker = new Worker(db, services);
  while (!stopping) {
    if (process.env.JOBS_INLINE !== 'false')
      await worker.drain(10).catch(() => console.error('Job processing will retry.'));
    await delay(1200);
  }
  await app.close();
  await db.close();
}
main().catch(() => {
  console.error('LumoDossier API could not start. Check the server environment and database.');
  process.exitCode = 1;
});
