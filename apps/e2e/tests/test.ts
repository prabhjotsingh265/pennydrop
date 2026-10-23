import { test as base } from '@playwright/test';

export { expect, type Page } from '@playwright/test';

/**
 * Playwright's test, failing any test whose pages broke the content security policy:
 * the browser refuses the style or script quietly, so the page looks almost right.
 * Only the production build sends the policy (`make prod-e2e`); Vite's dev server doesn't.
 */
export const test = base.extend<{ policy: void }>({
  policy: [
    async ({ page }, use) => {
      const refused: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
          refused.push(`${page.url()}: ${message.text()}`);
        }
      });
      await use();
      if (refused.length > 0) throw new Error(`Refused by the policy:\n${refused.join('\n')}`);
    },
    { auto: true },
  ],
});
