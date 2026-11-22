// Bundles the API and the `kno` CLI to plain JS in dist/ (Story 6.4): workspace packages
// (@general-quiz/*, TypeScript sources) and JSON data are inlined; npm dependencies stay external.
import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const dist = new URL('./dist/', import.meta.url);
await rm(dist, { recursive: true, force: true });
await build({
  entryPoints: { server: 'src/server.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  plugins: [
    {
      name: 'external-npm-deps',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith('@general-quiz/') || args.path.endsWith('.json') ? undefined : { path: args.path, external: true }));
      },
    },
  ],
});
// Migrations are read at runtime next to the bundle (`./migrations`).
await cp(new URL('./src/db/migrations/', import.meta.url), new URL('./migrations/', dist), { recursive: true });
console.log('API built to dist');
