import type { Permission } from '@autoparts/shared';
import { LayoutDashboard, Package, Boxes, ShoppingCart, Receipt, Users, Landmark, BarChart3, ShieldCheck, Settings } from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  permission?: Permission;
}
export interface NavGroup {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to?: string;
  permission?: Permission;
  items?: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/', permission: 'reports:read' },
  {
    label: 'Products',
    icon: Package,
    items: [
      { label: 'All Products', to: '/products', permission: 'products:read' },
      { label: 'Categories', to: '/categories', permission: 'products:read' },
      { label: 'Brands', to: '/brands', permission: 'products:read' },
      { label: 'Vehicle Compatibility', to: '/vehicles', permission: 'products:read' },
    ],
  },
  {
    label: 'Inventory',
    icon: Boxes,
    items: [
      { label: 'Stock Overview', to: '/inventory', permission: 'inventory:read' },
      { label: 'Stock Movements', to: '/inventory/movements', permission: 'inventory:read' },
      { label: 'Stock Counts', to: '/inventory/counts', permission: 'inventory:read' },
      { label: 'Stock Adjustments', to: '/inventory/adjustments', permission: 'inventory:read' },
      { label: 'Low Stock', to: '/inventory/low-stock', permission: 'inventory:read' },
    ],
  },
  {
    label: 'Purchases',
    icon: ShoppingCart,
    items: [
      { label: 'All Purchases', to: '/purchases', permission: 'purchases:read' },
      { label: 'New Purchase', to: '/purchases/new', permission: 'purchases:write' },
      { label: 'Purchase Receipts', to: '/purchases/receipts', permission: 'purchases:read' },
      { label: 'Suppliers', to: '/suppliers', permission: 'suppliers:read' },
      { label: 'Supplier Payments', to: '/supplier-payments', permission: 'purchases:read' },
    ],
  },
  {
    label: 'Sales',
    icon: Receipt,
    items: [
      { label: 'Point of Sale', to: '/pos', permission: 'sales:create' },
      { label: 'Sales History', to: '/sales', permission: 'sales:read' },
      { label: 'Invoices', to: '/invoices', permission: 'sales:read' },
      { label: 'Customer Returns', to: '/returns', permission: 'sales:read' },
    ],
  },
  {
    label: 'Customers',
    icon: Users,
    items: [
      { label: 'All Customers', to: '/customers', permission: 'customers:read' },
      { label: 'Customer Statements', to: '/customers/statements', permission: 'customers:read' },
      { label: 'Customer Payments', to: '/customer-payments', permission: 'sales:read' },
    ],
  },
  {
    label: 'Finance',
    icon: Landmark,
    items: [
      { label: 'Financial Dashboard', to: '/finance', permission: 'finance:read' },
      { label: 'Expenses', to: '/expenses', permission: 'expenses:read' },
      { label: 'Customer Debts', to: '/finance/receivables', permission: 'reports:read' },
      { label: 'Supplier Debts', to: '/finance/payables', permission: 'reports:read' },
      { label: 'Cash Accounts', to: '/finance/cash', permission: 'finance:read' },
      { label: 'General Ledger', to: '/finance/ledger', permission: 'finance:read' },
      { label: 'Profit and Loss', to: '/finance/profit-loss', permission: 'reports:read' },
    ],
  },
  {
    label: 'Reports',
    icon: BarChart3,
    items: [
      { label: 'Sales Reports', to: '/reports/sales', permission: 'reports:read' },
      { label: 'Purchase Reports', to: '/reports/purchases', permission: 'reports:read' },
      { label: 'Inventory Reports', to: '/reports/inventory', permission: 'reports:read' },
      { label: 'Financial Reports', to: '/reports/financial', permission: 'reports:read' },
      { label: 'AI Insights', to: '/reports/ai', permission: 'reports:read' },
    ],
  },
  {
    label: 'Warranty',
    icon: ShieldCheck,
    items: [
      { label: 'Warranty Claims', to: '/warranty', permission: 'warranty:read' },
      { label: 'Supplier Returns', to: '/supplier-returns', permission: 'purchases:read' },
    ],
  },
  {
    label: 'Administration',
    icon: Settings,
    items: [
      { label: 'Notifications', to: '/notifications', permission: 'notifications:read' },
      { label: 'Audit Logs', to: '/audit-logs', permission: 'audit:read' },
      { label: 'Backup and Restore', to: '/backups', permission: 'backup:manage' },
      { label: 'Business Settings', to: '/settings', permission: 'settings:read' },
      { label: 'Security Settings', to: '/security' },
    ],
  },
];
