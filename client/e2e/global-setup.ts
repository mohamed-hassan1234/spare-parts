import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { E2E_ADMIN } from './fixtures';

/** Reset the isolated E2E database and create the Super Admin through the real CLI. */
export default async function globalSetup() {
  const uri = process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/autoparts_e2e?replicaSet=rs0';
  const dbName = new URL(uri).pathname.slice(1);
  if (!dbName.endsWith('_e2e')) throw new Error(`Refusing to reset "${dbName}": E2E database names must end with _e2e`);
  const client = await MongoClient.connect(uri);
  await client.db(dbName).dropDatabase();
  await client.close();
  const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server');
  execFileSync(process.execPath, [path.resolve(server, '../node_modules/tsx/dist/cli.mjs'), 'src/cli.ts', 'init-admin'], {
    cwd: server,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      MONGODB_URI: uri,
      INIT_ADMIN_USERNAME: E2E_ADMIN.username,
      INIT_ADMIN_FULLNAME: 'E2E Owner',
      INIT_ADMIN_PASSWORD: E2E_ADMIN.password,
      LOG_LEVEL: 'warn',
    },
  });
}
