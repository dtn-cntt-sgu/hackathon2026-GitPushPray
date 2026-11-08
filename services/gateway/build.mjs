import { build } from 'esbuild';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(ROOT, 'dist');

rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(DIST_DIR, { recursive: true });

await build({
  entryPoints: [join(ROOT, 'src', 'index.ts')],
  outfile: join(DIST_DIR, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

// Lambda coi .js là CommonJS nếu không có package.json; ghi rõ ESM cho bundle.
writeFileSync(join(DIST_DIR, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

console.log(`Built ${join(DIST_DIR, 'index.js')}`);
