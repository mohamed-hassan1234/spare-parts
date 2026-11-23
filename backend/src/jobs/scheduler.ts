import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { Sale } from '../modules/sales/sales.models.js';
import { Purchase } from '../modules/purchases/purchases.models.js';
import { Product } from '../modules/catalog/catalog.models.js';
import { notify } from '../modules/system/audit.service.js';
import { inventoryReport } from '../modules/reports/reports.service.js';
import { createBackup } from '../modules/backup/backup.service.js';
import { BackupLog } from '../modules/system/system.models.js';
import { checkStockAlerts } from '../modules/sales/sales.service.js';

/** Periodic checks that raise notifications. Each job is idempotent (notifications are de-duplicated). */
export async function runAlertChecks() {
  const now = new Date();
  const overdue = await Sale.find({ balanceDue: { $gt: 0 }, dueDate: { $lt: now } })
    .select('invoiceNo customerName balanceDue dueDate')
    .lean();
  for (const s of overdue) {
    await notify({
      type: 'OVERDUE_INVOICE',
      severity: 'warning',
      title: `Invoice ${s.invoiceNo} is overdue`,
      message: `${s.customerName} owes ${(s.balanceDue / 100).toFixed(2)}, due ${s.dueDate!.toISOString().slice(0, 10)}.`,
      link: `/sales/${s._id}`,
      dedupeKey: `overdue:${s._id}`,
    });
  }
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const due = await Purchase.find({
    status: { $nin: ['DRAFT', 'CANCELLED'] },
    dueDate: { $lt: soon },
    $expr: { $gt: [{ $subtract: [{ $subtract: ['$receivedValue', '$returnedValue'] }, '$amountPaid'] }, 0] },
  })
    .select('purchaseNo dueDate receivedValue returnedValue amountPaid')
    .lean();
  for (const p of due) {
    const owed = p.receivedValue - p.returnedValue - p.amountPaid;
    await notify({
      type: 'SUPPLIER_PAYMENT_DUE',
      severity: p.dueDate! < now ? 'critical' : 'warning',
      title: `Supplier payment ${p.dueDate! < now ? 'overdue' : 'due soon'}: ${p.purchaseNo}`,
      message: `${(owed / 100).toFixed(2)} due ${p.dueDate!.toISOString().slice(0, 10)}.`,
      link: `/purchases/${p._id}`,
      dedupeKey: `apdue:${p._id}`,
    });
  }
  const inv = await inventoryReport();
  for (const d of inv.deadStock.slice(0, 50)) {
    await notify({
      type: 'DEAD_STOCK',
      severity: 'info',
      title: `${d.sku} has not sold in ${inv.deadStockDays}+ days`,
      message: `${d.onHand} units worth ${(d.value / 100).toFixed(2)} are tied up in ${d.name}.`,
      link: `/inventory/products/${d.productId}`,
      dedupeKey: `dead:${d.productId}`,
    });
  }
  await checkStockAlerts((await Product.find({ isActive: true }).distinct('_id')) as never);
}

export function startScheduler() {
  if (!env.JOBS_ENABLED || env.NODE_ENV === 'test') return () => undefined;
  const timers: NodeJS.Timeout[] = [];
  const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => logger.error({ err: e, job: name }, 'job failed'));
  setTimeout(safe('alerts', runAlertChecks), 15_000);
  timers.push(setInterval(safe('alerts', runAlertChecks), 60 * 60_000));
  if (env.BACKUP_SCHEDULE_HOURS > 0) {
    const backupIfDue = async () => {
      if (!env.BACKUP_ENCRYPTION_KEY) return;
      const last = await BackupLog.findOne({ status: 'SUCCEEDED', kind: { $in: ['SCHEDULED', 'MANUAL'] } })
        .sort({ createdAt: -1 })
        .lean();
      if (!last || Date.now() - last.createdAt.getTime() >= env.BACKUP_SCHEDULE_HOURS * 3_600_000) await createBackup('SCHEDULED');
    };
    timers.push(setInterval(safe('backup', backupIfDue), 15 * 60_000));
  }
  return () => timers.forEach(clearInterval);
}
