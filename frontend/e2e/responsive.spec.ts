import { expect, test } from '@playwright/test';
import { NAV } from '../src/components/nav';
import { login } from './fixtures';

/** Every navigation item must open a working page at desktop, tablet and mobile sizes. */
const routes = NAV.flatMap((g) => (g.to ? [{ label: g.label, to: g.to }] : (g.items ?? [])));

test('every navigation page renders without errors and without horizontal scroll', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${page.url()}: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`);
  });
  await login(page);
  for (const r of routes) {
    await page.goto(r.to);
    await expect(page.locator('main h1').first(), r.to).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Could not load data'), r.to).toHaveCount(0);
    await expect(page.getByText('Access denied'), r.to).toHaveCount(0);
    await expect(page.getByText('Page not found'), r.to).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${r.to} horizontal overflow`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test('mobile and tablet users can open the navigation menu', async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width >= 1024, 'sidebar is always visible on desktop');
  await login(page);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Sales' }).click();
  await page.getByRole('link', { name: 'Point of Sale' }).click();
  await expect(page.getByRole('heading', { name: 'Point of Sale' })).toBeVisible();
});
