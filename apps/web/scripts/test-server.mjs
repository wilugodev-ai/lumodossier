import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const next = createRequire(import.meta.url).resolve('next/dist/bin/next');
const env = { ...process.env, LUMO_NEXT_DIST_DIR: '.next-test', NEXT_TELEMETRY_DISABLED: '1' };
function invoke(args) {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  return new Promise((ok, fail) => {
    child.once('error', fail);
    child.once('exit', (code) => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      if (code === 0) ok();
      else fail(new Error('Test web process exited.'));
    });
  });
}
await invoke(['scripts/pdf-assets.mjs']);
await invoke([next, 'build', '--webpack']);
await invoke([next, 'start', '--hostname', '127.0.0.1', '--port', '3029']);
