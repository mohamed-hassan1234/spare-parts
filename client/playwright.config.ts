import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against an ISOLATED stack: API on :4199 using the `autoparts_e2e`
 * database (dropped and re-created by global-setup), web on :5199. Never the dev or live DB.
 * Requires the local replica set (`npm run dev:db`).
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 4199);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5199);
const MONGO = process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27018/autoparts_e2e?replicaSet=rs0';
const channel = process.env.PW_CHANNEL as 'chrome' | 'msedge' | undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/results.json' }]],
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', channel },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, channel }, testMatch: /responsive\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, testMatch: /responsive\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: '../server',
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NODE_ENV: 'development', PORT: String(API_PORT), MONGODB_URI: MONGO, CORS_ORIGINS: `http://localhost:${WEB_PORT}`, JOBS_ENABLED: 'false', LOG_LEVEL: 'warn', APP_SECRET: 'e2e-only-secret-not-for-production-use', BACKUP_ENCRYPTION_KEY: 'b'.repeat(64), BACKUP_DIR: './.e2e-backups', UPLOAD_DIR: './.e2e-uploads', LOGIN_MAX_ATTEMPTS: '50' },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
