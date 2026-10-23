import { expect, test, type Page } from './test.ts';
import { expectAccessible } from './axe.ts';

/** The visitor's own copy of the shop: the product page with the "Break the shop" panel. */
async function openOwnShop(page: Page) {
  await page.goto('/app');
  await page.getByRole('link', { name: 'your own shop', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Break the shop' });
  await expect(panel).toBeVisible();
  // Start every test from a healthy shop.
  await panel.getByRole('button', { name: 'Fix everything' }).click();
  await expect(panel.getByRole('status')).toContainText('Back to normal');
  return panel;
}

test('a redesign is healed, and the timeline says so', async ({ page }) => {
  const panel = await openOwnShop(page);
  await panel.getByRole('button', { name: 'Redesign the page' }).click();
  await expect(panel.getByRole('button', { name: 'Redesign the page' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByText('Found the price another way, and kept reading it.').first(),
  ).toBeVisible();
  await expectAccessible(page);
});

test('a sale drops through the target, and the alert arrives live', async ({ page }) => {
  const panel = await openOwnShop(page);
  const bell = page.getByRole('link', { name: /^Alerts/ });
  const before = await page.request
    .get('/api/alerts/unread')
    .then((r) => r.json() as Promise<{ count: number }>);
  await panel.getByRole('button', { name: 'Start a sale' }).click();
  await expect(page.getByText(/under your target/).first()).toBeVisible();
  await expect(bell).toHaveAccessibleName(new RegExp(`${before.count + 1} new alert`));
  await bell.click();
  await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
  await expect(page.getByText('Stoneware mug, in your own shop').first()).toBeVisible();
  await expectAccessible(page);
});

test('a practice-shop product is added by picking its price on the screenshot', async ({
  page,
}, testInfo) => {
  // Desktop and phone share one demo, so each adds its own product.
  const slug = testInfo.project.name === 'phone' ? 'ink-blue-mug' : 'serving-bowl';
  await page.goto('/app/add');
  await page.getByLabel('Product page address').fill(`http://fickle.localhost:4000/p/${slug}`);
  await page.getByRole('button', { name: 'Preview' }).click();
  // The preview boxes every price and picks the likeliest; it's added once one is picked.
  const save = page.getByRole('button', { name: 'Add to watchlist' });
  await expect(save).toBeEnabled({ timeout: 45_000 });
  await save.click();
  await expect(page).toHaveURL(/\/app\/p\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the dashboard’s pages pass an accessibility check', async ({ page }) => {
  for (const [path, heading] of [
    ['/app', 'Watchlist'],
    ['/app/sites', 'Sites'],
    ['/app/checks', 'Checks'],
    ['/app/groups', 'Compare'],
    ['/app/channels', 'Alert channels'],
    ['/app/settings', 'Settings'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expectAccessible(page);
  }
});
