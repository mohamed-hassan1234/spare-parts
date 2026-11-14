/**
 * Shared constants used by both the API server and the web client.
 * Money is always represented as integer minor units (cents) — never floats.
 */

export const ROLES = ['SUPER_ADMIN', 'MANAGER', 'CASHIER', 'STOREKEEPER', 'ACCOUNTANT'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'products:read',
  'products:write',
  'inventory:read',
  'inventory:adjust',
  'suppliers:read',
  'suppliers:write',
  'purchases:read',
  'purchases:write',
  'purchases:receive',
  'purchases:pay',
  'sales:read',
  'sales:create',
  'sales:discount',
  'sales:return',
  'customers:read',
  'customers:write',
  'customers:pay',
  'expenses:read',
  'expenses:write',
  'finance:read',
  'finance:write',
  'reports:read',
  'warranty:read',
  'warranty:write',
  'settings:read',
  'settings:write',
  'audit:read',
  'backup:manage',
  'notifications:read',
  'users:manage',
  'ai:use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Default role → permission map. SUPER_ADMIN implicitly holds every permission. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[] | '*'> = {
  SUPER_ADMIN: '*',
  MANAGER: PERMISSIONS.filter((p) => !['backup:manage', 'users:manage', 'settings:write'].includes(p)),
  CASHIER: ['products:read', 'inventory:read', 'sales:read', 'sales:create', 'customers:read', 'customers:write', 'customers:pay', 'notifications:read'],
  STOREKEEPER: ['products:read', 'products:write', 'inventory:read', 'inventory:adjust', 'purchases:read', 'purchases:receive', 'suppliers:read', 'notifications:read'],
  ACCOUNTANT: [
    'finance:read',
    'finance:write',
    'reports:read',
    'expenses:read',
    'expenses:write',
    'customers:read',
    'suppliers:read',
    'sales:read',
    'purchases:read',
    'purchases:pay',
    'customers:pay',
    'inventory:read',
    'notifications:read',
  ],
};

export const MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'SALE',
  'CUSTOMER_RETURN',
  'SUPPLIER_RETURN',
  'DAMAGE',
  'STOCK_ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RESERVATION',
  'RESERVATION_RELEASE',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'STORE_CREDIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PURCHASE_STATUSES = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'POSTED', 'CANCELLED'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const SALE_STATUSES = ['COMPLETED', 'PARTIALLY_RETURNED', 'RETURNED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const EXPENSE_KINDS = ['OPERATING', 'CAPITAL_EXPENDITURE', 'OWNER_DRAWING', 'LOAN_REPAYMENT'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export const RETURN_CONDITIONS = ['GOOD', 'DAMAGED', 'PENDING_INSPECTION'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const LANDED_COST_METHODS = ['VALUE', 'QUANTITY', 'WEIGHT', 'MANUAL'] as const;
export type LandedCostMethod = (typeof LANDED_COST_METHODS)[number];

/** Chart of accounts (codes are stable identifiers used by the ledger). */
export const ACCOUNTS = {
  CASH: '1000',
  BANK: '1010',
  MOBILE_MONEY: '1020',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY: '1200',
  QUARANTINE_INVENTORY: '1210',
  SUPPLIER_RECEIVABLE: '1300',
  FIXED_ASSETS: '1500',
  ACCOUNTS_PAYABLE: '2000',
  TAX_PAYABLE: '2100',
  CUSTOMER_CREDITS: '2200',
  LOANS_PAYABLE: '2300',
  OWNER_CAPITAL: '3000',
  OWNER_DRAWINGS: '3100',
  RETAINED_EARNINGS: '3200',
  OPENING_BALANCE_EQUITY: '3300',
  SALES_REVENUE: '4000',
  SALES_RETURNS: '4100',
  SALES_DISCOUNTS: '4200',
  OTHER_INCOME: '4900',
  COGS: '5000',
  INVENTORY_LOSS: '5100',
  OPERATING_EXPENSES: '6000',
  OTHER_EXPENSES: '7000',
} as const;
export type AccountCode = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];

export const PAYMENT_METHOD_ACCOUNT: Record<Exclude<PaymentMethod, 'STORE_CREDIT'>, AccountCode> = {
  CASH: ACCOUNTS.CASH,
  BANK_TRANSFER: ACCOUNTS.BANK,
  MOBILE_MONEY: ACCOUNTS.MOBILE_MONEY,
};

export const DEFAULT_WAREHOUSE_CODE = 'MAIN_SHOP';
export const DEFAULT_TIMEZONE = 'Africa/Mogadishu';
export const DEFAULT_CURRENCY = 'USD';

/** Format integer cents for display, e.g. 123456 → "1,234.56". */
export function formatCents(cents: number, currency = DEFAULT_CURRENCY): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${currency === 'USD' ? '$' : currency + ' '}${whole}.${frac}`;
}

/** Parse a user-entered decimal string ("12.5") into integer cents without float drift. */
export function parseToCents(input: string | number): number {
  const s = String(input).trim();
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) throw new Error(`Invalid money amount: ${input}`);
  const neg = s.startsWith('-');
  const [w, f = ''] = s.replace('-', '').split('.');
  const cents = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -cents : cents;
}
