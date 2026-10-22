import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** WCAG 2.2 A and AA, as axe can check them: the page must have no violations. */
export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const found = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    // Each node with axe's own reason, which for contrast gives the colours and the ratio.
    nodes: v.nodes
      .slice(0, 4)
      .map((n) => `${n.target.join(' ')}: ${n.any[0]?.message ?? n.failureSummary ?? ''}`),
  }));
  expect(found, 'accessibility violations').toEqual([]);
}
