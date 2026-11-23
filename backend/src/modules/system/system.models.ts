import { Schema, model, type ClientSession, Types } from 'mongoose';

/* ------------------------------------------------------------------ */
/* Counters — gap-free, transaction-safe document numbering            */
/* ------------------------------------------------------------------ */
const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
export const Counter = model<{ _id: string; seq: number }>('Counter', CounterSchema, 'counters');

/** Atomically increment a named sequence inside the caller's transaction. */
export async function nextSeq(name: string, session?: ClientSession): Promise<number> {
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
  return doc!.seq;
}

export async function nextNumber(name: string, prefix: string, session?: ClientSession, pad = 6) {
  const n = await nextSeq(name, session);
  return `${prefix}${String(n).padStart(pad, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Audit log — append-only                                             */
/* ------------------------------------------------------------------ */
export interface AuditLogDoc {
  _id: Types.ObjectId;
  at: Date;
  userId?: Types.ObjectId;
  userName?: string;
  action: string;
  entity: string;
  entityId?: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}
const AuditLogSchema = new Schema<AuditLogDoc>(
  {
    at: { type: Date, default: () => new Date(), index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    userName: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    summary: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ip: String,
    userAgent: String,
  },
  { versionKey: false },
);
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  AuditLogSchema.pre(op, function () {
    throw new Error('Audit logs are append-only');
  });
}
export const AuditLog = model<AuditLogDoc>('AuditLog', AuditLogSchema, 'audit_logs');

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */
export const NOTIFICATION_TYPES = [
  'LOW_STOCK',
  'OUT_OF_STOCK',
  'OVERDUE_INVOICE',
  'SUPPLIER_PAYMENT_DUE',
  'DEAD_STOCK',
  'TRANSACTION_FAILED',
  'BACKUP_FAILED',
  'BACKUP_SUCCEEDED',
  'SUSPICIOUS_LOGIN',
  'SYSTEM',
] as const;
export interface NotificationDoc {
  _id: Types.ObjectId;
  type: (typeof NOTIFICATION_TYPES)[number];
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  link?: string;
  /** De-duplication key: an unread notification with the same key is not created twice. */
  dedupeKey?: string;
  readAt?: Date;
  /** Mirrors `readAt` so the dedupe index can use a partial filter supported by MongoDB 7/8 (no $exists:false). */
  isRead: boolean;
  createdAt: Date;
}
const NotificationSchema = new Schema<NotificationDoc>(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: String,
    dedupeKey: String,
    readAt: Date,
    isRead: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
NotificationSchema.index({ isRead: 1, createdAt: -1 });
NotificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, isRead: false }, name: 'dedupe_unread' });
export const Notification = model<NotificationDoc>('Notification', NotificationSchema, 'notifications');

/* ------------------------------------------------------------------ */
/* Backup log                                                          */
/* ------------------------------------------------------------------ */
export interface BackupLogDoc {
  _id: Types.ObjectId;
  kind: 'MANUAL' | 'SCHEDULED' | 'PRE_RESTORE';
  status: 'SUCCEEDED' | 'FAILED';
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
  collections?: Record<string, number>;
  verified?: boolean;
  error?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const BackupLogSchema = new Schema<BackupLogDoc>(
  {
    kind: { type: String, enum: ['MANUAL', 'SCHEDULED', 'PRE_RESTORE'], required: true },
    status: { type: String, enum: ['SUCCEEDED', 'FAILED'], required: true },
    fileName: String,
    sizeBytes: Number,
    sha256: String,
    collections: Schema.Types.Mixed,
    verified: Boolean,
    error: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);
export const BackupLog = model<BackupLogDoc>('BackupLog', BackupLogSchema, 'backup_logs');

/* ------------------------------------------------------------------ */
/* Schema migrations                                                   */
/* ------------------------------------------------------------------ */
const MigrationSchema = new Schema({ _id: String, appliedAt: { type: Date, default: () => new Date() } }, { versionKey: false });
export const Migration = model<{ _id: string; appliedAt: Date }>('Migration', MigrationSchema, 'migrations');
