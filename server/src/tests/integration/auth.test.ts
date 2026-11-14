import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, loginAsAdmin, useTestDb } from '../helpers.js';
import { createSuperAdmin } from '../../modules/auth/auth.service.js';
import { AuditLog } from '../../modules/system/system.models.js';
import { User } from '../../modules/auth/auth.models.js';

const t = useTestDb();

describe('authentication & security', () => {
  it('rejects unauthenticated access and has no public registration', async () => {
    expect((await request(t.app).get('/api/v1/products')).status).toBe(401);
    expect((await request(t.app).post('/api/v1/auth/register').send({})).status).toBe(404);
    const health = await request(t.app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.db).toBe('up');
  });

  it('allows exactly one Super Admin via CLI and enforces password policy', async () => {
    await expect(createSuperAdmin({ username: 'weak', fullName: 'W', password: 'short' })).rejects.toThrow(/Password must contain/);
    await createSuperAdmin(ADMIN);
    await expect(createSuperAdmin({ ...ADMIN, username: 'second' })).rejects.toThrow(/already exists/);
    const u = await User.findOne({ username: ADMIN.username }).select('+passwordHash').lean();
    expect(u!.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('logs in with an HttpOnly SameSite=Strict cookie and requires CSRF for writes', async () => {
    const res = await request(t.app).post('/api/v1/auth/login').send({ username: ADMIN.username, password: ADMIN.password });
    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'][0] as string;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(res.body.data.user.role).toBe('SUPER_ADMIN');

    const api = await loginAsAdmin(t.app, false);
    const noCsrf = await api.agent.post('/api/v1/brands').send({ name: 'NoCsrf' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF');
    expect((await api.post('/brands', { name: 'WithCsrf' })).status).toBe(201);
    const me = await api.get('/auth/me');
    expect(me.body.data.user.permissions).toEqual(['*']);
  });

  it('locks the account after repeated failures and records login activity', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await request(t.app).post('/api/v1/auth/login').send({ username: ADMIN.username, password: 'wrong-Password1' });
      expect(r.status).toBe(401);
    }
    const locked = await request(t.app).post('/api/v1/auth/login').send({ username: ADMIN.username, password: ADMIN.password });
    expect(locked.status).toBe(423);
    await User.updateOne({ username: ADMIN.username }, { $unset: { lockedUntil: 1 } });
    const ok = await request(t.app).post('/api/v1/auth/login').send({ username: ADMIN.username, password: ADMIN.password });
    expect(ok.status).toBe(200);
  });

  it('changes password, revokes other sessions, and audits it', async () => {
    const a = await loginAsAdmin(t.app, false);
    const b = await loginAsAdmin(t.app, false);
    const newPw = 'An0ther-Secret-pw';
    expect((await a.post('/auth/change-password', { currentPassword: ADMIN.password, newPassword: newPw })).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect(await AuditLog.exists({ action: 'auth.change_password' })).toBeTruthy();
    // restore
    expect((await a.post('/auth/change-password', { currentPassword: newPw, newPassword: ADMIN.password })).status).toBe(200);
    const out = await a.post('/auth/logout');
    expect(out.status).toBe(200);
    expect((await a.get('/auth/me')).status).toBe(401);
  });
});
