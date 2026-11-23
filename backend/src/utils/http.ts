import { Router, type Request, type Response, type NextFunction } from 'express';
import { z, type ZodTypeAny } from 'zod';
import type { Types } from 'mongoose';
import type { Permission, Role } from '@autoparts/shared';
import { forbidden, unauthorized } from './errors.js';

export interface Ctx {
  userId: Types.ObjectId;
  userName: string;
  role: Role;
  permissions: Set<Permission> | '*';
  sessionId: Types.ObjectId;
  ip: string;
  userAgent: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    ctx?: Ctx;
  }
}

export function can(ctx: Ctx, permission: Permission) {
  return ctx.permissions === '*' || ctx.permissions.has(permission);
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface RouteDoc {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  permission?: Permission;
  auth: boolean;
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  status: number;
  headers?: string[];
}

/** Every route registered through `ModuleRouter` is recorded here and turned into OpenAPI docs. */
export const routeRegistry: RouteDoc[] = [];

interface RouteDef<B extends ZodTypeAny, Q extends ZodTypeAny> {
  summary: string;
  permission?: Permission;
  /** Set false for public endpoints (login, health). Defaults to true. */
  auth?: boolean;
  body?: B;
  query?: Q;
  status?: number;
  /** Handler writes the response itself (files, PDFs, CSV). */
  raw?: boolean;
  headers?: string[];
}

interface HandlerArgs<B, Q> {
  body: B;
  query: Q;
  params: Record<string, string>;
  ctx: Ctx;
  req: Request;
  res: Response;
}

export class ModuleRouter {
  readonly router = Router();
  constructor(
    readonly prefix: string,
    readonly tag: string,
  ) {}

  private add<B extends ZodTypeAny, Q extends ZodTypeAny>(
    method: Method,
    path: string,
    def: RouteDef<B, Q>,
    handler: (a: HandlerArgs<z.infer<B>, z.infer<Q>>) => Promise<unknown>,
    middlewares: ((req: Request, res: Response, next: NextFunction) => void)[] = [],
  ) {
    const auth = def.auth ?? true;
    routeRegistry.push({
      method,
      path: (this.prefix + path).replace(/:(\w+)/g, '{$1}').replace(/\/$/, '') || '/',
      tag: this.tag,
      summary: def.summary,
      permission: def.permission,
      auth,
      body: def.body,
      query: def.query,
      status: def.status ?? (method === 'post' ? 201 : 200),
      headers: def.headers,
    });
    this.router[method](path, ...middlewares, async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (auth && !req.ctx) throw unauthorized();
        if (def.permission && req.ctx && !can(req.ctx, def.permission)) throw forbidden();
        const body = def.body ? def.body.parse(req.body ?? {}) : req.body;
        const query = def.query ? def.query.parse(req.query) : req.query;
        const result = await handler({ body, query, params: req.params as Record<string, string>, ctx: req.ctx as Ctx, req, res });
        if (def.raw || res.headersSent) return;
        // An idempotent replay returns the original result with 200 OK (nothing new was created).
        const replayed = !!result && typeof result === 'object' && (result as { replayed?: unknown }).replayed === true;
        res.status(replayed ? 200 : (def.status ?? (method === 'post' ? 201 : 200))).json({ data: result ?? null });
      } catch (err) {
        next(err);
      }
    });
    return this;
  }

  get<Q extends ZodTypeAny = ZodTypeAny>(path: string, def: RouteDef<ZodTypeAny, Q>, h: (a: HandlerArgs<unknown, z.infer<Q>>) => Promise<unknown>, mw?: never[]) {
    return this.add('get', path, def, h as never, mw);
  }
  post<B extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny>(
    path: string,
    def: RouteDef<B, Q>,
    h: (a: HandlerArgs<z.infer<B>, z.infer<Q>>) => Promise<unknown>,
    mw?: ((req: Request, res: Response, next: NextFunction) => void)[],
  ) {
    return this.add('post', path, def, h, mw);
  }
  patch<B extends ZodTypeAny = ZodTypeAny>(path: string, def: RouteDef<B, ZodTypeAny>, h: (a: HandlerArgs<z.infer<B>, unknown>) => Promise<unknown>) {
    return this.add('patch', path, def, h as never);
  }
  delete(path: string, def: RouteDef<ZodTypeAny, ZodTypeAny>, h: (a: HandlerArgs<unknown, unknown>) => Promise<unknown>) {
    return this.add('delete', path, def, h as never);
  }
}

/** Common zod helpers. */
export const zId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const zCents = z.number().int('Amount must be in whole cents').nonnegative('Amount cannot be negative').max(1e13);
export const zQty = z.number().int('Quantity must be a whole number').positive('Quantity must be positive').max(1e7);
export const zDate = z.coerce.date();
export const zOptStr = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined));
