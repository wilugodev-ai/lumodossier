import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
const base = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const target = fileURLToPath(new URL('../public/pdfjs/', import.meta.url));
await mkdir(target, { recursive: true });
await Promise.all(
  ['cmaps', 'standard_fonts', 'wasm', 'iccs'].map((name) =>
    cp(path.join(base, name), path.join(target, name), { recursive: true }),
  ),
);
await cp(path.join(base, 'build/pdf.worker.min.mjs'), path.join(target, 'pdf.worker.min.mjs'));
await cp(path.join(base, 'LICENSE'), path.join(target, 'LICENSE'));
