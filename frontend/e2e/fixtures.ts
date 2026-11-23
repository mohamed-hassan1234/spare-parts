import { expect, type Page } from '@playwright/test';

/** Test-only credentials for the throwaway E2E database (never used elsewhere). */
export const E2E_ADMIN = { username: 'e2e-owner', password: 'E2e-Test-Passw0rd!' };

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(E2E_ADMIN.username);
  await page.getByLabel('Password').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** "$1,234.56" → 123456 cents. */
export const cents = (s: string) => Math.round(Number(s.replace(/[^0-9.-]/g, '')) * 100);
