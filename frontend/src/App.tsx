import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Permission } from '@autoparts/shared';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { EmptyState, LoadingBlock } from './components/common';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { ShieldAlert } from 'lucide-react';

/** Lazy-load a named export so each module becomes its own chunk. */
function lz<M>(loader: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await loader())[name] as unknown as ComponentType<any> }));
}
const catalog = () => import('./pages/catalog');
const inventory = () => import('./pages/inventory');
const purchases = () => import('./pages/purchases');
const sales = () => import('./pages/sales');
const pos = () => import('./pages/pos');
const customers = () => import('./pages/customers');
const finance = () => import('./pages/finance');
const reports = () => import('./pages/reports');
const warranty = () => import('./pages/warranty');
const admin = () => import('./pages/admin');

const P = {
  Dashboard: lz(() => import('./pages/Dashboard'), 'DashboardPage'),
  Products: lz(catalog, 'ProductsPage'),
  ProductForm: lz(catalog, 'ProductFormPage'),
  ProductDetail: lz(catalog, 'ProductDetailPage'),
  Categories: lz(catalog, 'CategoriesPage'),
  Brands: lz(catalog, 'BrandsPage'),
  Vehicles: lz(catalog, 'VehiclesPage'),
  Stock: lz(inventory, 'StockOverviewPage'),
  Movements: lz(inventory, 'MovementsPage'),
  Counts: lz(inventory, 'StockCountsPage'),
  Adjustments: lz(inventory, 'AdjustmentsPage'),
  LowStock: lz(inventory, 'LowStockPage'),
  Purchases: lz(purchases, 'PurchasesPage'),
  PurchaseForm: lz(purchases, 'PurchaseFormPage'),
  PurchaseDetail: lz(purchases, 'PurchaseDetailPage'),
  Receipts: lz(purchases, 'ReceiptsPage'),
  Suppliers: lz(purchases, 'SuppliersPage'),
  SupplierDetail: lz(purchases, 'SupplierDetailPage'),
  SupplierPayments: lz(purchases, 'SupplierPaymentsPage'),
  Pos: lz(pos, 'PosPage'),
  Sales: lz(sales, 'SalesPage'),
  Invoices: lz(sales, 'InvoicesPage'),
  SaleDetail: lz(sales, 'SaleDetailPage'),
  Returns: lz(sales, 'ReturnsPage'),
  Customers: lz(customers, 'CustomersPage'),
  CustomerDetail: lz(customers, 'CustomerDetailPage'),
  Statements: lz(customers, 'CustomerStatementsPage'),
  CustomerPayments: lz(customers, 'CustomerPaymentsPage'),
  FinanceDash: lz(finance, 'FinanceDashboardPage'),
  Expenses: lz(finance, 'ExpensesPage'),
  Receivables: lz(finance, 'ReceivablesPage'),
  Payables: lz(finance, 'PayablesPage'),
  Cash: lz(finance, 'CashAccountsPage'),
  Ledger: lz(finance, 'GeneralLedgerPage'),
  ProfitLoss: lz(finance, 'ProfitLossPage'),
  SalesReports: lz(reports, 'SalesReportsPage'),
  PurchaseReports: lz(reports, 'PurchaseReportsPage'),
  InventoryReports: lz(reports, 'InventoryReportsPage'),
  FinancialReports: lz(reports, 'FinancialReportsPage'),
  AiInsights: lz(reports, 'AiInsightsPage'),
  Warranty: lz(warranty, 'WarrantyPage'),
  SupplierReturns: lz(warranty, 'SupplierReturnsPage'),
  Notifications: lz(admin, 'NotificationsPage'),
  Audit: lz(admin, 'AuditLogsPage'),
  Backups: lz(admin, 'BackupsPage'),
  Settings: lz(admin, 'SettingsPage'),
  Security: lz(admin, 'SecurityPage'),
};

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="grid h-dvh place-items-center">
        <Spinner className="size-8" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

/** Client-side guard for UX only; every permission is enforced again by the API. */
function Guard({ perm, children }: { perm?: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (perm && !can(perm)) return <EmptyState icon={ShieldAlert} title="Access denied" description="Your role does not include permission to view this page." />;
  return <Suspense fallback={<LoadingBlock rows={8} />}>{children}</Suspense>;
}

function Home() {
  const { can } = useAuth();
  if (can('reports:read')) return <P.Dashboard />;
  if (can('sales:create')) return <Navigate to="/pos" replace />;
  return <Navigate to="/products" replace />;
}

const routes: [string, keyof typeof P, Permission?][] = [
  ['/products', 'Products', 'products:read'],
  ['/products/new', 'ProductForm', 'products:write'],
  ['/products/:id', 'ProductDetail', 'products:read'],
  ['/products/:id/edit', 'ProductForm', 'products:write'],
  ['/categories', 'Categories', 'products:read'],
  ['/brands', 'Brands', 'products:read'],
  ['/vehicles', 'Vehicles', 'products:read'],
  ['/inventory', 'Stock', 'inventory:read'],
  ['/inventory/movements', 'Movements', 'inventory:read'],
  ['/inventory/counts', 'Counts', 'inventory:read'],
  ['/inventory/adjustments', 'Adjustments', 'inventory:read'],
  ['/inventory/low-stock', 'LowStock', 'inventory:read'],
  ['/purchases', 'Purchases', 'purchases:read'],
  ['/purchases/new', 'PurchaseForm', 'purchases:write'],
  ['/purchases/receipts', 'Receipts', 'purchases:read'],
  ['/purchases/:id', 'PurchaseDetail', 'purchases:read'],
  ['/purchases/:id/edit', 'PurchaseForm', 'purchases:write'],
  ['/suppliers', 'Suppliers', 'suppliers:read'],
  ['/suppliers/:id', 'SupplierDetail', 'suppliers:read'],
  ['/supplier-payments', 'SupplierPayments', 'purchases:read'],
  ['/pos', 'Pos', 'sales:create'],
  ['/sales', 'Sales', 'sales:read'],
  ['/sales/:id', 'SaleDetail', 'sales:read'],
  ['/invoices', 'Invoices', 'sales:read'],
  ['/returns', 'Returns', 'sales:read'],
  ['/customers', 'Customers', 'customers:read'],
  ['/customers/statements', 'Statements', 'customers:read'],
  ['/customers/:id', 'CustomerDetail', 'customers:read'],
  ['/customer-payments', 'CustomerPayments', 'sales:read'],
  ['/finance', 'FinanceDash', 'finance:read'],
  ['/expenses', 'Expenses', 'expenses:read'],
  ['/finance/receivables', 'Receivables', 'reports:read'],
  ['/finance/payables', 'Payables', 'reports:read'],
  ['/finance/cash', 'Cash', 'finance:read'],
  ['/finance/ledger', 'Ledger', 'finance:read'],
  ['/finance/profit-loss', 'ProfitLoss', 'reports:read'],
  ['/reports/sales', 'SalesReports', 'reports:read'],
  ['/reports/purchases', 'PurchaseReports', 'reports:read'],
  ['/reports/inventory', 'InventoryReports', 'reports:read'],
  ['/reports/financial', 'FinancialReports', 'reports:read'],
  ['/reports/ai', 'AiInsights', 'reports:read'],
  ['/warranty', 'Warranty', 'warranty:read'],
  ['/supplier-returns', 'SupplierReturns', 'purchases:read'],
  ['/notifications', 'Notifications', 'notifications:read'],
  ['/audit-logs', 'Audit', 'audit:read'],
  ['/backups', 'Backups', 'backup:manage'],
  ['/settings', 'Settings', 'settings:read'],
  ['/security', 'Security'],
];

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <Guard>
              <Home />
            </Guard>
          }
        />
        {routes.map(([path, name, perm]) => {
          const C = P[name];
          return (
            <Route
              key={path}
              path={path}
              element={
                <Guard perm={perm}>
                  <C />
                </Guard>
              }
            />
          );
        })}
        <Route path="*" element={<EmptyState title="Page not found" description="The page you are looking for does not exist." />} />
      </Route>
    </Routes>
  );
}
