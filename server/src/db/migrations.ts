import { Migration, Notification } from '../modules/system/system.models.js';
import { logger } from '../utils/logger.js';

/**
 * Versioned, forward-only schema migrations. Each runs once; its id is recorded
 * in the `migrations` collection. Add new entries at the end — never edit old ones.
 */
const MIGRATIONS: { id: string; description: string; up: () => Promise<void> }[] = [
  {
    id: '0001-initial-schema',
    description: 'Initial schema: collections and indexes are created by bootstrap()',
    up: async () => undefined,
  },
  {
    id: '0002-notification-isread-flag',
    description: 'Backfill Notification.isRead from readAt (dedupe index no longer uses $exists:false, unsupported on MongoDB 8.0)',
    up: async () => {
      await Notification.updateMany({ isRead: { $exists: false }, readAt: { $exists: true } }, { $set: { isRead: true } });
      await Notification.updateMany({ isRead: { $exists: false } }, { $set: { isRead: false } });
    },
  },
];

export async function runMigrations() {
  for (const m of MIGRATIONS) {
    if (await Migration.exists({ _id: m.id })) continue;
    logger.info({ id: m.id }, `Applying migration: ${m.description}`);
    await m.up();
    await Migration.create({ _id: m.id });
  }
}

export async function migrationStatus() {
  const applied = new Set((await Migration.find().lean()).map((m) => m._id));
  return MIGRATIONS.map((m) => ({ id: m.id, description: m.description, applied: applied.has(m.id) }));
}
