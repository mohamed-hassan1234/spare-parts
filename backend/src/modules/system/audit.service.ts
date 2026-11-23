import type { ClientSession } from 'mongoose';
import { AuditLog, Notification, type NotificationDoc } from './system.models.js';
import type { Ctx } from '../../utils/http.js';
import { logger } from '../../utils/logger.js';

function strip(v: unknown): unknown {
  if (v == null) return v;
  const o = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  for (const k of ['passwordHash', 'totpSecret', 'tokenHash', 'csrfToken']) delete o[k];
  return o;
}

export async function audit(
  ctx: Partial<Ctx> | undefined,
  action: string,
  entity: string,
  entityId: unknown,
  opts: { summary?: string; before?: unknown; after?: unknown; session?: ClientSession } = {},
) {
  await AuditLog.create(
    [
      {
        userId: ctx?.userId,
        userName: ctx?.userName,
        action,
        entity,
        entityId: entityId != null ? String(entityId) : undefined,
        summary: opts.summary,
        before: strip(opts.before),
        after: strip(opts.after),
        ip: ctx?.ip,
        userAgent: ctx?.userAgent,
      },
    ],
    { session: opts.session },
  );
}

/** Create a notification unless an unread one with the same dedupe key already exists. */
export async function notify(n: Pick<NotificationDoc, 'type' | 'title' | 'message'> & Partial<Pick<NotificationDoc, 'severity' | 'link' | 'dedupeKey'>>) {
  try {
    if (n.dedupeKey) {
      const exists = await Notification.exists({ dedupeKey: n.dedupeKey, isRead: false });
      if (exists) return;
    }
    await Notification.create(n);
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) logger.error({ err: e }, 'failed to create notification');
  }
}
