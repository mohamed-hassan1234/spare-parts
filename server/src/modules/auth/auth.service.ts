import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { ROLE_PERMISSIONS, type Permission } from '@autoparts/shared';
import { LoginEvent, Session, User, type UserDoc } from './auth.models.js';
import { env } from '../../config/env.js';
import { getSettings } from '../settings/settings.model.js';
import { audit, notify } from '../system/audit.service.js';
import { AppError, unauthorized, unprocessable } from '../../utils/errors.js';
import type { Ctx } from '../../utils/http.js';
import { generateSecret, otpauthUri, verifyTotp } from './totp.js';

export const SESSION_COOKIE = 'ap_sid';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function validatePasswordPolicy(pw: string) {
  const problems: string[] = [];
  if (pw.length < 10) problems.push('at least 10 characters');
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter');
  if (!/\d/.test(pw)) problems.push('a number');
  if (pw.length > 256) problems.push('at most 256 characters');
  if (problems.length) throw unprocessable(`Password must contain ${problems.join(', ')}`);
}

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON_OPTS);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function permissionsFor(user: Pick<UserDoc, 'role'>): Set<Permission> | '*' {
  const p = ROLE_PERMISSIONS[user.role];
  return p === '*' ? '*' : new Set(p);
}

/** A dummy hash so unknown usernames take the same time as wrong passwords. */
let dummyHash: string | null = null;

export async function login(input: { username: string; password: string; totpCode?: string }, ip: string, userAgent: string) {
  const username = input.username.trim().toLowerCase();
  const user = await User.findOne({ username }).select('+passwordHash +totpSecret');
  const fail = async (reason: string, status = 401, message = 'Invalid username or password') => {
    await LoginEvent.create({ username, userId: user?._id, success: false, reason, ip, userAgent });
    const recent = await LoginEvent.countDocuments({ success: false, ip, at: { $gte: new Date(Date.now() - 15 * 60_000) } });
    if (recent === 10) {
      await notify({
        type: 'SUSPICIOUS_LOGIN',
        severity: 'critical',
        title: 'Repeated failed logins',
        message: `10 failed login attempts from ${ip} in 15 minutes (last username tried: ${username}).`,
        link: '/admin/security',
        dedupeKey: `suspicious:${ip}`,
      });
    }
    return new AppError(status, 'LOGIN_FAILED', message);
  };

  if (!user) {
    dummyHash ??= await hashPassword('dummy-password-for-timing-1A');
    await argon2.verify(dummyHash, input.password).catch(() => false);
    throw await fail('unknown_user');
  }
  if (!user.isActive) throw await fail('inactive');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw await fail('locked', 423, `Account locked after repeated failed attempts. Try again after ${user.lockedUntil.toISOString()}.`);
  }
  const ok = await argon2.verify(user.passwordHash, input.password).catch(() => false);
  if (!ok) {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= env.LOGIN_MAX_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000);
      user.failedLoginCount = 0;
      await notify({
        type: 'SUSPICIOUS_LOGIN',
        severity: 'critical',
        title: 'Account locked',
        message: `Account "${user.username}" was locked after ${env.LOGIN_MAX_ATTEMPTS} failed login attempts from ${ip}.`,
        link: '/admin/security',
      });
    }
    await user.save();
    throw await fail('bad_password');
  }
  if (user.totpEnabled) {
    if (!input.totpCode) throw new AppError(401, 'TOTP_REQUIRED', 'Enter the 6-digit code from your authenticator app');
    if (!verifyTotp(user.totpSecret!, input.totpCode)) throw await fail('bad_totp', 401, 'Invalid authentication code');
  }
  // Rehash if parameters changed.
  if (argon2.needsRehash(user.passwordHash, ARGON_OPTS)) user.passwordHash = await hashPassword(input.password);
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(24).toString('base64url');
  const now = new Date();
  const session = await Session.create({
    userId: user._id,
    tokenHash: sha256(token),
    csrfToken,
    ip,
    userAgent,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + env.SESSION_TTL_HOURS * 3_600_000),
  });
  await LoginEvent.create({ username, userId: user._id, success: true, ip, userAgent });
  await audit({ userId: user._id, userName: user.fullName, ip, userAgent }, 'auth.login', 'Session', session._id);
  return { token, csrfToken, user: publicUser(user), expiresAt: session.expiresAt };
}

export function publicUser(u: Pick<UserDoc, '_id' | 'username' | 'fullName' | 'email' | 'role' | 'totpEnabled' | 'lastLoginAt'>) {
  const perms = permissionsFor(u);
  return {
    id: String(u._id),
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    totpEnabled: u.totpEnabled,
    lastLoginAt: u.lastLoginAt,
    permissions: perms === '*' ? ['*'] : [...perms],
  };
}

/** Resolve a session token into a request context. Enforces absolute and idle expiry. */
export async function resolveSession(token: string | undefined, ip: string, userAgent: string): Promise<{ ctx: Ctx; csrfToken: string } | null> {
  if (!token) return null;
  const session = await Session.findOne({ tokenHash: sha256(token), revokedAt: { $exists: false } });
  if (!session) return null;
  const now = Date.now();
  const settings = await getSettings();
  const idleMs = (settings.sessionIdleMinutes ?? env.SESSION_IDLE_MINUTES) * 60_000;
  if (session.expiresAt.getTime() < now || session.lastSeenAt.getTime() + idleMs < now) {
    session.revokedAt = new Date();
    await session.save();
    return null;
  }
  const user = await User.findById(session.userId).lean();
  if (!user || !user.isActive) return null;
  if (now - session.lastSeenAt.getTime() > 30_000) {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  }
  return {
    csrfToken: session.csrfToken,
    ctx: { userId: user._id, userName: user.fullName, role: user.role, permissions: permissionsFor(user), sessionId: session._id, ip, userAgent },
  };
}

export async function logout(ctx: Ctx) {
  await Session.updateOne({ _id: ctx.sessionId }, { $set: { revokedAt: new Date() } });
  await audit(ctx, 'auth.logout', 'Session', ctx.sessionId);
}

export async function changePassword(ctx: Ctx, currentPassword: string, newPassword: string) {
  const user = await User.findById(ctx.userId).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await argon2.verify(user.passwordHash, currentPassword))) throw unprocessable('Current password is incorrect');
  if (currentPassword === newPassword) throw unprocessable('New password must be different');
  validatePasswordPolicy(newPassword);
  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  await user.save();
  // Sign out every other session.
  await Session.updateMany({ userId: user._id, _id: { $ne: ctx.sessionId }, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  await audit(ctx, 'auth.change_password', 'User', user._id, { summary: 'Password changed; other sessions revoked' });
}

export async function listSessions(ctx: Ctx) {
  const rows = await Session.find({ userId: ctx.userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 })
    .lean();
  return rows.map((s) => ({ id: s._id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, current: String(s._id) === String(ctx.sessionId) }));
}

export async function revokeSession(ctx: Ctx, id: string) {
  const r = await Session.updateOne({ _id: new Types.ObjectId(id), userId: ctx.userId }, { $set: { revokedAt: new Date() } });
  await audit(ctx, 'auth.revoke_session', 'Session', id);
  return r.modifiedCount === 1;
}

export async function beginTotpEnrollment(ctx: Ctx) {
  const user = await User.findById(ctx.userId);
  if (!user) throw unauthorized();
  if (user.totpEnabled) throw unprocessable('Two-factor authentication is already enabled');
  const secret = generateSecret();
  user.totpSecret = secret;
  await user.save();
  return { secret, otpauthUri: otpauthUri(secret, user.username) };
}

export async function confirmTotp(ctx: Ctx, code: string) {
  const user = await User.findById(ctx.userId).select('+totpSecret');
  if (!user?.totpSecret) throw unprocessable('Start two-factor enrollment first');
  if (!verifyTotp(user.totpSecret, code)) throw unprocessable('Invalid code — check your device clock and try again');
  user.totpEnabled = true;
  await user.save();
  await audit(ctx, 'auth.totp_enabled', 'User', user._id);
}

export async function disableTotp(ctx: Ctx, password: string) {
  const user = await User.findById(ctx.userId).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await argon2.verify(user.passwordHash, password))) throw unprocessable('Password is incorrect');
  user.totpEnabled = false;
  user.totpSecret = undefined;
  await user.save();
  await audit(ctx, 'auth.totp_disabled', 'User', user._id);
}

/** Used by the CLI only. */
export async function createSuperAdmin(input: { username: string; fullName: string; email?: string; password: string }) {
  const existing = await User.countDocuments({ role: 'SUPER_ADMIN' });
  if (existing > 0) throw new Error('A Super Admin already exists. Use reset-password to recover access.');
  validatePasswordPolicy(input.password);
  const user = await User.create({
    username: input.username,
    fullName: input.fullName,
    email: input.email,
    role: 'SUPER_ADMIN',
    passwordHash: await hashPassword(input.password),
    passwordChangedAt: new Date(),
  });
  await audit({ userName: 'CLI' }, 'auth.init_admin', 'User', user._id, { summary: `Super Admin ${user.username} created` });
  return user;
}

export async function resetPasswordCli(username: string, password: string) {
  validatePasswordPolicy(password);
  const user = await User.findOne({ username: username.toLowerCase() });
  if (!user) throw new Error(`No user named ${username}`);
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  await user.save();
  await Session.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  await audit({ userName: 'CLI' }, 'auth.reset_password', 'User', user._id, { summary: 'Password reset from server console; all sessions revoked' });
}
