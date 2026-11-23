import fs from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let rs: MongoMemoryReplSet | undefined;

export async function setup() {
  // Prefer a locally installed mongod (no download needed); fall back to mongodb-memory-server's download.
  const local = 'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe';
  if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync(local)) process.env.MONGOMS_SYSTEM_BINARY = local;
  if (process.env.TEST_MONGODB_URI) return; // externally provided replica set
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ launchTimeout: 120_000 }] });
  process.env.TEST_MONGODB_URI = rs.getUri();
}

export async function teardown() {
  await rs?.stop();
}
