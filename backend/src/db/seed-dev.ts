import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { Brand, Category, Compatibility, Vehicle } from '../modules/catalog/catalog.models.js';
import { Customer, Supplier } from '../modules/partners/partners.models.js';
import { User } from '../modules/auth/auth.models.js';
import { Sale } from '../modules/sales/sales.models.js';
import { ExpenseCategory } from '../modules/expenses/expenses.models.js';
import { createProduct } from '../modules/catalog/catalog.service.js';
import { createPurchase, paySupplier, receivePurchase } from '../modules/purchases/purchases.service.js';
import { checkout, receiveCustomerPayment } from '../modules/sales/sales.service.js';
import { createExpense, recordCashTransaction } from '../modules/expenses/expenses.service.js';
import { nextNumber } from '../modules/system/system.models.js';
import { permissionsFor } from '../modules/auth/auth.service.js';
import type { Ctx } from '../utils/http.js';

/**
 * DEVELOPMENT-ONLY demo data. All names and transactions are fictional.
 * Uses the real business services, so every record has valid stock movements and journal entries.
 */
export async function seedDev() {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  if (await Sale.exists({})) throw new Error('Database already has sales; demo seed only runs on an empty business database');
  const admin = await User.findOne({ role: 'SUPER_ADMIN' }).lean();
  if (!admin) throw new Error('Create the Super Admin first: npm run init-admin');
  const ctx: Ctx = {
    userId: admin._id,
    userName: `${admin.fullName} (seed)`,
    role: admin.role,
    permissions: permissionsFor(admin),
    sessionId: new Types.ObjectId(),
    ip: '127.0.0.1',
    userAgent: 'seed-dev',
  };

  const catNames = [
    'Engine Parts',
    'Brake Systems',
    'Suspension Parts',
    'Steering Parts',
    'Electrical Parts',
    'Filters',
    'Transmission Parts',
    'Cooling Systems',
    'Fuel Systems',
    'Body Parts',
    'Lighting',
    'Belts and Hoses',
    'Bearings',
    'Lubricants and Fluids',
    'Accessories',
  ];
  const cats: Record<string, Types.ObjectId> = {};
  for (const name of catNames) cats[name] = (await Category.findOneAndUpdate({ name, parentId: null }, { $setOnInsert: { name, parentId: null } }, { upsert: true, new: true }))!._id;
  const brandNames = ['Toyota Genuine', 'Nissan Genuine', 'NGK', 'Bosch', 'Denso', 'Exedy', 'Brembo', 'Delphi'];
  const brands: Record<string, Types.ObjectId> = {};
  for (const name of brandNames) brands[name] = (await Brand.findOneAndUpdate({ name }, { $setOnInsert: { name } }, { upsert: true, new: true }))!._id;

  const mkSupplier = async (name: string, extra: object) => Supplier.create({ code: await nextNumber('supplier', 'SUP-', undefined, 4), name, ...extra });
  const s1 = await mkSupplier('Demo Gulf Auto Parts Trading (fictional)', { contactPerson: 'A. Example', phone: '+971 00 000 0001', country: 'UAE', city: 'Dubai', paymentTermsDays: 30 });
  const s2 = await mkSupplier('Demo Horn Motors Supply (fictional)', { contactPerson: 'B. Example', phone: '+252 00 000 0002', country: 'Somalia', city: 'Mogadishu', paymentTermsDays: 15 });

  const mkCustomer = async (name: string, extra: object) => Customer.create({ code: await nextNumber('customer', 'CUS-', undefined, 5), name, ...extra });
  const c1 = await mkCustomer('Demo Garage One (fictional)', { type: 'GARAGE', phone: '+252 61 000 0101', creditLimit: 200_000, paymentTermsDays: 30 });
  const c2 = await mkCustomer('Demo Taxi Fleet (fictional)', { type: 'FLEET', phone: '+252 61 000 0102', creditLimit: 500_000, paymentTermsDays: 15 });
  await mkCustomer('Demo Individual Driver (fictional)', { type: 'INDIVIDUAL', phone: '+252 61 000 0103' });

  const P = async (sku: string, name: string, cat: string, brand: string, price: number, extra: object = {}) =>
    createProduct(
      {
        sku,
        name,
        categoryId: String(cats[cat]),
        brandId: String(brands[brand]),
        sellingPrice: price,
        minimumSellingPrice: Math.round(price * 0.8),
        oemPartNumbers: [],
        alternativePartNumbers: [],
        unit: 'pcs',
        warrantyMonths: 0,
        supplierIds: [String(s1._id)],
        reorderPoint: 5,
        reorderQuantity: 10,
        condition: 'NEW',
        isActive: true,
        ...extra,
      },
      ctx,
    );
  const products = [
    await P('TOY-BP-0446', 'Toyota Brake Pad Set (Front)', 'Brake Systems', 'Toyota Genuine', 4500, {
      manufacturerPartNumber: '04465-02220',
      oemPartNumbers: ['0446502220'],
      barcode: '4900000000011',
      warrantyMonths: 6,
      weightGrams: 1200,
    }),
    await P('NIS-OF-1520', 'Nissan Oil Filter', 'Filters', 'Nissan Genuine', 850, {
      manufacturerPartNumber: '15208-65F0E',
      oemPartNumbers: ['1520865F0E'],
      barcode: '4900000000028',
      weightGrams: 250,
    }),
    await P('HON-SP-IZF', 'Honda Spark Plug (Iridium)', 'Engine Parts', 'NGK', 1200, { manufacturerPartNumber: 'IZFR6K11', barcode: '4900000000035', weightGrams: 60 }),
    await P('HYU-AF-2811', 'Hyundai Air Filter', 'Filters', 'Bosch', 1400, { manufacturerPartNumber: '28113-2H000', barcode: '4900000000042', weightGrams: 300 }),
    await P('TOY-RAD-1640', 'Toyota Radiator', 'Cooling Systems', 'Denso', 18500, {
      manufacturerPartNumber: '16400-0T040',
      barcode: '4900000000059',
      warrantyMonths: 12,
      weightGrams: 5500,
      reorderPoint: 2,
      reorderQuantity: 3,
    }),
    await P('MIT-CK-MR98', 'Mitsubishi Clutch Kit', 'Transmission Parts', 'Exedy', 22000, {
      manufacturerPartNumber: 'MBK2004',
      barcode: '4900000000066',
      warrantyMonths: 12,
      weightGrams: 7000,
      reorderPoint: 2,
      reorderQuantity: 3,
    }),
    await P('FRD-BD-1850', 'Ford Brake Disc (Front)', 'Brake Systems', 'Brembo', 6500, { manufacturerPartNumber: '09.A185.10', barcode: '4900000000073', warrantyMonths: 6, weightGrams: 8000 }),
    await P('KIA-FP-3111', 'Kia Fuel Pump', 'Fuel Systems', 'Delphi', 9800, {
      manufacturerPartNumber: 'FG1093',
      barcode: '4900000000080',
      warrantyMonths: 12,
      weightGrams: 900,
      reorderPoint: 3,
      reorderQuantity: 5,
    }),
  ];
  const [brakePad, oilFilter, spark, airFilter, radiator, clutch, disc, fuelPump] = products;

  const corolla = await Vehicle.create({ make: 'Toyota', model: 'Corolla', generation: 'E170', yearFrom: 2014, yearTo: 2018, engineSize: '1.8L', engineCode: '2ZR-FE', fuelType: 'PETROL' });
  const sunny = await Vehicle.create({ make: 'Nissan', model: 'Sunny', generation: 'N17', yearFrom: 2012, yearTo: 2019, engineSize: '1.5L', engineCode: 'HR15DE', fuelType: 'PETROL' });
  await Compatibility.create([
    { productId: brakePad._id, vehicleId: corolla._id, source: 'MANUFACTURER_CATALOG', sourceReference: 'Demo catalogue p.12', verified: true },
    { productId: radiator._id, vehicleId: corolla._id, source: 'SUPPLIER_DATA', verified: false, notes: 'Unverified — check tank outlet position' },
    { productId: oilFilter._id, vehicleId: sunny._id, source: 'OEM_CROSS_REFERENCE', verified: true },
  ]);

  await recordCashTransaction({ type: 'CAPITAL_INJECTION', amount: 2_000_000, account: '1010', memo: 'Owner initial capital (demo)' }, ctx);
  await recordCashTransaction({ type: 'TRANSFER', amount: 300_000, account: '1000', fromAccount: '1010', memo: 'Cash float for till (demo)' }, ctx);

  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  const po1 = await createPurchase(
    {
      supplierId: String(s1._id),
      supplierInvoiceNo: 'DEMO-INV-1001',
      purchaseDate: day(40),
      freightCost: 15_000,
      customsCost: 10_000,
      otherCost: 0,
      allocationMethod: 'VALUE',
      submit: true,
      items: [
        { productId: String(brakePad._id), qtyOrdered: 20, unitPrice: 2500 },
        { productId: String(oilFilter._id), qtyOrdered: 50, unitPrice: 400 },
        { productId: String(spark._id), qtyOrdered: 40, unitPrice: 600 },
        { productId: String(airFilter._id), qtyOrdered: 30, unitPrice: 700 },
        { productId: String(disc._id), qtyOrdered: 10, unitPrice: 3800 },
      ],
    },
    ctx,
  );
  await receivePurchase(String(po1._id), { lines: po1.items.map((i) => ({ itemId: String(i._id), qty: i.qtyOrdered })), date: day(35) }, undefined, ctx);
  await paySupplier({ supplierId: String(s1._id), purchaseId: String(po1._id), amount: 60_000, method: 'BANK_TRANSFER', reference: 'DEMO-TT-01' }, undefined, ctx);

  const po2 = await createPurchase(
    {
      supplierId: String(s2._id),
      purchaseDate: day(20),
      freightCost: 8_000,
      customsCost: 0,
      otherCost: 2_000,
      allocationMethod: 'QUANTITY',
      submit: true,
      items: [
        { productId: String(radiator._id), qtyOrdered: 4, unitPrice: 11_000 },
        { productId: String(clutch._id), qtyOrdered: 4, unitPrice: 14_000 },
        { productId: String(fuelPump._id), qtyOrdered: 6, unitPrice: 5_500 },
      ],
    },
    ctx,
  );
  // Partial receipt: the clutch kits are still in transit.
  await receivePurchase(
    String(po2._id),
    { lines: po2.items.filter((i) => String(i.productId) !== String(clutch._id)).map((i) => ({ itemId: String(i._id), qty: i.qtyOrdered })), date: day(15) },
    undefined,
    ctx,
  );

  const sale = (
    key: string,
    items: { productId: Types.ObjectId; qty: number }[],
    payments: { method: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY'; amount: number }[],
    customerId?: Types.ObjectId,
    cartDiscount = 0,
  ) =>
    checkout({ customerId: customerId ? String(customerId) : undefined, items: items.map((i) => ({ productId: String(i.productId), qty: i.qty })), cartDiscount, payments }, `seed-sale-${key}`, ctx);
  await sale(
    '1',
    [
      { productId: brakePad._id, qty: 2 },
      { productId: oilFilter._id, qty: 3 },
    ],
    [{ method: 'CASH', amount: 2 * 4500 + 3 * 850 }],
  );
  await sale('2', [{ productId: spark._id, qty: 4 }], [{ method: 'MOBILE_MONEY', amount: 4800 }]);
  const credit = await sale(
    '3',
    [
      { productId: radiator._id, qty: 1 },
      { productId: disc._id, qty: 2 },
    ],
    [{ method: 'CASH', amount: 10_000 }],
    c1._id,
    500,
  );
  await sale(
    '4',
    [
      { productId: airFilter._id, qty: 5 },
      { productId: oilFilter._id, qty: 10 },
    ],
    [],
    c2._id,
  );
  await sale('5', [{ productId: fuelPump._id, qty: 1 }], [{ method: 'BANK_TRANSFER', amount: 9800 }]);
  await receiveCustomerPayment({ saleId: String(credit.sale._id), amount: 5_000, method: 'MOBILE_MONEY', reference: 'DEMO-MM-77' }, undefined, ctx);

  const cat = async (name: string) => String((await ExpenseCategory.findOne({ name }).lean())!._id);
  await createExpense({ categoryId: await cat('Shop Rent'), description: 'Monthly shop rent (demo)', amount: 60_000, date: day(10), method: 'BANK_TRANSFER' }, undefined, ctx);
  await createExpense({ categoryId: await cat('Electricity'), description: 'Electricity bill (demo)', amount: 8_500, date: day(8), method: 'CASH' }, undefined, ctx);
  await createExpense({ categoryId: await cat('Employee Salaries'), description: 'Shop assistant salary (demo)', amount: 30_000, date: day(5), method: 'CASH' }, undefined, ctx);

  return { products: products.length, suppliers: 2, customers: 3, purchases: 2, sales: 5, expenses: 3 };
}
