import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // The shared workspace package ships TypeScript source, so it must be bundled into the server build.
  noExternal: ['@autoparts/shared'],
});
