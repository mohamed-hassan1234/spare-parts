import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { bootstrap, connectDb, disconnectDb } from './db/index.js';
import { createApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

async function main() {
  await connectDb();
  await bootstrap();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`AutoParts ERP API listening on http://localhost:${env.PORT} (docs: /api/docs)`));
  const stopJobs = startScheduler();
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  logger.fatal({ err: e }, 'failed to start');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
