import type { ShopControls, ShopSettings } from '../src/shop-controls.ts';

const HEALTHY: ShopSettings = {
  layout: 'classic',
  latencyMs: [20, 120],
  errorRate: 0,
  stock: 'auto',
  sale: 'auto',
};

/** The practice shop's chaos controls, kept in memory: each host's settings, and every change asked for. */
export class FakeShop implements ShopControls {
  readonly settings = new Map<string, ShopSettings>();
  readonly changes: { host: string; patch: Record<string, unknown> | 'reset' }[] = [];

  async state(host: string) {
    return this.settings.get(host) ?? HEALTHY;
  }

  async change(host: string, patch: Record<string, unknown>) {
    this.changes.push({ host, patch });
    const next = { ...(await this.state(host)), ...patch } as ShopSettings;
    this.settings.set(host, next);
    return next;
  }

  async reset(host: string) {
    this.changes.push({ host, patch: 'reset' });
    this.settings.delete(host);
    return HEALTHY;
  }
}
