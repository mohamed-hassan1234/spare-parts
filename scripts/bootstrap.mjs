#!/usr/bin/env node
/** Full safe first-time initialisation. Idempotent; refuses production unless explicitly allowed. */
import { run } from './lib.mjs';
import { setup } from './setup.mjs';

const stop = (msg) => {
  console.error(`\nBootstrap stopped: ${msg}`);
  process.exit(1);
};

const r = await setup();
if (!r.ok) stop(r.problems.join('; '));
if (r.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') stop('NODE_ENV is production. Back up first, then set SEED_ALLOW_PRODUCTION=true for this command.');
if (!r.dbOk) stop('MongoDB is not ready. Run `npm run dev:db` in a second terminal, then run `npm run bootstrap` again.');

console.log('\nApplying required data and migrations...');
if ((await run('npm run seed --silent')) !== 0) stop('seeding failed (see the error above).');
console.log('\nVerifying...');
if ((await run('npm run seed:verify --silent')) !== 0) stop('verification failed (see the table above).');

r.todo.filter((t) => !t.startsWith('Start MongoDB')).forEach((t) => console.log(`Note: ${t}`));
console.log('\nBootstrap complete.');
console.log('If this is a new database, create the owner account: npm run init-admin');
console.log('Then start the app: npm run dev');
