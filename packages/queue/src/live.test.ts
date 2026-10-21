import { describe, expect, it } from 'vitest';
import { parseLive } from './live.ts';

describe('parseLive', () => {
  it('reads our messages and ignores anything else', () => {
    expect(parseLive('{"type":"watches","workspaceId":"w"}')).toEqual({
      type: 'watches',
      workspaceId: 'w',
    });
    expect(
      parseLive('{"type":"checked","targetId":"t","outcome":"ok","priceChanged":true}'),
    ).toMatchObject({ type: 'checked', targetId: 't' });
    expect(parseLive('{"type":"checked"}')).toBeNull();
    expect(parseLive('not json')).toBeNull();
    expect(parseLive('null')).toBeNull();
  });
});
