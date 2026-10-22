import { expect, test } from '@playwright/test';
import { expectAccessible } from './axe.ts';

// The public pages, as anyone arriving sees them: signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test('the public pages pass an accessibility check', async ({ page }) => {
  for (const [path, heading] of [
    ['/', /Know when the/],
    ['/bot', 'Our crawler'],
    ['/privacy', 'Privacy'],
    ['/terms', 'Terms'],
    ['/signin', 'Sign in'],
    ['/signup', 'Create your account'],
    ['/forgot', 'Forgotten your password?'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expectAccessible(page);
  }
});

test('the front page’s way in reaches the demo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Try the demo' }).first()).toHaveAttribute(
    'href',
    '/demo',
  );
});
