#!/usr/bin/env node
/**
 * Repeatable load test against an ISOLATED stack (database `autoparts_perf`, API on :4400).
 * Steps: reset DB → create admin (CLI) → seed demo data (CLI) → create a stocked product →
 * run concurrent requests → write docs/perf-results.json with median/p95/error rate and environment.
 *
 *   npm run dev:db      (in another terminal)
 *   node scripts/perf-test.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'backend');
const PORT = Number(process.env.PERF_PORT ?? 4400);
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const MONGO = process.env.PERF_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/autoparts_perf?replicaSet=rs0';
const ADMIN = { username: 'perf-owner', password: `Perf-${randomUUID().slice(0, 8)}-Aa1` };
const env = { ...process.env, NODE_ENV: 'development', MONGODB_URI: MONGO, PORT: String(PORT), JOBS_ENABLED: 'false', LOG_LEVEL: 'error', APP_SECRET: 'perf-only-secret-not-for-production', CORS_ORIGINS: 'http://localhost', LOGIN_MAX_ATTEMPTS: '1000', RATE_LIMIT_PER_MINUTE: '1000000' };
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');

const dbName = new URL(MONGO).pathname.slice(1);
if (!dbName.endsWith('_perf')) throw new Error('Refusing to run: the performance database name must end with _perf');

async function main() {
  const client = await MongoClient.connect(MONGO);
  await client.db(dbName).dropDatabase();
  const mongoVersion = (await client.db('admin').command({ buildInfo: 1 })).version;
  await client.close();
  const cli = (cmd, extra = {}) => execFileSync(process.execPath, [tsx, 'src/cli.ts', cmd], { cwd: server, env: { ...env, ...extra }, stdio: 'pipe' });
  cli('init-admin', { INIT_ADMIN_USERNAME: ADMIN.username, INIT_ADMIN_FULLNAME: 'Perf Owner', INIT_ADMIN_PASSWORD: ADMIN.password });
  cli('seed-dev');

  const api = spawn(process.execPath, [tsx, 'src/index.ts'], { cwd: server, env, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${BASE}/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const csrf = (await login.json()).data.csrfToken;
    const call = (p, opts = {}) => fetch(`${BASE}${p}`, { ...opts, headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });

    // A product with enough stock for the checkout load.
    const supplier = (await (await call('/suppliers?limit=1')).json()).data.items[0];
    const prod = (await (await call('/products', { method: 'POST', body: JSON.stringify({ sku: 'PERF-001', name: 'Perf test item', sellingPrice: 1000 }) })).json()).data;
    const po = (await (await call('/purchases', { method: 'POST', body: JSON.stringify({ supplierId: supplier._id, purchaseDate: new Date().toISOString(), submit: true, items: [{ productId: prod._id, qtyOrdered: 5000, unitPrice: 400 }] }) })).json()).data;
    await call(`/purchases/${po._id}/receive`, { method: 'POST', body: JSON.stringify({ lines: [{ itemId: po.items[0]._id, qty: 5000 }] }) });

    const scenarios = [
      { name: 'Product search (GET /products?search=)', n: 400, c: 10, run: (i) => call(`/products?search=${['brake', 'filter', 'TOY', '0446', 'pump'][i % 5]}`) },
      { name: 'Barcode lookup (GET /products/lookup)', n: 400, c: 10, run: () => call('/products/lookup?code=4900000000028') },
      { name: 'Dashboard KPIs (GET /dashboard/overview)', n: 100, c: 5, run: () => call('/dashboard/overview?period=thisMonth') },
      { name: 'Dashboard charts (GET /dashboard/charts)', n: 60, c: 5, run: () => call('/dashboard/charts?period=last30') },
      { name: 'Sales report (GET /reports/sales)', n: 60, c: 5, run: () => call('/reports/sales?period=all') },
      { name: 'Profit & loss (GET /reports/profit-loss)', n: 100, c: 5, run: () => call('/reports/profit-loss?period=all') },
      { name: 'Reconciliation (GET /finance/reconciliation)', n: 20, c: 2, run: () => call('/finance/reconciliation') },
      {
        name: 'POS checkout (POST /sales, 1 cashier, sequential)',
        n: 50,
        c: 1,
        run: () => call('/sales', { method: 'POST', headers: { 'Idempotency-Key': `perf-${randomUUID()}` }, body: JSON.stringify({ items: [{ productId: prod._id, qty: 1 }], payments: [{ method: 'CASH', amount: 1000 }] }) }),
      },
      {
        name: 'POS checkout (POST /sales, 3 tills in parallel)',
        n: 60,
        c: 3,
        run: () => call('/sales', { method: 'POST', headers: { 'Idempotency-Key': `perf-${randomUUID()}` }, body: JSON.stringify({ items: [{ productId: prod._id, qty: 1 }], payments: [{ method: 'CASH', amount: 1000 }] }) }),
      },
      {
        name: 'POS checkout (POST /sales, 10 concurrent on one product — stress)',
        n: 200,
        c: 10,
        run: () => call('/sales', { method: 'POST', headers: { 'Idempotency-Key': `perf-${randomUUID()}` }, body: JSON.stringify({ items: [{ productId: prod._id, qty: 1 }], payments: [{ method: 'CASH', amount: 1000 }] }) }),
      },
    ];

    const results = [];
    for (const s of scenarios) {
      const times = [];
      let errors = 0;
      let next = 0;
      const t0 = performance.now();
      await Promise.all(
        Array.from({ length: s.c }, async () => {
          while (next < s.n) {
            const i = next++;
            const start = performance.now();
            const res = await s.run(i).catch(() => null);
            if (res) await res.arrayBuffer();
            times.push(performance.now() - start);
            if (!res || !res.ok) errors++;
          }
        }),
      );
      const wall = (performance.now() - t0) / 1000;
      times.sort((a, b) => a - b);
      const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
      results.push({ scenario: s.name, requests: s.n, concurrency: s.c, medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), maxMs: +times[times.length - 1].toFixed(1), errorRatePct: +((errors / s.n) * 100).toFixed(2), throughputRps: +(s.n / wall).toFixed(1) });
      console.log(results.at(-1));
    }
    const recRes = await call('/finance/reconciliation');
    if (!recRes.ok) throw new Error(`reconciliation request failed: ${recRes.status}`);
    const rec = (await recRes.json()).data;
    const stock = (await (await call(`/products/${prod._id}`)).json()).data.qtyOnHand;
    const out = {
      ranAt: new Date().toISOString(),
      environment: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGb: +(os.totalmem() / 1024 ** 3).toFixed(1), node: process.version, mongodb: mongoVersion, topology: 'single-node replica set on the same machine as the API (localhost)' },
      results,
      integrityAfterLoad: { reconciliationOk: rec.ok, failedChecks: rec.checks.filter((c) => !c.ok).map((c) => c.name), perfProductStockAfter: stock, expectedStock: 5000 - 50 - 60 - 200 },
    };
    fs.writeFileSync(path.join(root, 'docs', 'perf-results.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out.integrityAfterLoad));
  } finally {
    api.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
