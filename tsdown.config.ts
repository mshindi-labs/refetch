import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    retry: 'src/retry.ts',
    middleware: 'src/middleware.ts',
    pipe: 'src/pipe.ts',
  },
  format: ['esm', 'cjs'],
  // Keep the file names package.json already points at (.js/.d.ts for ESM, .cjs/.d.cts for CJS).
  outExtensions: ({ format }) => ({
    js: format === 'es' ? '.js' : '.cjs',
    dts: format === 'es' ? '.d.ts' : '.d.cts',
  }),
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
});
