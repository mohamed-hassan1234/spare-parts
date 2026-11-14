import request from 'supertest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll } from 'vitest';
import type { Express } from 'express';
import { bootstrap } from '../db/index.js';
import { createApp } from '../app.js';
import { createSuperAdmin } from '../modules/auth/auth.service.js';
import { invalidateSettingsCache } from '../modules/settings/settings.model.js';
import { resetWarehouseCache } from '../modules/inventory/inventory.service.js';

export const ADMIN = { username: 'owner', fullName: 'Test Owner', password: 'Sup3rSecret!pw' };

/** One isolated database per test file. */
export function useTestDb() {
  const state: { app: Express } = {} as never;
  beforeAll(async () => {
    const base = process.env.TEST_MONGODB_URI!;
    const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const url = new URL(base);
    url.pathname = `/${dbName}`;
    await mongoose.connect(url.toString());
    invalidateSettingsCache();
    resetWarehouseCache();
    await bootstrap();
    state.app = createApp();
  });
  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await mongoose.disconnect();
  });
  return state;
}

export interface Api {
  get: (path: string) => request.Test;
  post: (path: string, body?: object, headers?: Record<string, string>) => request.Test;
  patch: (path: string, body?: object) => request.Test;
  del: (path: string) => request.Test;
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

export async function loginAsAdmin(app: Express, create = true): Promise<Api> {
  if (create) await createSuperAdmin(ADMIN).catch(() => undefined);
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ username: ADMIN.username, password: ADMIN.password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.data.csrfToken as string;
  const withCsrf = (t: request.Test) => t.set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    get: (p) => agent.get(`/api/v1${p}`),
    post: (p, body = {}, headers = {}) =>
      withCsrf(agent.post(`/api/v1${p}`))
        .set(headers)
        .send(body),
    patch: (p, body = {}) => withCsrf(agent.patch(`/api/v1${p}`)).send(body),
    del: (p) => withCsrf(agent.delete(`/api/v1${p}`)),
  };
}

export const key = () => `test-${randomUUID()}`;

export function expectOk(res: request.Response, status?: number) {
  if (status ? res.status !== status : res.status >= 300) {
    throw new Error(`Expected ${status ?? '2xx'} but got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}
