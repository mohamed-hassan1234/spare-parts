import { PERMISSIONS, ROLES, ROLE_PERMISSIONS, DEFAULT_WAREHOUSE_CODE } from '@autoparts/shared';
import type { Model } from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../modules/auth/auth.models.js';
import { DEFAULT_EXPENSE_CATEGORIES, ExpenseCategory } from '../modules/expenses/expenses.models.js';
import { Warehouse } from '../modules/inventory/inventory.models.js';
import { Account } from '../modules/ledger/ledger.models.js';
import { DEFAULT_ACCOUNTS } from '../modules/ledger/ledger.service.js';
import { Settings } from '../modules/settings/settings.model.js';
import { Migration } from '../modules/system/system.models.js';
import { bootstrap } from './index.js';
import { migrationStatus } from './migrations.js';

/**
 * Required system data only: never users, demo records or business transactions.
 * Existing records are left untouched, so owner edits (settings, renamed accounts) survive re-runs.
 * Roles and permissions are defined in code (`@autoparts/shared`), so they are verified, not stored.
 */
export interface SeedRow {
  collection: string;
  required: number;
  inserted: number;
  skipped: number;
  failed: number;
}

interface SeedGroup {
  collection: string;
  model: Model<any>;
  field: string;
  values: string[];
  collation?: { locale: string; strength: number };
}

const groups = (): SeedGroup[] => [
  { collection: 'chart_of_accounts', model: Account, field: 'code', values: DEFAULT_ACCOUNTS.map((a) => a.code) },
  { collection: 'warehouses', model: Warehouse, field: 'code', values: [DEFAULT_WAREHOUSE_CODE] },
  { collection: 'expense_categories', model: ExpenseCategory, field: 'name', values: DEFAULT_EXPENSE_CATEGORIES.map((c) => c.name), collation: { locale: 'en', strength: 2 } },
  { collection: 'business_settings', model: Settings, field: '_id', values: ['business'] },
];

async function missing(g: SeedGroup) {
  const out: string[] = [];
  for (const value of g.values) {
    const q = g.model
      .findOne({ [g.field]: value })
      .select('_id')
      .lean();
    if (g.collation) q.collation(g.collation);
    if (!(await q)) out.push(value);
  }
  return out;
}

export function assertSeedAllowed() {
  if (env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Refusing to seed with NODE_ENV=production. Take a backup, then set SEED_ALLOW_PRODUCTION=true for this one command.');
  }
}

export async function seedSystem(): Promise<SeedRow[]> {
  assertSeedAllowed();
  const all = groups();
  const before = await Promise.all(all.map(missing));
  await bootstrap();
  const after = await Promise.all(all.map(missing));
  return all.map((g, i) => ({
    collection: g.collection,
    required: g.values.length,
    inserted: before[i]!.length - after[i]!.length,
    skipped: g.values.length - before[i]!.length,
    failed: after[i]!.length,
  }));
}

export interface VerifyCheck {
  check: string;
  ok: boolean;
  detail: string;
}

/** Read-only check of everything the seed is responsible for. */
export async function verifySeed(): Promise<VerifyCheck[]> {
  const checks: VerifyCheck[] = [];
  const add = (check: string, ok: boolean, detail: string) => checks.push({ check, ok, detail });

  for (const g of groups()) {
    const absent = await missing(g);
    add(`${g.collection}: required records`, absent.length === 0, absent.length ? `missing ${absent.length}: ${absent.join(', ')}` : `${g.values.length} present`);
    const pipeline = [{ $match: { [g.field]: { $in: g.values } } }, { $group: { _id: `$${g.field}`, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }];
    const dupes = await g.model.aggregate(pipeline, g.collation ? { collation: g.collation } : {});
    add(`${g.collection}: no duplicates`, dupes.length === 0, dupes.length ? `${dupes.length} duplicated` : 'none');
  }

  const defaults = await Warehouse.countDocuments({ isDefault: true });
  add('warehouses: one default', defaults === 1, `${defaults} default`);

  const known = new Set<string>(PERMISSIONS);
  const badRoles = ROLES.filter((r) => {
    const p = ROLE_PERMISSIONS[r];
    return !p || (p !== '*' && p.some((x) => !known.has(x)));
  });
  add('roles: permissions valid', badRoles.length === 0, badRoles.length ? `invalid: ${badRoles.join(', ')}` : `${ROLES.length} roles, ${PERMISSIONS.length} permissions`);

  const pending = (await migrationStatus()).filter((m) => !m.applied);
  add('migrations: applied', pending.length === 0, pending.length ? `pending: ${pending.map((m) => m.id).join(', ')}` : `${await Migration.countDocuments()} applied`);

  const unknownRoles = await User.distinct('role', { role: { $nin: [...ROLES] } });
  add('users: valid roles', unknownRoles.length === 0, unknownRoles.length ? `unknown: ${unknownRoles.join(', ')}` : 'ok');
  return checks;
}
