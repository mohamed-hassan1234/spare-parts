#!/usr/bin/env node
/** Production start: the API also serves the built web app on one port. */
import fs from 'node:fs';
import path from 'node:path';
import { root, run } from './lib.mjs';

for (const f of ['backend/dist/index.js', 'frontend/dist/index.html']) {
  if (!fs.existsSync(path.join(root, f))) {
    console.error(`Missing ${f}. Run: npm run build`);
    process.exit(1);
  }
}
process.exit(await run('npm run start -w backend', { ...process.env, NODE_ENV: 'production' }));
