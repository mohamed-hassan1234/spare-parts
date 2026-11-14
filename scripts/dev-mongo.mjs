#!/usr/bin/env node
/**
 * Start a local single-node MongoDB replica set for development on port 27018
 * (transactions require a replica set). Data lives in ./.data/mongo.
 * Uses MONGOD_PATH, or `mongod` on PATH, or the default Windows install location.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, '.data', 'mongo');
fs.mkdirSync(dbPath, { recursive: true });

function findMongod() {
  if (process.env.MONGOD_PATH) return process.env.MONGOD_PATH;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['mongod'], { encoding: 'utf8' });
  if (which.status === 0) return which.stdout.split(/\r?\n/)[0].trim();
  if (process.platform === 'win32') {
    const base = 'C:\\Program Files\\MongoDB\\Server';
    if (fs.existsSync(base)) {
      const versions = fs.readdirSync(base).sort().reverse();
      for (const v of versions) {
        const p = path.join(base, v, 'bin', 'mongod.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  // Fall back to the binary that mongodb-memory-server (used by the test suite) caches.
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  for (const dir of [path.join(home, '.cache', 'mongodb-binaries'), path.join(root, 'node_modules', '.cache', 'mongodb-memory-server')]) {
    if (!fs.existsSync(dir)) continue;
    const bin = fs.readdirSync(dir).filter((f) => /^mongod.*(\.exe)?$/.test(f) && !f.endsWith('.md5')).sort().reverse()[0];
    if (bin) return path.join(dir, bin);
  }
  throw new Error('mongod not found. Install MongoDB 7+ or set MONGOD_PATH (or run `npm test -w server` once to download a cached binary).');
}

const mongod = findMongod();
const port = process.env.DEV_MONGO_PORT ?? '27018';
console.log(`Starting ${mongod} on 127.0.0.1:${port} (replSet rs0, data ${dbPath})`);
const child = spawn(mongod, ['--replSet', 'rs0', '--port', port, '--bind_ip', '127.0.0.1', '--dbpath', dbPath], { stdio: ['ignore', 'pipe', 'inherit'] });

let initiated = false;
child.stdout.on('data', async (buf) => {
  const s = buf.toString();
  if (!initiated && s.includes('Waiting for connections')) {
    initiated = true;
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`);
      await client.connect();
      try {
        await client.db('admin').command({ replSetGetStatus: 1 });
        console.log('Replica set rs0 already initialised.');
      } catch {
        await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${port}` }] } });
        console.log('Replica set rs0 initialised.');
      }
      await client.close();
      console.log(`Ready: MONGODB_URI=mongodb://127.0.0.1:${port}/autoparts_erp?replicaSet=rs0`);
    } catch (e) {
      console.error('Replica set init failed:', e.message);
    }
  }
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
