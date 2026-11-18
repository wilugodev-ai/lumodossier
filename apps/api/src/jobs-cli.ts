import { postgres } from './db';
import { Worker } from './jobs';
import { needed, serviceConfig } from './providers';

async function run() {
  const services = serviceConfig(),
    db = postgres(needed('DATABASE_URL'));
  try {
    console.log('Processed ' + (await new Worker(db, services).drain(200)) + ' job(s).');
  } finally {
    await db.close();
  }
}
run().catch(() => {
  console.error('Job processing failed.');
  process.exitCode = 1;
});
