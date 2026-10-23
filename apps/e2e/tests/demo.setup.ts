import { expect, test as setup } from './test.ts';

// One demo for the whole run, as a visitor gets it: one click from the front page.
setup('start a demo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the demo' }).first().click();
  // The dashboard's own heading: the front page has a "Watchlist" of its own.
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Watchlist', level: 1 })).toBeVisible();
  await page.context().storageState({ path: '.auth/demo.json' });
});
