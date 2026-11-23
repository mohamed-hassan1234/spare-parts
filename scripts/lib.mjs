import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const envFiles = [path.join(root, '.env'), path.join(root, 'backend', '.env')];

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) v = v.slice(1, v.indexOf(q, 1));
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

/** Same precedence as the backend: root .env, then backend/.env, then real environment variables. */
export function readEnv() {
  const merged = {};
  for (const f of envFiles) if (fs.existsSync(f)) Object.assign(merged, parse(fs.readFileSync(f, 'utf8')));
  for (const [k, v] of Object.entries(process.env)) if (k in merged || k === 'NODE_ENV' || k === 'MONGODB_URI') merged[k] = v;
  return merged;
}

export function run(command, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: root, stdio: 'inherit', shell: true, env });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

export function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(800);
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('timeout', () => (s.destroy(), resolve(false)));
    s.once('error', () => resolve(false));
  });
}

/** Returns { ok, replicaSet, error }. The URI is never printed because it may contain a password. */
export async function checkDb(uri) {
  try {
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      const hello = await client.db('admin').command({ hello: 1 });
      return { ok: !!hello.setName, replicaSet: hello.setName, error: hello.setName ? undefined : 'MongoDB is not a replica set' };
    } finally {
      await client.close().catch(() => undefined);
    }
  } catch (e) {
    return { ok: false, error: e.code === 'ERR_MODULE_NOT_FOUND' ? 'dependencies are not installed' : 'database is not reachable' };
  }
}

export const isLocalUri = (uri = '') => /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri);
