#!/usr/bin/env node
/** Safe to repeat: installs what is missing, creates absent .env files, never overwrites one. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkDb, envFiles, readEnv, root, run } from './lib.mjs';

const ok = (m) => console.log(`  [ok]   ${m}`);
const warn = (m) => console.log(`  [todo] ${m}`);
const fail = (m) => console.log(`  [fail] ${m}`);

export async function setup() {
  const problems = [];
  const todo = [];
  console.log('\nAutoParts ERP setup\n');

  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 9)) ok(`Node.js ${process.versions.node}`);
  else {
    fail(`Node.js ${process.versions.node} is too old (need 22.9 or newer)`);
    return { ok: false, problems: ['Install Node.js 22.9 or newer'], todo };
  }

  const linked = ['server', 'client', 'shared'].every((p) => fs.existsSync(path.join(root, 'node_modules', '@autoparts', p, 'package.json')));
  if (linked) ok('Dependencies installed');
  else {
    console.log('  Installing dependencies...');
    if ((await run('npm install')) !== 0) {
      fail('npm install failed');
      return { ok: false, problems: ['Fix the npm install error above'], todo };
    }
    ok('Dependencies installed');
  }

  if (envFiles.some((f) => fs.existsSync(f))) ok('Backend .env exists (not modified)');
  else {
    const text = fs
      .readFileSync(path.join(root, 'backend', '.env.example'), 'utf8')
      .replace(/^APP_SECRET=.*$/m, `APP_SECRET=${crypto.randomBytes(32).toString('hex')}`)
      .replace(/^BACKUP_ENCRYPTION_KEY=.*$/m, `BACKUP_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
    fs.writeFileSync(path.join(root, 'backend', '.env'), text, { flag: 'wx', mode: 0o600 });
    ok('Created backend/.env with newly generated secrets');
    todo.push('Keep a safe offline copy of BACKUP_ENCRYPTION_KEY from backend/.env. Backups cannot be restored without it.');
  }
  const frontendEnv = path.join(root, 'frontend', '.env');
  if (!fs.existsSync(frontendEnv)) {
    fs.copyFileSync(path.join(root, 'frontend', '.env.example'), frontendEnv, fs.constants.COPYFILE_EXCL);
    ok('Created frontend/.env');
  } else ok('frontend/.env exists (not modified)');

  const env = readEnv();
  if (!env.MONGODB_URI) problems.push('MONGODB_URI is empty');
  if (!env.APP_SECRET || env.APP_SECRET.length < 16 || /^(change-me|dev-only)/.test(env.APP_SECRET)) problems.push('APP_SECRET must be a long random value');
  if (!/^[0-9a-fA-F]{64}$/.test(env.BACKUP_ENCRYPTION_KEY ?? '')) todo.push('Set BACKUP_ENCRYPTION_KEY (64 hex characters) to enable backups.');
  if (problems.length) problems.forEach(fail);
  else ok('Required environment variables are valid');

  let db = { ok: false };
  if (env.MONGODB_URI) {
    db = await checkDb(env.MONGODB_URI);
    if (db.ok) ok(`MongoDB reachable (replica set ${db.replicaSet})`);
    else {
      warn(`MongoDB: ${db.error}`);
      todo.push('Start MongoDB in a second terminal: npm run dev:db');
    }
  }
  return { ok: problems.length === 0, dbOk: db.ok, problems, todo, env };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await setup();
  if (r.todo.length) {
    console.log('\nRemaining steps:');
    r.todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  }
  if (!r.ok) {
    console.log('\nSetup is NOT complete. Fix the items marked [fail], then run: npm run setup');
    process.exit(1);
  }
  console.log(r.dbOk ? '\nSetup complete. Next: npm run seed, npm run seed:verify, npm run dev' : '\nSetup finished, but the database is not ready yet. Start it, then run: npm run seed');
}
