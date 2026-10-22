import { expect, test as setup } from '@playwright/test';

// One demo for the whole run, as a visitor gets it: one click from the front page.
setup('start a demo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the demo' }).first().click();
  await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
  await page.context().storageState({ path: '.auth/demo.json' });
});
