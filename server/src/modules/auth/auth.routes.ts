import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { ModuleRouter, zId } from '../../utils/http.js';
import * as auth from './auth.service.js';
import { env } from '../../config/env.js';
import { clientIp } from '../../middlewares/index.js';
import { LoginEvent, User } from './auth.models.js';
import { unauthorized } from '../../utils/errors.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please wait and try again.' } },
});

export const authRoutes = new ModuleRouter('/auth', 'Authentication');
const r = authRoutes;

const cookieOpts = (expires?: Date) => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict' as const,
  path: '/',
  ...(expires ? { expires } : {}),
});

r.post(
  '/login',
  {
    summary: 'Sign in with username and password (and TOTP code if enabled). Sets an HttpOnly session cookie.',
    auth: false,
    status: 200,
    body: z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(256), totpCode: z.string().max(10).optional() }),
  },
  async ({ body, req, res }) => {
    const out = await auth.login(body, clientIp(req), String(req.headers['user-agent'] ?? '').slice(0, 300));
    res.cookie(auth.SESSION_COOKIE, out.token, cookieOpts(out.expiresAt));
    return { user: out.user, csrfToken: out.csrfToken, expiresAt: out.expiresAt };
  },
  [loginLimiter],
);

r.post('/logout', { summary: 'Sign out and revoke the current session', status: 200 }, async ({ ctx, res }) => {
  await auth.logout(ctx);
  res.clearCookie(auth.SESSION_COOKIE, cookieOpts());
  return { ok: true };
});

r.get('/me', { summary: 'Current user, permissions and CSRF token' }, async ({ ctx, req }) => {
  const user = await User.findById(ctx.userId).lean();
  if (!user) throw unauthorized();
  return { user: auth.publicUser(user), csrfToken: req.csrfToken };
});

r.post(
  '/change-password',
  { summary: 'Change own password (revokes all other sessions)', status: 200, body: z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1).max(256) }) },
  async ({ ctx, body }) => {
    await auth.changePassword(ctx, body.currentPassword, body.newPassword);
    return { ok: true };
  },
);

r.get('/sessions', { summary: 'Active sessions for the current user' }, async ({ ctx }) => auth.listSessions(ctx));
r.delete('/sessions/:id', { summary: 'Revoke a session' }, async ({ ctx, params }) => ({ revoked: await auth.revokeSession(ctx, zId.parse(params.id)) }));

r.get('/login-activity', { summary: 'Recent login attempts', permission: 'audit:read' }, async () => LoginEvent.find().sort({ at: -1 }).limit(100).lean());

r.post('/2fa/setup', { summary: 'Begin TOTP two-factor enrollment', status: 200 }, async ({ ctx }) => auth.beginTotpEnrollment(ctx));
r.post('/2fa/confirm', { summary: 'Confirm TOTP enrollment with a code', status: 200, body: z.object({ code: z.string().length(6) }) }, async ({ ctx, body }) => {
  await auth.confirmTotp(ctx, body.code);
  return { ok: true };
});
r.post('/2fa/disable', { summary: 'Disable two-factor authentication', status: 200, body: z.object({ password: z.string().min(1) }) }, async ({ ctx, body }) => {
  await auth.disableTotp(ctx, body.password);
  return { ok: true };
});
