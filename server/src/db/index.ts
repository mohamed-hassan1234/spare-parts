import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ensureChartOfAccounts } from '../modules/ledger/ledger.service.js';
import { ensureDefaultWarehouse } from '../modules/inventory/inventory.service.js';
import { ensureExpenseCategories } from '../modules/expenses/expenses.service.js';
import { getSettings } from '../modules/settings/settings.model.js';
import { runMigrations } from './migrations.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: true });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error(
      'MongoDB must run as a replica set (transactions are required for financial integrity). ' +
        'For local development run `npm run dev:db` (single-node replica set on port 27018) and use ?replicaSet=rs0 in MONGODB_URI.',
    );
  }
  logger.info({ db: mongoose.connection.db!.databaseName, replicaSet: hello.setName }, 'MongoDB connected');
}

/** Idempotent system bootstrap: required reference data only — never business/demo data. */
export async function bootstrap() {
  // Create collections + indexes up front: collections cannot be created inside multi-document transactions on all versions.
  for (const m of Object.values(mongoose.models)) {
    await m.createCollection().catch(() => undefined);
    await m.syncIndexes().catch((e) => {
      // In tests an invalid index definition must fail loudly instead of silently disabling a uniqueness guarantee.
      if (env.NODE_ENV === 'test') throw e;
      logger.error({ model: m.modelName, err: (e as Error).message }, 'index sync failed');
    });
  }
  await ensureChartOfAccounts();
  await ensureDefaultWarehouse();
  await ensureExpenseCategories();
  await getSettings();
  await runMigrations();
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
