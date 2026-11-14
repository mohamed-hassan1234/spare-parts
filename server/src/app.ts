import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import path from 'node:path';
import fs from 'node:fs';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { env, corsOrigins } from './config/env.js';
import { logger } from './utils/logger.js';
import { authenticate, csrfProtection, errorHandler, notFoundHandler } from './middlewares/index.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { catalogRoutes } from './modules/catalog/catalog.routes.js';
import { partnerRoutes } from './modules/partners/partners.routes.js';
import { purchaseRoutes } from './modules/purchases/purchases.routes.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { salesRoutes } from './modules/sales/sales.routes.js';
import { financeRoutes } from './modules/finance/finance.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { aiRoutes } from './modules/ai/ai.routes.js';
import { buildOpenApi } from './openapi.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)), credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'] }));
  if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/v1/health' } }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/v1/health', async (_req, res) => {
    const dbOk =
      mongoose.connection.readyState === 1 &&
      (await mongoose.connection
        .db!.admin()
        .ping()
        .then(() => true)
        .catch(() => false));
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ok' : 'degraded', db: dbOk ? 'up' : 'down', uptime: Math.round(process.uptime()), time: new Date().toISOString() });
  });

  app.use('/api', rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' ? 100_000 : env.RATE_LIMIT_PER_MINUTE, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/v1', authenticate, csrfProtection);

  const modules = [authRoutes, catalogRoutes, partnerRoutes, purchaseRoutes, inventoryRoutes, salesRoutes, financeRoutes, adminRoutes, aiRoutes];
  for (const m of modules) app.use(`/api/v1${m.prefix}`, m.router);

  const spec = buildOpenApi();
  app.get('/api/v1/openapi.json', (_req, res) => res.json(spec));
  app.use(
    '/api/docs',
    helmet.contentSecurityPolicy({ directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } }),
    swaggerUi.serve,
    swaggerUi.setup(spec),
  );

  app.use(
    '/uploads',
    express.static(path.resolve(env.UPLOAD_DIR), { fallthrough: false, index: false, dotfiles: 'deny', maxAge: '7d', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }),
  );
  app.use('/api', notFoundHandler);

  // Serve the built SPA in production (single origin, no CORS needed).
  const clientDist = path.resolve(process.cwd(), '../client/dist');
  if (env.NODE_ENV === 'production' && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
