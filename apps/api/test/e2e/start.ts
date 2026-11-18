import { fixture } from '../fixture';
import { authDouble } from './auth-double';
import { startRealAuth } from '../real-auth';
import { httpServer } from '../../src/http';
import { supabaseUserVerifier } from '../../src/providers';
import { Worker } from '../../src/jobs';
import { Problem } from '../../src/model';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
const SPACE = '7900f3d7-c514-4981-bfde-39276ad914ea',
  CUSTOMER = 'c06c78ed-2f82-4e5b-9431-f462f32935c7';
export async function startEnvironment(preview = false) {
  if (preview && !process.env.LUMO_GOTRUE_BINARY)
    throw Error('Set LUMO_GOTRUE_BINARY to a local Supabase Auth executable.');
  const webPort = preview ? 3040 : 3029,
    apiPort = preview ? 4040 : 4029,
    authPort = preview ? 4240 : 4229;
  const web = 'http://127.0.0.1:' + webPort,
    authOrigin = 'http://127.0.0.1:' + authPort;
  const f = await fixture(preview ? resolve(__dirname, '../../../../.local/preview') : undefined);
  let closeAuth: (() => Promise<void>) | undefined;
  try {
    if (process.env.LUMO_GOTRUE_BINARY) {
      const auth = await startRealAuth(f.url, web, authPort);
      closeAuth = auth.stop;
    } else {
      const auth = await authDouble(authPort);
      closeAuth = auth.close;
    }
    const services = {
      ...f.services,
      auth: supabaseUserVerifier(authOrigin, 'local-test-publishable-key'),
      webOrigin: web,
    };
    if (!preview)
      services.crm = {
        async spaces(who) {
          return who.email.endsWith('@example.invalid')
            ? [{ id: SPACE, name: 'Touchlumo test workspace', role: 'owner', source: 'touchlumo' }]
            : [];
        },
        async resolve(who, w, refs) {
          if (w !== SPACE || !who.email.endsWith('@example.invalid') || refs.customer !== CUSTOMER)
            throw new Problem(404, 'Customer unavailable.');
          return { name: 'Customer One', email: 'customer@example.invalid' };
        },
      };
    const api = await httpServer(f.db, services);
    await api.listen(apiPort, '127.0.0.1');
    let running = true;
    const worker = new Worker(f.db, services);
    const loop = (async () => {
      while (running) {
        await worker.drain(50).catch(() => console.error('Local worker will retry.'));
        await delay(180);
      }
    })();
    return {
      env: {
        NEXT_PUBLIC_API_ORIGIN: 'http://127.0.0.1:' + apiPort,
        NEXT_PUBLIC_SUPABASE_URL: authOrigin,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-test-publishable-key',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      async close() {
        running = false;
        await loop;
        await api.close();
        await closeAuth!();
        await f.close();
      },
    };
  } catch (e) {
    await closeAuth?.();
    await f.close();
    throw e;
  }
}
