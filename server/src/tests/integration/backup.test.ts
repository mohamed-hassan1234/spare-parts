import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { expectOk, loginAsAdmin, useTestDb } from '../helpers.js';
import { restoreBackup, readBackup } from '../../modules/backup/backup.service.js';
import { env } from '../../config/env.js';

const t = useTestDb();

describe('backup & restore', () => {
  it('creates an encrypted, verified backup and restores it into a separate database', async () => {
    const api = await loginAsAdmin(t.app);
    expectOk(await api.post('/brands', { name: 'Backup Brand' }), 201);
    const log = expectOk(await api.post('/backups'), 201);
    expect(log.status).toBe('SUCCEEDED');
    expect(log.verified).toBe(true);
    const raw = fs.readFileSync(path.resolve(env.BACKUP_DIR, log.fileName));
    expect(raw.includes(Buffer.from('Backup Brand'))).toBe(false); // encrypted at rest
    expect(readBackup(log.fileName).collections.brands).toHaveLength(1);

    const live = mongoose.connection.db!.databaseName;
    await expect(restoreBackup(log.fileName, live)).rejects.toThrow(/Refusing to overwrite the live database/);
    const target = `${live}_restore`;
    const res = await restoreBackup(log.fileName, target);
    const restored = mongoose.connection.getClient().db(target);
    expect(await restored.collection('brands').countDocuments()).toBe(1);
    expect(await restored.collection('users').countDocuments()).toBe(1);
    expect(res.restored.chart_of_accounts).toBeGreaterThan(10);
    await expect(restoreBackup(log.fileName, target)).rejects.toThrow(/not empty/);
    await restored.dropDatabase();
    fs.unlinkSync(path.resolve(env.BACKUP_DIR, log.fileName));
  });
});
