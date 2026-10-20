import { describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('GET /api/health', () => {
  it('answers ok', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
