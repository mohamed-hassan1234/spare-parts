import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { resolveSession, SESSION_COOKIE } from '../modules/auth/auth.service.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { notify } from '../modules/system/audit.service.js';

declare module 'express-serve-static-core' {
  interface Request {
    csrfToken?: string;
  }
}

export function clientIp(req: Request) {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Attach `req.ctx` when a valid session cookie is present. Never rejects by itself. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    const resolved = await resolveSession(token, clientIp(req), String(req.headers['user-agent'] ?? '').slice(0, 300));
    if (resolved) {
      req.ctx = resolved.ctx;
      req.csrfToken = resolved.csrfToken;
    }
    next();
  } catch (e) {
    next(e);
  }
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated requests: every state-changing request
 * must echo the per-session token in `X-CSRF-Token`. Combined with SameSite=Strict
 * cookies and an explicit CORS allow-list.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method) || !req.ctx) return next();
  const header = req.headers['x-csrf-token'];
  if (typeof header !== 'string' || header !== req.csrfToken) {
    return res.status(403).json({ error: { code: 'CSRF', message: 'Missing or invalid CSRF token. Reload the page and try again.' } });
  }
  next();
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Some fields are invalid', details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })) } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` } });
  }
  const code = (err as { code?: number }).code;
  if (code === 11000) {
    const key = Object.keys((err as { keyValue?: object }).keyValue ?? {}).join(', ');
    return res.status(409).json({ error: { code: 'DUPLICATE', message: `A record with this ${key || 'value'} already exists` } });
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large' } });
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  if (req.method !== 'GET') {
    void notify({
      type: 'TRANSACTION_FAILED',
      severity: 'critical',
      title: 'A transaction failed',
      message: `${req.method} ${req.path} failed unexpectedly. No partial changes were saved. See server logs.`,
      dedupeKey: `txfail:${req.method}:${req.path}`,
    });
  }
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. The operation was not completed.' } });
}
