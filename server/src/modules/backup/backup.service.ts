import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { BackupLog } from '../system/system.models.js';
import { notify } from '../system/audit.service.js';
import { getSettings } from '../settings/settings.model.js';
import { logger } from '../../utils/logger.js';
import { unprocessable } from '../../utils/errors.js';

const MAGIC = Buffer.from('APBK1');
const { EJSON } = mongoose.mongo.BSON;

function key(): Buffer {
  const k = env.BACKUP_ENCRYPTION_KEY;
  if (!k || !/^[0-9a-fA-F]{64}$/.test(k)) throw unprocessable('BACKUP_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes) to create or read backups');
  return Buffer.from(k, 'hex');
}

const backupDir = () => {
  const d = path.resolve(env.BACKUP_DIR);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

interface Payload {
  version: 1;
  createdAt: string;
  database: string;
  collections: Record<string, unknown[]>;
}

export function encrypt(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(plain)), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function decrypt(file: Buffer): Buffer {
  if (!file.subarray(0, 5).equals(MAGIC)) throw new Error('Not an AutoParts ERP backup file');
  const iv = file.subarray(5, 17);
  const tag = file.subarray(17, 33);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return zlib.gunzipSync(Buffer.concat([d.update(file.subarray(33)), d.final()]));
}

/** Dump every collection to an encrypted, compressed, checksummed file and verify it reads back. */
export async function createBackup(kind: 'MANUAL' | 'SCHEDULED' | 'PRE_RESTORE', userId?: Types.ObjectId) {
  const db = mongoose.connection.db!;
  try {
    const cols = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !n.startsWith('system.'));
    const payload: Payload = { version: 1, createdAt: new Date().toISOString(), database: db.databaseName, collections: {} };
    const counts: Record<string, number> = {};
    for (const name of cols) {
      const docs = await db.collection(name).find({}).toArray();
      payload.collections[name] = docs;
      counts[name] = docs.length;
    }
    const file = encrypt(Buffer.from(EJSON.stringify(payload, { relaxed: false })));
    const stamp = payload.createdAt.replace(/[:.]/g, '-');
    const fileName = `autoparts-${kind.toLowerCase()}-${stamp}.apbk`;
    fs.writeFileSync(path.join(backupDir(), fileName), file);
    const sha256 = createHash('sha256').update(file).digest('hex');
    const verified = await verifyBackupFile(fileName, counts);
    const log = await BackupLog.create({ kind, status: 'SUCCEEDED', fileName, sizeBytes: file.length, sha256, collections: counts, verified, createdBy: userId });
    await applyRetention();
    return log.toObject();
  } catch (e) {
    logger.error({ err: e }, 'backup failed');
    await BackupLog.create({ kind, status: 'FAILED', error: (e as Error).message, createdBy: userId });
    await notify({ type: 'BACKUP_FAILED', severity: 'critical', title: 'Backup failed', message: (e as Error).message, link: '/admin/backups' });
    throw e;
  }
}

export function readBackup(fileName: string): Payload {
  const safe = path.basename(fileName);
  const buf = fs.readFileSync(path.join(backupDir(), safe));
  return EJSON.parse(decrypt(buf).toString('utf8'), { relaxed: false }) as Payload;
}

export async function verifyBackupFile(fileName: string, expected?: Record<string, number>) {
  try {
    const p = readBackup(fileName);
    if (Number(p.version) !== 1) return false; // canonical EJSON parses numbers as Int32
    if (expected) {
      for (const [k, n] of Object.entries(expected)) if ((p.collections[k]?.length ?? -1) !== n) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function applyRetention() {
  const s = await getSettings();
  const keep = s.backupRetentionCount ?? env.BACKUP_RETENTION_COUNT;
  const old = await BackupLog.find({ status: 'SUCCEEDED', kind: { $ne: 'PRE_RESTORE' }, fileName: { $exists: true } })
    .sort({ createdAt: -1 })
    .skip(keep)
    .lean();
  for (const o of old) {
    const p = path.join(backupDir(), path.basename(o.fileName!));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

export function backupFilePath(fileName: string) {
  const p = path.join(backupDir(), path.basename(fileName));
  return fs.existsSync(p) ? p : null;
}

/**
 * Restore a backup into `targetDb`. Restoring into the live database requires
 * `allowLive` and always takes a PRE_RESTORE backup first. Used only from the CLI.
 */
export async function restoreBackup(fileName: string, targetDb: string, opts: { allowLive?: boolean } = {}) {
  const live = mongoose.connection.db!.databaseName;
  if (targetDb === live && !opts.allowLive) throw new Error(`Refusing to overwrite the live database "${live}". Restore into a new database name, or pass --force-live after taking precautions.`);
  const payload = readBackup(fileName);
  if (targetDb === live) await createBackup('PRE_RESTORE');
  const target = mongoose.connection.getClient().db(targetDb);
  const existing = (await target.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  if (existing.length && targetDb !== live) throw new Error(`Target database "${targetDb}" is not empty`);
  const restored: Record<string, number> = {};
  for (const [name, docs] of Object.entries(payload.collections)) {
    if (targetDb === live) await target.collection(name).deleteMany({});
    if (docs.length) await target.collection(name).insertMany(docs as never[], { ordered: true });
    restored[name] = docs.length;
  }
  return { database: targetDb, restored, backupCreatedAt: payload.createdAt };
}
