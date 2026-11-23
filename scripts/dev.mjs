#!/usr/bin/env node
/** Starts the local database (when needed), API and web client together. Ctrl+C stops all of them. */
import { spawn, spawnSync } from 'node:child_process';
import { checkDb, isLocalUri, portInUse, readEnv, root } from './lib.mjs';

const env = readEnv();
const uri = env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/autoparts_erp?replicaSet=rs0';
const apiPort = Number(env.PORT ?? 4000);
const children = [];
let stopping = false;

for (const [name, port] of [
  ['API', apiPort],
  ['Web', 5173],
]) {
  if (await portInUse(port)) {
    console.error(`Port ${port} (${name}) is already in use. Stop that process, then run npm run dev again.`);
    process.exit(1);
  }
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGINT');
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function start(name, command) {
  const child = spawn(command, { cwd: root, shell: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const print = (stream, out) => {
    let tail = '';
    stream.on('data', (d) => {
      const lines = (tail + d).split(/\r?\n/);
      tail = lines.pop();
      for (const l of lines) if (name !== 'db' || !l.startsWith('{')) out.write(`[${name}] ${l}\n`);
    });
  };
  print(child.stdout, process.stdout);
  print(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${name}] exited (${code}). Stopping the other processes.`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

let db = await checkDb(uri);
if (!db.ok && isLocalUri(uri)) {
  console.log('Starting local MongoDB...');
  start('db', 'npm run dev:db --silent');
  for (let i = 0; i < 40 && !db.ok; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    db = await checkDb(uri);
  }
}
if (!db.ok) {
  console.error(`MongoDB is not ready: ${db.error}. See Troubleshooting in README.md.`);
  shutdown(1);
}

start('api', 'npm run dev -w backend');
start('web', 'npm run dev -w frontend');
console.log(`\n  Web app: http://localhost:5173\n  API:     http://localhost:${apiPort}/api\n  Docs:    http://localhost:${apiPort}/api/docs\n  Press Ctrl+C to stop.\n`);
