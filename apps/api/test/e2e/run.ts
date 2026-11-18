import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { startEnvironment } from './start';

function finished(child: ChildProcess) {
  return new Promise<number>((ok, fail) => {
    child.once('error', fail);
    child.once('exit', (code) => ok(code ?? 1));
  });
}
async function run() {
  const preview = process.argv.includes('--preview'),
    root = resolve(__dirname, '../../../..'),
    web = resolve(root, 'apps/web');
  const harness = await startEnvironment(preview);
  try {
    if (preview) {
      const assets = spawn(process.execPath, ['scripts/pdf-assets.mjs'], {
        cwd: web,
        stdio: 'inherit',
        windowsHide: true,
      });
      if (await finished(assets)) throw Error('Could not prepare PDF preview assets.');
    }
    const argv = preview
      ? [
          require.resolve('next/dist/bin/next', { paths: [web] }),
          'dev',
          '--webpack',
          '--hostname',
          '127.0.0.1',
          '--port',
          '3040',
        ]
      : [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)];
    const child = spawn(process.execPath, argv, {
      cwd: preview ? web : root,
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...harness.env,
        ...(preview ? { LUMO_NEXT_DIST_DIR: '.next-preview', NEXT_PUBLIC_LOCAL_PREVIEW: 'true' } : {}),
      },
    });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      process.exitCode = await finished(child);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  } finally {
    await harness.close();
  }
}
run().catch((e) => {
  console.error(e instanceof Error ? e.message : 'The local environment could not start.');
  process.exitCode = 1;
});
