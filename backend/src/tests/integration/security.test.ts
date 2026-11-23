import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { ROLE_PERMISSIONS, type Permission } from '@autoparts/shared';
import { expectOk, loginAsAdmin, useTestDb, type Api } from '../helpers.js';
import { routeRegistry } from '../../utils/http.js';
import { User } from '../../modules/auth/auth.models.js';
import { hashPassword } from '../../modules/auth/auth.service.js';
import { Notification } from '../../modules/system/system.models.js';
import { notify } from '../../modules/system/audit.service.js';

const t = useTestDb();
let admin: Api;
const CASHIER = { username: 'cashier1', password: 'Cashier-Passw0rd!' };

/** Fill route params with a syntactically valid id so the request reaches the permission check. */
const concrete = (p: string) => p.replace(/\{account\}/g, '1000').replace(/\{[^}]+\}/g, '000000000000000000000000');

beforeAll(async () => {
  admin = await loginAsAdmin(t.app);
  await User.create({ username: CASHIER.username, fullName: 'Test Cashier', role: 'CASHIER', passwordHash: await hashPassword(CASHIER.password), passwordChangedAt: new Date() });
});

describe('authorization matrix (every registered route)', () => {
  it('rejects every authenticated route without a session (401)', async () => {
    const protectedRoutes = routeRegistry.filter((r) => r.auth);
    expect(protectedRoutes.length).toBeGreaterThan(100);
    const failures: string[] = [];
    for (const r of protectedRoutes) {
      const client = request(t.app);
      const res = await client[r.method](`/api/v1${concrete(r.path)}`).send({});
      if (res.status !== 401) failures.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('a cashier is refused (403) on every route that needs a permission the role lacks', async () => {
    const agent = request.agent(t.app);
    const login = await agent.post('/api/v1/auth/login').send(CASHIER);
    expect(login.status).toBe(200);
    const csrf = login.body.data.csrfToken as string;
    const allowed = new Set(ROLE_PERMISSIONS.CASHIER as readonly Permission[]);
    const denied = routeRegistry.filter((r) => r.permission && !allowed.has(r.permission));
    expect(denied.length).toBeGreaterThan(60);
    const failures: string[] = [];
    for (const r of denied) {
      const res = await agent[r.method](`/api/v1${concrete(r.path)}`)
        .set('X-CSRF-Token', csrf)
        .send({});
      if (res.status !== 403) failures.push(`${r.method.toUpperCase()} ${r.path} [${r.permission}] → ${res.status}`);
    }
    expect(failures).toEqual([]);
    // …while the routes a cashier needs still work.
    expect((await agent.get('/api/v1/products')).status).toBe(200);
    expect((await agent.get('/api/v1/finance/trial-balance')).status).toBe(403);
    expect((await agent.post('/api/v1/expenses').set('X-CSRF-Token', csrf).send({})).status).toBe(403);
  });

  it('requires the CSRF token on every state-changing request', async () => {
    const res = await admin.agent.post('/api/v1/brands').send({ name: 'No CSRF' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
    expect((await admin.agent.post('/api/v1/brands').set('X-CSRF-Token', 'wrong').send({ name: 'Bad CSRF' })).status).toBe(403);
  });
});

describe('input validation and injection defences', () => {
  it('rejects MongoDB operator injection in bodies and query strings', async () => {
    const login = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ username: { $ne: null }, password: { $ne: null } });
    expect(login.status).toBe(400);
    const res = await admin.post('/products', { sku: { $gt: '' }, name: 'x', sellingPrice: 100 });
    expect(res.status).toBe(400);
    // Express 5's simple query parser never builds nested objects, so `[$ne]` cannot become an operator.
    const all = await admin.get('/products?status=all');
    const q = await admin.get('/products?status=all&categoryId[$ne]=x&search[$regex]=.*');
    expect(q.status).toBe(200);
    expect(q.body.data.total).toBe(all.body.data.total);
  });

  it('treats regex metacharacters in search as plain text', async () => {
    const res = await admin.get(`/products?search=${encodeURIComponent('.*(a+)+$')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it('rejects malformed JSON, floats for money, and unknown ids with safe messages', async () => {
    const bad = await admin.agent.post('/api/v1/brands').set('X-CSRF-Token', admin.csrf).set('Content-Type', 'application/json').send('{"name":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_JSON');
    expect((await admin.post('/products', { sku: 'FLOAT', name: 'Float', sellingPrice: 1.5 })).status).toBe(400);
    const missing = await admin.get('/products/000000000000000000000000');
    expect(missing.status).toBe(404);
    expect(JSON.stringify(missing.body)).not.toMatch(/stack|at .*\.ts/);
  });

  it('never exposes password hashes or TOTP secrets', async () => {
    const me = await admin.get('/auth/me');
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|totpSecret|\$argon2/);
  });
});

describe('secure file uploads', () => {
  it('accepts a real PDF expense attachment, rejects disguised files, and serves it only to authorised users', async () => {
    const rent = expectOk(await admin.get('/expense-categories')).find((c: { name: string }) => c.name === 'Shop Rent');
    const e = expectOk(await admin.post('/expenses', { categoryId: rent._id, description: 'Attachment test', amount: 100, date: new Date().toISOString(), method: 'CASH' }), 201);
    const fake = await admin.agent
      .post(`/api/v1/expenses/${e._id}/attachment`)
      .set('X-CSRF-Token', admin.csrf)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(fake.status).toBe(400);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const ok = await admin.agent.post(`/api/v1/expenses/${e._id}/attachment`).set('X-CSRF-Token', admin.csrf).attach('file', pdf, { filename: 'receipt.pdf', contentType: 'application/pdf' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.receiptUrl).toBe(`/api/v1/expenses/${e._id}/attachment`);
    const dl = await admin.agent.get(`/api/v1/expenses/${e._id}/attachment`);
    expect(dl.status).toBe(200);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect((await request(t.app).get(`/api/v1/expenses/${e._id}/attachment`)).status).toBe(401);
  });

  it('rejects a product image whose content is not an image', async () => {
    const p = expectOk(await admin.post('/products', { sku: 'IMG-1', name: 'Image test', sellingPrice: 100 }), 201);
    const res = await admin.agent
      .post(`/api/v1/products/${p._id}/image`)
      .set('X-CSRF-Token', admin.csrf)
      .attach('image', Buffer.from('GIF89a not really'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });
});

describe('product import (CSV and Excel)', () => {
  it('validates, then imports rows from an .xlsx file with exact money parsing', async () => {
    expectOk(await admin.post('/categories', { name: 'Import Cat' }), 201);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Products');
    ws.addRow(['sku', 'name', 'sellingPrice', 'category', 'openingQty', 'openingUnitCost']);
    ws.addRow(['XL-001', 'Excel Pad', '12.50', 'Import Cat', '4', '7.25']);
    ws.addRow(['XL-002', 'Bad Price', '1.234', 'Import Cat', '', '']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const send = (dry: boolean) => admin.agent.post(`/api/v1/products/import?dryRun=${dry}`).set('X-CSRF-Token', admin.csrf).attach('file', buf, { filename: 'p.xlsx' });
    const dry = expectOk(await send(true));
    expect(dry.results.map((r: { status: string }) => r.status)).toEqual(['valid', 'error']);
    const real = expectOk(await send(false));
    expect(real.created).toBe(1);
    const p = expectOk(await admin.get('/products?search=XL-001')).items[0];
    expect(p.sellingPrice).toBe(1_250);
    expect(p.qtyOnHand).toBe(4);
    const csv = Buffer.from('sku,name,sellingPrice\nCSV-001,Csv Item,3.10\n');
    const c = expectOk(await admin.agent.post('/api/v1/products/import').set('X-CSRF-Token', admin.csrf).attach('file', csv, { filename: 'p.csv' }));
    expect(c.created).toBe(1);
  });
});

describe('notifications', () => {
  it('de-duplicates unread alerts and allows a new one after it is read', async () => {
    await Notification.deleteMany({});
    await notify({ type: 'LOW_STOCK', title: 'Low', message: 'x', dedupeKey: 'dedupe-test' });
    await notify({ type: 'LOW_STOCK', title: 'Low', message: 'x', dedupeKey: 'dedupe-test' });
    expect(await Notification.countDocuments({ dedupeKey: 'dedupe-test' })).toBe(1);
    const list = expectOk(await admin.get('/notifications?unread=true'));
    expect(list.unread).toBe(1);
    expectOk(await admin.post(`/notifications/${list.items[0]._id}/read`));
    expect(expectOk(await admin.get('/notifications')).unread).toBe(0);
    await notify({ type: 'LOW_STOCK', title: 'Low', message: 'x', dedupeKey: 'dedupe-test' });
    expect(await Notification.countDocuments({ dedupeKey: 'dedupe-test' })).toBe(2);
  });
});

describe('two-factor authentication (TOTP)', () => {
  it('enrols, then requires a valid code at login, and can be disabled with the password', async () => {
    const { totpCode } = await import('../../modules/auth/totp.js');
    const user = { username: 'totp-user', password: 'Totp-Passw0rd!' };
    await User.create({ username: user.username, fullName: 'TOTP User', role: 'MANAGER', passwordHash: await hashPassword(user.password), passwordChangedAt: new Date() });
    const agent = request.agent(t.app);
    const csrf = (await agent.post('/api/v1/auth/login').send(user)).body.data.csrfToken as string;
    const setup = expectOk(await agent.post('/api/v1/auth/2fa/setup').set('X-CSRF-Token', csrf).send({}));
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect((await agent.post('/api/v1/auth/2fa/confirm').set('X-CSRF-Token', csrf).send({ code: '000000' })).status).toBe(422);
    expectOk(
      await agent
        .post('/api/v1/auth/2fa/confirm')
        .set('X-CSRF-Token', csrf)
        .send({ code: totpCode(setup.secret) }),
    );

    const noCode = await request(t.app).post('/api/v1/auth/login').send(user);
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('TOTP_REQUIRED');
    expect(
      (
        await request(t.app)
          .post('/api/v1/auth/login')
          .send({ ...user, totpCode: '123456' })
      ).status,
    ).toBe(401);
    const ok = await request(t.app)
      .post('/api/v1/auth/login')
      .send({ ...user, totpCode: totpCode(setup.secret) });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain(setup.secret);

    expect((await agent.post('/api/v1/auth/2fa/disable').set('X-CSRF-Token', csrf).send({ password: 'wrong-password' })).status).not.toBe(200);
    expectOk(await agent.post('/api/v1/auth/2fa/disable').set('X-CSRF-Token', csrf).send({ password: user.password }));
    expect((await request(t.app).post('/api/v1/auth/login').send(user)).status).toBe(200);
  });
});
