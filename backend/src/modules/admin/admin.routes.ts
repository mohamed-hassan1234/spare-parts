import { z } from 'zod';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ModuleRouter, zId, zOptStr } from '../../utils/http.js';
import { Settings, getSettings, invalidateSettingsCache } from '../settings/settings.model.js';
import { AuditLog, BackupLog, Notification } from '../system/system.models.js';
import { audit } from '../system/audit.service.js';
import { backupFilePath, createBackup, verifyBackupFile } from '../backup/backup.service.js';
import { PageQuery, escapeRegex, paginate } from '../../utils/pagination.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { env } from '../../config/env.js';

export const adminRoutes = new ModuleRouter('', 'Administration');
const r = adminRoutes;

/* -------------------------------- Settings ------------------------------ */
const SettingsBody = z
  .object({
    businessName: z.string().trim().min(2).max(120),
    address: zOptStr(300),
    phone: zOptStr(40),
    email: z
      .string()
      .trim()
      .email()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    receiptFooter: zOptStr(300),
    currency: z.string().trim().length(3).toUpperCase(),
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone'),
    invoicePrefix: z
      .string()
      .trim()
      .min(1)
      .max(10)
      .regex(/^[A-Z0-9-]+$/i),
    purchasePrefix: z
      .string()
      .trim()
      .min(1)
      .max(10)
      .regex(/^[A-Z0-9-]+$/i),
    taxRateBps: z.number().int().min(0).max(5000),
    taxName: z.string().trim().min(1).max(20),
    pricesIncludeTax: z.boolean(),
    returnPolicy: zOptStr(1000),
    warrantyPolicy: zOptStr(1000),
    returnWindowDays: z.number().int().min(0).max(365),
    lowStockDefault: z.number().int().min(0).max(100_000),
    deadStockDays: z.number().int().min(7).max(3650),
    allowDuplicateManufacturerPartNumbers: z.boolean(),
    maxDiscountBpsWithoutApproval: z.number().int().min(0).max(10_000),
    enforceMinimumPrice: z.boolean(),
    sessionIdleMinutes: z.number().int().min(5).max(1440),
    backupRetentionCount: z.number().int().min(1).max(365),
  })
  .partial();

r.get('/settings', { summary: 'Business settings', permission: 'settings:read' }, async () => getSettings());
r.get('/settings/public', { summary: 'Settings needed by every signed-in screen (name, currency, timezone)' }, async () => {
  const s = await getSettings();
  return {
    businessName: s.businessName,
    currency: s.currency,
    timezone: s.timezone,
    logoUrl: s.logoUrl,
    taxRateBps: s.taxRateBps,
    taxName: s.taxName,
    pricesIncludeTax: s.pricesIncludeTax,
    maxDiscountBpsWithoutApproval: s.maxDiscountBpsWithoutApproval,
    sessionIdleMinutes: s.sessionIdleMinutes,
  };
});
r.patch('/settings', { summary: 'Update business settings', permission: 'settings:write', body: SettingsBody }, async ({ body, ctx }) => {
  const before = await getSettings();
  const after = await Settings.findByIdAndUpdate('business', { $set: { ...body, updatedBy: ctx.userId } }, { new: true, upsert: true, runValidators: true }).lean();
  invalidateSettingsCache();
  await audit(ctx, 'settings.update', 'Settings', 'business', { before, after });
  return after;
});
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 }, fileFilter: (_q, f, cb) => cb(null, ['image/png', 'image/jpeg'].includes(f.mimetype)) });
r.post(
  '/settings/logo',
  { summary: 'Upload business logo (PNG/JPEG ≤ 1 MB)', permission: 'settings:write', status: 200 },
  async ({ req, ctx }) => {
    const f = req.file;
    if (!f) throw badRequest('Upload a PNG or JPEG in the "logo" field');
    const isPng = f.buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const isJpg = f.buffer[0] === 0xff && f.buffer[1] === 0xd8;
    if (!isPng && !isJpg) throw badRequest('File is not a valid PNG or JPEG');
    const dir = path.resolve(env.UPLOAD_DIR, 'branding');
    fs.mkdirSync(dir, { recursive: true });
    const name = `logo-${randomBytes(6).toString('hex')}.${isPng ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(dir, name), f.buffer);
    await Settings.updateOne({ _id: 'business' }, { $set: { logoUrl: `/uploads/branding/${name}`, updatedBy: ctx.userId } }, { upsert: true });
    invalidateSettingsCache();
    await audit(ctx, 'settings.logo', 'Settings', 'business', { summary: name });
    return getSettings();
  },
  [logoUpload.single('logo')],
);

/* ----------------------------- Notifications ---------------------------- */
r.get('/notifications', { summary: 'Notifications', permission: 'notifications:read', query: PageQuery.extend({ unread: z.enum(['true', 'false']).optional() }) }, async ({ query }) => {
  const f: Record<string, unknown> = {};
  if (query.unread === 'true') f.isRead = false;
  const page = await paginate(Notification, f, query, ['createdAt']);
  const unread = await Notification.countDocuments({ isRead: false });
  return { ...page, unread };
});
r.post('/notifications/:id/read', { summary: 'Mark notification read', permission: 'notifications:read', status: 200 }, async ({ params }) => {
  const n = await Notification.findByIdAndUpdate(zId.parse(params.id), { $set: { readAt: new Date(), isRead: true } }, { new: true }).lean();
  if (!n) throw notFound('Notification');
  return n;
});
r.post('/notifications/read-all', { summary: 'Mark all notifications read', permission: 'notifications:read', status: 200 }, async () => {
  const res = await Notification.updateMany({ isRead: false }, { $set: { readAt: new Date(), isRead: true } });
  return { updated: res.modifiedCount };
});

/* ------------------------------- Audit log ------------------------------ */
r.get(
  '/audit-logs',
  { summary: 'Audit trail of sensitive actions', permission: 'audit:read', query: PageQuery.extend({ entity: z.string().optional(), action: z.string().optional(), entityId: z.string().optional() }) },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.entity) f.entity = query.entity;
    if (query.entityId) f.entityId = query.entityId;
    if (query.action) f.action = new RegExp(`^${escapeRegex(query.action)}`);
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      f.$or = [{ summary: rx }, { action: rx }, { userName: rx }];
    }
    return paginate(AuditLog, f, query, ['at'], undefined, '-at');
  },
);

/* -------------------------------- Backups ------------------------------- */
r.get('/backups', { summary: 'Backup history', permission: 'backup:manage' }, async () => ({
  encryptionConfigured: !!env.BACKUP_ENCRYPTION_KEY,
  scheduleHours: env.BACKUP_SCHEDULE_HOURS,
  items: await BackupLog.find().sort({ createdAt: -1 }).limit(100).lean(),
}));
r.post('/backups', { summary: 'Create an encrypted backup now (verified after writing)', permission: 'backup:manage' }, async ({ ctx }) => {
  const log = await createBackup('MANUAL', ctx.userId);
  await audit(ctx, 'backup.create', 'Backup', log._id, { summary: log.fileName });
  return log;
});
r.post('/backups/:id/verify', { summary: 'Re-verify a backup file decrypts and matches its manifest', permission: 'backup:manage', status: 200 }, async ({ params, ctx }) => {
  const log = await BackupLog.findById(zId.parse(params.id)).lean();
  if (!log?.fileName) throw notFound('Backup');
  const ok = await verifyBackupFile(log.fileName, log.collections);
  await audit(ctx, 'backup.verify', 'Backup', log._id, { summary: `${log.fileName}: ${ok ? 'OK' : 'FAILED'}` });
  return { verified: ok };
});
r.get('/backups/:id/download', { summary: 'Download an encrypted backup file', permission: 'backup:manage', raw: true }, async ({ params, res, ctx }) => {
  const log = await BackupLog.findById(zId.parse(params.id)).lean();
  const p = log?.fileName ? backupFilePath(log.fileName) : null;
  if (!p) throw notFound('Backup file');
  await audit(ctx, 'backup.download', 'Backup', log!._id, { summary: log!.fileName });
  res.download(p);
});
